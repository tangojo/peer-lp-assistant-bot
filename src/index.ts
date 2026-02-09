import { loadConfig } from './config/loader.js';
import { initDatabase, closeDatabase, saveDatabase } from './db/connection.js';
import { runMigrations } from './db/migrations.js';
import { ChainListener } from './chain/listener.js';
import { OrderManager } from './engine/order-manager.js';
import { ForexPoller } from './forex/poller.js';
import { SpreadEngine } from './engine/spread-engine.js';
import { PnlTracker } from './engine/pnl-tracker.js';
import { RecycleManager } from './engine/recycle-manager.js';
import { RevolutClient } from './revolut/client.js';
import { RevolutWebhookServer } from './revolut/webhook.js';
import { RevolutMatcher } from './revolut/matcher.js';
import {
  initAlertService,
  connectOrderManager,
  connectSpreadEngine,
  connectRecycleManager,
  connectRevolutClient,
} from './alerts/service.js';
import { startApiServer } from './api/server.js';
import { createChildLogger } from './utils/logger.js';

const log = createChildLogger('main');

async function main(): Promise<void> {
  log.info('Peer LP Assistant Bot v0.3.0 starting...');

  // 1. Load config
  const config = loadConfig();

  // 2. Initialize database
  const db = await initDatabase(config.database.path);
  runMigrations(db);

  // 3. Initialize alerts (Telegram + Discord + Console)
  initAlertService(config);

  // 4. Start forex poller
  const forexPoller = new ForexPoller(5 * 60 * 1000);
  await forexPoller.start();

  // 5. Start spread engine
  const spreadEngine = new SpreadEngine(config, forexPoller);
  spreadEngine.start();

  // 6. Start P&L tracker
  const pnlTracker = new PnlTracker(forexPoller);
  pnlTracker.start();

  // 7. Start recycle manager
  const recycleManager = new RecycleManager(config);
  recycleManager.start();

  // 8. Initialize Revolut integration
  const revolutClient = new RevolutClient(config);
  let revolutWebhook: RevolutWebhookServer | null = null;
  let revolutMatcher: RevolutMatcher | null = null;

  if (config.revolut.enabled) {
    revolutMatcher = new RevolutMatcher(recycleManager);

    // Start webhook server
    revolutWebhook = new RevolutWebhookServer(config.revolut.webhook_port);
    await revolutWebhook.start();

    // Wire webhook events → matcher
    revolutWebhook.on('transactionCreated', (tx) => {
      revolutMatcher!.matchTransaction(tx);
    });

    // Connect Revolut token health alerts
    connectRevolutClient(revolutClient);
  }

  // 9. Start chain listener
  const chainListener = new ChainListener(config);

  // 10. Start order manager
  const orderManager = new OrderManager(chainListener);
  orderManager.start();

  // 11. Auto-open P&L cycles on fulfilled orders
  orderManager.on('orderFulfilled', (event) => {
    if (config.peer.deposit_ids.includes(event.depositId)) {
      pnlTracker.openCycle(event.depositId, event.usdcAmount, config.spread.target_margin_percent);
    }
  });

  // 12. Connect all alerts
  connectOrderManager(orderManager);
  connectSpreadEngine(spreadEngine);
  connectRecycleManager(recycleManager);

  // 13. Start listening to chain events
  await chainListener.start();

  // 14. Start REST API (if enabled)
  if (config.api.enabled) {
    await startApiServer({ config, orderManager, pnlTracker, spreadEngine, forexPoller });
  }

  // 15. Periodic database save (every 60 seconds)
  const saveInterval = setInterval(() => {
    saveDatabase();
  }, 60_000);

  log.info('Bot is running. Press Ctrl+C to stop.');

  // Graceful shutdown
  const shutdown = async () => {
    log.info('Shutting down...');
    clearInterval(saveInterval);
    forexPoller.stop();
    recycleManager.stop();
    if (revolutWebhook) await revolutWebhook.stop();
    await chainListener.stop();
    closeDatabase();
    log.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  log.error({ err }, 'Fatal error');
  process.exit(1);
});
