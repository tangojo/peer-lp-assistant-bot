#!/usr/bin/env node

import { Command } from 'commander';
import { loadConfig } from '../config/loader.js';
import { initDatabase, closeDatabase } from '../db/connection.js';
import { runMigrations } from '../db/migrations.js';
import { getDeposits, getOrders, getOrderStats } from '../db/queries.js';
import { formatUSD, formatPercent, formatDuration, shortenHash } from '../utils/formatting.js';

const program = new Command();

program
  .name('peer-lp')
  .description('Peer LP Assistant Bot — CLI')
  .version('0.1.0')
  .option('-c, --config <path>', 'Path to config file');

// Initialize database for commands that need it
async function withDb<T>(fn: () => T | Promise<T>): Promise<T> {
  const opts = program.opts<{ config?: string }>();
  const config = loadConfig(opts.config);
  const db = await initDatabase(config.database.path);
  runMigrations(db);
  try {
    return await fn();
  } finally {
    closeDatabase();
  }
}

// ── status ──────────────────────────────────────────────────
program
  .command('status')
  .description('Show deposit status and balance overview')
  .action(async () => {
    await withDb(() => {
      const deposits = getDeposits();
      const stats = getOrderStats();

      if (deposits.length === 0) {
        console.log('\nNo deposits tracked yet. Start the bot to begin monitoring.\n');
        return;
      }

      console.log('\n=== Peer LP Status ===\n');

      for (const d of deposits) {
        console.log(`Deposit #${d.deposit_id}`);
        console.log(`  Status:    ${d.status}`);
        console.log(`  Available: ${d.amount_available != null ? formatUSD(d.amount_available as number) : 'N/A'} USDC`);
        console.log(`  Spread:    ${d.spread_percent != null ? formatPercent(d.spread_percent as number) : 'N/A'}`);
        console.log(`  Currency:  ${d.currency}`);
        console.log(`  Payment:   ${d.payment_method}`);
        console.log('');
      }

      console.log('=== Order Stats ===\n');
      console.log(`  Total orders:    ${stats.total}`);
      console.log(`  Fulfilled:       ${stats.fulfilled}`);
      console.log(`  Fill rate:       ${stats.total > 0 ? formatPercent((stats.fulfilled / stats.total) * 100) : 'N/A'}`);
      console.log(`  Avg fill time:   ${stats.avgFillTime != null ? formatDuration(stats.avgFillTime) : 'N/A'}`);
      console.log('');
    });
  });

// ── orders ──────────────────────────────────────────────────
program
  .command('orders')
  .description('Show recent orders')
  .option('-n, --limit <number>', 'Number of orders to show', '20')
  .action(async (opts) => {
    await withDb(() => {
      const orders = getOrders(parseInt(opts.limit, 10));

      if (orders.length === 0) {
        console.log('\nNo orders tracked yet.\n');
        return;
      }

      console.log('\n=== Recent Orders ===\n');
      console.log(
        'Hash'.padEnd(18) +
        'Deposit'.padEnd(9) +
        'USDC'.padEnd(12) +
        'Status'.padEnd(12) +
        'Fill Time'.padEnd(12) +
        'Date',
      );
      console.log('-'.repeat(80));

      for (const o of orders) {
        const hash = shortenHash(o.intent_hash as string);
        const deposit = `#${o.deposit_id}`;
        const usdc = o.usdc_amount != null ? formatUSD(o.usdc_amount as number) : 'N/A';
        const status = (o.status as string).toUpperCase();
        const fillTime = o.fill_time_seconds != null ? formatDuration(o.fill_time_seconds as number) : '-';
        const date = o.signaled_at
          ? new Date(o.signaled_at as string).toLocaleDateString('de-DE')
          : '-';

        console.log(
          hash.padEnd(18) +
          deposit.padEnd(9) +
          usdc.padEnd(12) +
          status.padEnd(12) +
          fillTime.padEnd(12) +
          date,
        );
      }
      console.log('');
    });
  });

program.parse();
