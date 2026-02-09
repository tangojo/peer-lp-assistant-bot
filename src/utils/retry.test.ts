import { describe, it, expect, vi } from 'vitest';
import { retry } from './retry.js';

describe('retry', () => {
  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await retry(fn, { retries: 3, delayMs: 10 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledOnce();
  });

  it('retries on failure and succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail1'))
      .mockRejectedValueOnce(new Error('fail2'))
      .mockResolvedValue('ok');

    const result = await retry(fn, { retries: 3, delayMs: 10, label: 'test' });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws after all retries exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('persistent'));

    await expect(
      retry(fn, { retries: 2, delayMs: 10, label: 'fail-test' }),
    ).rejects.toThrow('persistent');

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('uses defaults when no options provided', async () => {
    const fn = vi.fn().mockResolvedValue(42);
    const result = await retry(fn);
    expect(result).toBe(42);
  });

  it('waits with increasing delay between retries', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('ok');

    const start = Date.now();
    await retry(fn, { retries: 2, delayMs: 50 });
    const elapsed = Date.now() - start;

    // Should have waited at least ~50ms (delayMs * attempt 1)
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });
});
