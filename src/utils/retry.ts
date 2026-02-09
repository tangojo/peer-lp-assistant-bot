import { createChildLogger } from './logger.js';

const log = createChildLogger('retry');

export async function retry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; delayMs?: number; label?: string } = {},
): Promise<T> {
  const { retries = 3, delayMs = 1000, label = 'operation' } = opts;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries) throw err;
      const wait = delayMs * attempt;
      log.warn({ attempt, retries, wait, label, err }, `${label} failed, retrying in ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  throw new Error('unreachable');
}
