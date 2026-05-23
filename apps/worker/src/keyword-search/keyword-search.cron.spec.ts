import { describe, it, expect } from 'vitest';
import { isDue } from './keyword-search.cron';

describe('isDue', () => {
  const now = new Date('2026-05-23T15:00:00Z');

  it('null lastSearchedAt → always due (new keyword)', () => {
    expect(
      isDue({ monitorFrequency: 'D1', lastSearchedAt: null }, now),
    ).toBe(true);
  });

  it('M15: not due 5 minutes ago', () => {
    expect(
      isDue(
        {
          monitorFrequency: 'M15',
          lastSearchedAt: new Date('2026-05-23T14:55:00Z'),
        },
        now,
      ),
    ).toBe(false);
  });

  it('M15: due exactly 15 minutes ago', () => {
    expect(
      isDue(
        {
          monitorFrequency: 'M15',
          lastSearchedAt: new Date('2026-05-23T14:45:00Z'),
        },
        now,
      ),
    ).toBe(true);
  });

  it('H1: due 61 minutes ago', () => {
    expect(
      isDue(
        {
          monitorFrequency: 'H1',
          lastSearchedAt: new Date('2026-05-23T13:59:00Z'),
        },
        now,
      ),
    ).toBe(true);
  });

  it('D1: not due 23 hours ago', () => {
    expect(
      isDue(
        {
          monitorFrequency: 'D1',
          lastSearchedAt: new Date('2026-05-22T16:00:00Z'),
        },
        now,
      ),
    ).toBe(false);
  });

  it('D1: due 25 hours ago', () => {
    expect(
      isDue(
        {
          monitorFrequency: 'D1',
          lastSearchedAt: new Date('2026-05-22T14:00:00Z'),
        },
        now,
      ),
    ).toBe(true);
  });
});
