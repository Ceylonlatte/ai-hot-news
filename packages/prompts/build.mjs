import { copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { argv, cwd, exit } from 'node:process';
import { log, error } from 'node:console';
import { build } from 'esbuild';

const packageRoot = cwd();
const repoRoot = resolve(packageRoot, '../..');
const srcKeywords = resolve(repoRoot, 'keywords.md');
const dstKeywords = resolve(packageRoot, 'src/keywords.md');

if (!existsSync(srcKeywords)) {
  error(`ERROR: ${srcKeywords} not found. Create it before building.`);
  exit(1);
}

copyFileSync(srcKeywords, dstKeywords);
log(`Copied ${srcKeywords} -> ${dstKeywords}`);

if (argv.includes('--copy-only')) {
  exit(0);
}

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: 'dist/index.js',
  loader: { '.md': 'text' },
});

log('Build OK');
