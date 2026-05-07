import { getPrisma } from '@ai-hot-news/db';

export interface WipeResult {
  before: number;
  deleted: number;
  after: number;
}

export async function runWipe(): Promise<WipeResult> {
  const prisma = getPrisma();
  const before = await prisma.hotNews.count();
  console.log(`[wipe-pre-sp5] Before: ${before} rows`);

  const result = await prisma.hotNews.deleteMany({});
  const after = await prisma.hotNews.count();
  console.log(`[wipe-pre-sp5] Deleted ${result.count} rows, after: ${after}`);

  return { before, deleted: result.count, after };
}

async function main(): Promise<void> {
  const stats = await runWipe();
  console.log(JSON.stringify(stats, null, 2));
}

const isMainEntry =
  typeof require !== 'undefined' && require.main === module;
const isTsxEntry = process.argv[1]?.endsWith('wipe-hot-news-pre-sp5.ts');

if (isMainEntry || isTsxEntry) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
