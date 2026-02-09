import { loadConfig } from './config/loader.js';
import { initDatabase, closeDatabase, saveDatabase } from './db/connection.js';
import { runMigrations } from './db/migrations.js';
import { ChainListener } from './chain/listener.js';
import { OrderManager } from './engine/order-manager.js';
import { initAlertService, connectOrderManager } from './alerts/service.js';
import { createChildLogger } from './utils/logger.js';

const log = createChildLogger('main');

async function main(): Promise<void> {
  log.info('Peer LP Assistant Bot starting...');

  // 1. Load config
  const config = loadConfig();

  // 2. Initialize database
  const db = await initDatabase(config.database.path);
  runMigrations(db);

  // 3. Initialize alerts
  initAlertService(config);

  // 4. Start chain listener
  const chainListener = new ChainListener(config);

  // 5. Start order manager
  const orderManager = new OrderManager(chainListener);
  orderManager.start();

  // 6. Connect alerts to order manager
  connectOrderManager(orderManager);

  // 7. Start listening to chain events
  await chainListener.start();

  // 8. Periodic database save (every 60 seconds)
  const saveInterval = setInterval(() => {
    saveDatabase();
  }, 60_000);

  log.info('Bot is running. Press Ctrl+C to stop.');

  // Graceful shutdown
  const shutdown = async () => {
    log.info('Shutting down...');
    clearInterval(saveInterval);
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
