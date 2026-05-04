import { Platform, getPrisma } from '@ai-hot-news/db';

export interface CleanupResult {
  cutoff: string;
  toDelete: number;
  deleted: number;
  remainingRss: number;
}

export async function runCleanupRssPreWindow(): Promise<CleanupResult> {
  const prisma = getPrisma();
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const toDelete = await prisma.hotNews.count({
    where: {
      sourcePlatform: Platform.RSS,
      publishedAt: { lt: cutoff },
    },
  });

  const result = await prisma.hotNews.deleteMany({
    where: {
      sourcePlatform: Platform.RSS,
      publishedAt: { lt: cutoff },
    },
  });

  const remainingRss = await prisma.hotNews.count({
    where: { sourcePlatform: Platform.RSS },
  });

  return {
    cutoff: cutoff.toISOString(),
    toDelete,
    deleted: result.count,
    remainingRss,
  };
}

async function main(): Promise<void> {
  const stats = await runCleanupRssPreWindow();
  console.log(JSON.stringify(stats, null, 2));
}

const isMainEntry =
  typeof require !== 'undefined' && require.main === module;
const isTsxEntry = process.argv[1]?.endsWith('cleanup-rss-pre-window.ts');

if (isMainEntry || isTsxEntry) {
  main()
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(async () => {
      await getPrisma().$disconnect();
      process.exit(0);
    });
}
