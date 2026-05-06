import { copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const packageRoot = process.cwd();
const repoRoot = resolve(packageRoot, '../..');
const srcKeywords = resolve(repoRoot, 'keywords.md');
const dstKeywords = resolve(packageRoot, 'src/keywords.md');

if (!existsSync(srcKeywords)) {
  console.error(`ERROR: ${srcKeywords} not found. Create it before building.`);
  process.exit(1);
}

copyFileSync(srcKeywords, dstKeywords);
console.log(`Copied ${srcKeywords} -> ${dstKeywords}`);

if (process.argv.includes('--copy-only')) {
  process.exit(0);
}

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: 'dist/index.js',
  external: ['*'],
  loader: { '.md': 'text' },
});

console.log('Build OK');
