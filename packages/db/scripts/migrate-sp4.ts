import { Platform, ContentStatus, getPrisma } from '@ai-hot-news/db';
import {
  normalizeUrl,
  computeDedupeHash,
  stripTitleBoilerplate,
  checkRedditQuality,
  checkHnQuality,
  checkUniversalQuality,
} from '@ai-hot-news/utils';

export interface MigrateSp4Stats {
  layer1NormalizeUpdated: number;
  layer1Collapsed: number;
  layer1HashUpdated: number;
  layer2Hidden: Record<string, number>;
}

export async function runMigrateSp4(): Promise<MigrateSp4Stats> {
  const prisma = getPrisma();
  const stats: MigrateSp4Stats = {
    layer1NormalizeUpdated: 0,
    layer1Collapsed: 0,
    layer1HashUpdated: 0,
    layer2Hidden: {},
  };

  // === Layer 1: re-normalize URLs + recompute dedupeHash + collapse duplicates ===
  const allRows = await prisma.hotNews.findMany({
    select: {
      id: true,
      sourceUrl: true,
      title: true,
      dedupeHash: true,
    },
    orderBy: { publishedAt: 'asc' },
  });

  const deletedRowIds = new Set<string>();

  for (const row of allRows) {
    if (deletedRowIds.has(row.id)) continue;

    const newUrl = normalizeUrl(row.sourceUrl);
    const cleanTitle = stripTitleBoilerplate(row.title);
    const newHash = computeDedupeHash(newUrl, cleanTitle);

    const urlChanged = newUrl !== row.sourceUrl;
    const hashChanged = newHash !== row.dedupeHash;
    const titleChanged = cleanTitle !== row.title;

    if (!urlChanged && !hashChanged && !titleChanged) continue;

    try {
      await prisma.hotNews.update({
        where: { id: row.id },
        data: {
          sourceUrl: newUrl,
          dedupeHash: newHash,
          title: cleanTitle,
        },
      });
      if (urlChanged) stats.layer1NormalizeUpdated += 1;
      if (hashChanged) stats.layer1HashUpdated += 1;
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        // Conflict: another row already owns newUrl or newHash.
        // Find the conflicting row and delete whichever is newer (preserving older).
        const conflicting = await prisma.hotNews.findFirst({
          where: {
            AND: [
              { id: { not: row.id } },
              { OR: [{ sourceUrl: newUrl }, { dedupeHash: newHash }] },
            ],
          },
          select: { id: true, publishedAt: true },
        });

        if (!conflicting) {
          // Should not happen — P2002 fired but no conflicting row found. Re-throw.
          throw err;
        }

        // Determine which row to delete: keep the older publishedAt.
        const currentRow = await prisma.hotNews.findUniqueOrThrow({
          where: { id: row.id },
          select: { publishedAt: true },
        });

        if (currentRow.publishedAt <= conflicting.publishedAt) {
          // Current row is older or same → delete the conflicting (newer) row.
          // Then retry the update of current row to claim the canonical URL/hash.
          await prisma.hotNews.delete({ where: { id: conflicting.id } });
          deletedRowIds.add(conflicting.id);
          await prisma.hotNews.update({
            where: { id: row.id },
            data: {
              sourceUrl: newUrl,
              dedupeHash: newHash,
              title: cleanTitle,
            },
          });
          if (urlChanged) stats.layer1NormalizeUpdated += 1;
          if (hashChanged) stats.layer1HashUpdated += 1;
          stats.layer1Collapsed += 1;
        } else {
          // Current row is newer → delete the current row, conflicting (older) wins.
          await prisma.hotNews.delete({ where: { id: row.id } });
          deletedRowIds.add(row.id);
          stats.layer1Collapsed += 1;
        }
      } else {
        throw err;
      }
    }
  }

  // === Layer 2: retroactively apply quality rules to currently-VISIBLE rows ===
  const visibleRows = await prisma.hotNews.findMany({
    where: { status: ContentStatus.VISIBLE },
    select: {
      id: true,
      title: true,
      sourcePlatform: true,
      interactionData: true,
    },
  });

  for (const row of visibleRows) {
    let reason: string | null = null;
    const ix = row.interactionData as Record<string, unknown> | null;

    if (row.sourcePlatform === Platform.REDDIT && ix) {
      reason = checkRedditQuality({
        upvote_ratio:
          typeof ix.redditUpvoteRatio === 'number' ? ix.redditUpvoteRatio : null,
        score: typeof ix.score === 'number' ? ix.score : 0,
        num_comments: typeof ix.comments === 'number' ? ix.comments : 0,
      });
    } else if (row.sourcePlatform === Platform.HACKERNEWS && ix) {
      reason = checkHnQuality({
        score: typeof ix.score === 'number' ? ix.score : null,
        descendants: typeof ix.comments === 'number' ? ix.comments : null,
      });
    }

    if (!reason) {
      reason = checkUniversalQuality({ title: row.title });
    }

    if (reason) {
      await prisma.hotNews.update({
        where: { id: row.id },
        data: {
          status: ContentStatus.HIDDEN,
          filterReason: reason,
        },
      });
      stats.layer2Hidden[reason] = (stats.layer2Hidden[reason] ?? 0) + 1;
    }
  }

  return stats;
}

const isDirectRun =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('migrate-sp4.ts') ||
  process.argv[1]?.endsWith('migrate-sp4.js');

if (isDirectRun) {
  runMigrateSp4()
    .then((stats) => {
      console.log('SP-4 backfill complete:');
      console.log(JSON.stringify(stats, null, 2));
      return getPrisma().$disconnect();
    })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('SP-4 backfill failed:', err);
      process.exit(1);
    });
}
