import { loadConfig } from './config/loader.js';
import { initDatabase, closeDatabase, saveDatabase } from './db/connection.js';
import { runMigrations } from './db/migrations.js';
import { ChainListener } from './chain/listener.js';
import { initSigner } from './chain/signer.js';
import { EscrowManager } from './chain/escrow-manager.js';
import { OrderManager } from './engine/order-manager.js';
import { ForexPoller } from './forex/poller.js';
import { SpreadEngine } from './engine/spread-engine.js';
import { PnlTracker } from './engine/pnl-tracker.js';
import { RecycleManager } from './engine/recycle-manager.js';
import { CompetitionAnalyzer } from './engine/competition.js';
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
  log.info('Peer LP Assistant Bot v0.4.0 starting...');

  // 1. Load config
  const config = loadConfig();

  // 2. Initialize database
  const db = await initDatabase(config.database.path);
  runMigrations(db);

  // 3. Initialize wallet signer (optional — needed for write ops)
  const signer = initSigner(config);

  // 4. Initialize alerts (Telegram + Discord + Console)
  initAlertService(config);

  // 5. Start forex poller
  const forexPoller = new ForexPoller(5 * 60 * 1000);
  await forexPoller.start();

  // 6. Start spread engine
  const spreadEngine = new SpreadEngine(config, forexPoller);

  // 7. Initialize escrow manager + connect to spread engine (if signer available)
  let escrowManager: EscrowManager | null = null;
  if (signer) {
    escrowManager = new EscrowManager(config, signer);
    spreadEngine.setEscrowManager(escrowManager);

    // Initial sync of all deposits
    await escrowManager.syncAllDeposits();
  }

  // 8. Competition analyzer
  const competitionAnalyzer = new CompetitionAnalyzer(config);
  spreadEngine.setCompetitionAnalyzer(competitionAnalyzer);

  spreadEngine.start();

  // 9. Start P&L tracker
  const pnlTracker = new PnlTracker(forexPoller);
  pnlTracker.start();

  // 10. Start recycle manager
  const recycleManager = new RecycleManager(config);
  recycleManager.start();

  // 11. Initialize Revolut integration
  const revolutClient = new RevolutClient(config);
  let revolutWebhook: RevolutWebhookServer | null = null;

  if (config.revolut.enabled) {
    const revolutMatcher = new RevolutMatcher(recycleManager);

    revolutWebhook = new RevolutWebhookServer(config.revolut.webhook_port);
    await revolutWebhook.start();

    revolutWebhook.on('transactionCreated', (tx) => {
      revolutMatcher.matchTransaction(tx);
    });

    connectRevolutClient(revolutClient);
  }

  // 12. Start chain listener
  const chainListener = new ChainListener(config);

  // 13. Start order manager
  const orderManager = new OrderManager(chainListener);
  orderManager.start();

  // 14. Auto-open P&L cycles on fulfilled orders
  orderManager.on('orderFulfilled', (event) => {
    if (config.peer.deposit_ids.includes(event.depositId)) {
      pnlTracker.openCycle(event.depositId, event.usdcAmount, config.spread.target_margin_percent);
    }
  });

  // 15. Connect all alerts
  connectOrderManager(orderManager);
  connectSpreadEngine(spreadEngine);
  connectRecycleManager(recycleManager);

  // 16. Start listening to chain events
  await chainListener.start();

  // 17. Start REST API (if enabled)
  if (config.api.enabled) {
    await startApiServer({ config, orderManager, pnlTracker, spreadEngine, forexPoller });
  }

  // 18. Periodic tasks
  const saveInterval = setInterval(() => saveDatabase(), 60_000);

  // Periodic deposit sync (every 5 minutes, if signer available)
  const syncInterval = escrowManager
    ? setInterval(() => escrowManager!.syncAllDeposits(), 5 * 60 * 1000)
    : null;

  log.info('Bot is running. Press Ctrl+C to stop.');

  // Graceful shutdown
  const shutdown = async () => {
    log.info('Shutting down...');
    clearInterval(saveInterval);
    if (syncInterval) clearInterval(syncInterval);
    forexPoller.stop();
    spreadEngine.stop();
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
