import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  REDDIT_BUNDLE_ID,
  REDDIT_BUNDLE_URL,
  REDDIT_BUNDLE_NAME,
  REDDIT_INTERVAL_BUNDLE,
} from '../scripts/consolidate-sp5-sources';

const seedSource = readFileSync(resolve(__dirname, 'seed.ts'), 'utf8');

function extractStringLiteral(name: string): string {
  const match = seedSource.match(
    new RegExp(`const ${name} =\\s*\\n?\\s*'([^']+)'`),
  );
  if (!match) throw new Error(`could not find string literal for ${name}`);
  return match[1];
}

function extractNumberLiteral(name: string): number {
  const match = seedSource.match(new RegExp(`const ${name} = (\\d+);`));
  if (!match) throw new Error(`could not find number literal for ${name}`);
  return Number(match[1]);
}

describe('seed.ts inlined Reddit bundle constants', () => {
  it('REDDIT_BUNDLE_ID matches consolidate-sp5-sources export', () => {
    expect(extractStringLiteral('REDDIT_BUNDLE_ID')).toBe(REDDIT_BUNDLE_ID);
  });

  it('REDDIT_BUNDLE_URL matches consolidate-sp5-sources export', () => {
    expect(extractStringLiteral('REDDIT_BUNDLE_URL')).toBe(REDDIT_BUNDLE_URL);
  });

  it('REDDIT_INTERVAL_BUNDLE matches consolidate-sp5-sources export', () => {
    expect(extractNumberLiteral('REDDIT_INTERVAL_BUNDLE')).toBe(
      REDDIT_INTERVAL_BUNDLE,
    );
  });

  it('REDDIT_BUNDLE_NAME matches consolidate-sp5-sources export (SP-5.5)', () => {
    expect(extractStringLiteral('REDDIT_BUNDLE_NAME')).toBe(REDDIT_BUNDLE_NAME);
  });
});
