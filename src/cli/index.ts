#!/usr/bin/env node

import { Command } from 'commander';
import { loadConfig } from '../config/loader.js';
import { initDatabase, closeDatabase } from '../db/connection.js';
import { runMigrations } from '../db/migrations.js';
import { getDeposits, getOrders, getOrderStats, getLatestForex } from '../db/queries.js';
import { formatUSD, formatEUR, formatPercent, formatDuration, shortenHash } from '../utils/formatting.js';
import { ForexPoller } from '../forex/poller.js';
import { SpreadEngine } from '../engine/spread-engine.js';
import { PnlTracker } from '../engine/pnl-tracker.js';

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

// ── pnl ─────────────────────────────────────────────────────
program
  .command('pnl')
  .description('Show P&L summary')
  .option('-p, --period <days>', 'Period in days (e.g. 7, 30, 90)')
  .action(async (opts) => {
    await withDb(() => {
      const forexPoller = new ForexPoller();
      const pnlTracker = new PnlTracker(forexPoller);

      const periodDays = opts.period ? parseInt(opts.period, 10) : null;
      const summary = pnlTracker.getSummary(periodDays);

      console.log(`\n=== P&L Summary (${summary.period}) ===\n`);
      console.log(`  Total cycles:       ${summary.totalCycles}`);
      console.log(`  Completed cycles:   ${summary.completedCycles}`);
      console.log(`  USDC sold:          ${formatUSD(summary.totalUsdcSold)}`);
      console.log(`  Fiat received:      ${formatEUR(summary.totalFiatReceived)}`);
      console.log(`  Net profit (EUR):   ${formatEUR(summary.totalNetProfitFiat)}`);
      console.log(`  Net profit (USD):   ${formatUSD(summary.totalNetProfitUsd)}`);
      console.log(`  Avg spread:         ${summary.avgSpreadPercent != null ? formatPercent(summary.avgSpreadPercent) : 'N/A'}`);
      console.log(`  Avg fill time:      ${summary.avgFillTimeSeconds != null ? formatDuration(summary.avgFillTimeSeconds) : 'N/A'}`);
      console.log(`  Annualized return:  ${summary.annualizedReturnPercent != null ? formatPercent(summary.annualizedReturnPercent) : 'N/A'}`);

      const openCycles = pnlTracker.getOpenCycles();
      if (openCycles.length > 0) {
        console.log(`\n--- Open Cycles (${openCycles.length}) ---\n`);
        for (const c of openCycles) {
          console.log(`  Cycle #${c.id} | Deposit #${c.deposit_id} | ${formatUSD(c.usdc_sold)} USDC | ${c.status} | ${c.started_at}`);
        }
      }
      console.log('');
    });
  });

// ── spread ──────────────────────────────────────────────────
program
  .command('spread')
  .description('Show current spread and recommendation')
  .action(async () => {
    await withDb(() => {
      const config = loadConfig(program.opts<{ config?: string }>().config);
      const forexPoller = new ForexPoller();
      const spreadEngine = new SpreadEngine(config, forexPoller);

      // Load latest forex from DB
      const latest = getLatestForex();

      const rec = spreadEngine.getRecommendation();
      const health = spreadEngine.isSpreadHealthy();

      console.log('\n=== Spread Info ===\n');
      console.log(`  EUR/USD rate:     ${latest ? latest.eur_usd.toFixed(4) : 'N/A'} (${latest?.source ?? 'no data'})`);
      console.log(`  Current spread:   ${rec.current != null ? formatPercent(rec.current) : 'N/A'}`);
      console.log(`  Recommended:      ${formatPercent(rec.recommended)}`);
      console.log(`  Breakdown:        ${rec.breakdown}`);
      console.log(`  Health:           ${health.healthy ? 'OK' : health.reason}`);
      console.log(`  Mode:             ${config.spread.mode}`);
      console.log(`  Min/Max:          ${formatPercent(config.spread.min_spread_percent)} / ${formatPercent(config.spread.max_spread_percent)}`);
      console.log('');
    });
  });

// ── spread set ──────────────────────────────────────────────
program
  .command('spread-set <percent>')
  .description('Set spread for a deposit (local only, Phase 4 for on-chain)')
  .option('-d, --deposit <id>', 'Deposit ID', '1')
  .action(async (percent, opts) => {
    await withDb(() => {
      const config = loadConfig(program.opts<{ config?: string }>().config);
      const forexPoller = new ForexPoller();
      const spreadEngine = new SpreadEngine(config, forexPoller);

      const spreadPercent = parseFloat(percent);
      const depositId = parseInt(opts.deposit, 10);

      if (isNaN(spreadPercent)) {
        console.error('Error: spread must be a number (e.g. 1.5)');
        return;
      }

      const { min_spread_percent, max_spread_percent } = config.spread;
      if (spreadPercent < min_spread_percent || spreadPercent > max_spread_percent) {
        console.error(`Error: spread must be between ${min_spread_percent}% and ${max_spread_percent}%`);
        return;
      }

      spreadEngine.setCurrentSpread(depositId, spreadPercent);
      console.log(`\nSpread for deposit #${depositId} set to ${formatPercent(spreadPercent)}`);
      console.log('Note: On-chain transaction not yet implemented (Phase 4)\n');
    });
  });

program.parse();
