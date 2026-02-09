import { describe, it, expect } from 'vitest';
import { formatUSD, formatEUR, formatPercent, shortenAddress, shortenHash, formatDuration } from './formatting.js';

describe('formatUSD', () => {
  it('formats positive amounts', () => {
    expect(formatUSD(1234.5)).toBe('$1234.50');
  });

  it('formats zero', () => {
    expect(formatUSD(0)).toBe('$0.00');
  });

  it('formats small amounts', () => {
    expect(formatUSD(0.1)).toBe('$0.10');
  });
});

describe('formatEUR', () => {
  it('formats amounts with euro sign', () => {
    expect(formatEUR(99.9)).toBe('€99.90');
  });
});

describe('formatPercent', () => {
  it('formats percentages', () => {
    expect(formatPercent(1.5)).toBe('1.50%');
  });

  it('formats zero', () => {
    expect(formatPercent(0)).toBe('0.00%');
  });
});

describe('shortenAddress', () => {
  it('shortens a full EVM address', () => {
    expect(shortenAddress('0x1234567890abcdef1234567890abcdef12345678')).toBe('0x1234...5678');
  });
});

describe('shortenHash', () => {
  it('shortens a transaction hash', () => {
    const hash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
    expect(shortenHash(hash)).toBe('0xabcdef12...567890');
  });
});

describe('formatDuration', () => {
  it('formats seconds only', () => {
    expect(formatDuration(45)).toBe('45s');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(125)).toBe('2m 5s');
  });

  it('formats hours and minutes', () => {
    expect(formatDuration(3725)).toBe('1h 2m');
  });

  it('formats exact minutes', () => {
    expect(formatDuration(120)).toBe('2m 0s');
  });

  it('formats exact hours', () => {
    expect(formatDuration(3600)).toBe('1h 0m');
  });
});
