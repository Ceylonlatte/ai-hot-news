import { getPrisma } from './index';

/**
 * SP-10.5 (2026-05-21): hot_news + heat_history 数据生命周期管理。
 *
 * Dual-use:
 *  1. 一次性脚本（first-run on prod via scripts/run-prod-oneshot.sh）—
 *     entrypoint 在 packages/db/scripts/cleanup-aged.ts，调用本函数
 *  2. apps/worker `CleanupCronProcessor` 内 daily 调用（同函数体）
 *
 * 删除规则：
 *  - hot_news: publishedAt < now - `hotNewsDays` (default 30d) → DELETE
 *  - heat_history: bucketAt < now - `heatHistoryDays` (default 7d) → DELETE
 *
 * heat_history / keyword_hits 通过 schema `onDelete: Cascade` 自动级联，
 * 不需要手工跨表 DELETE。Step 3 单独清的是「hot_news 还活着但其 7-30d 区间
 * heat_history snapshot」—— 这些 snapshot 对 SP-11 详情页 72h 折线无价值，
 * 30d row 的 7d 之前 snapshot 是噪声。
 *
 * 幂等：同步骤重复执行返回 deleted=0，prefix-scoped tests 仍然可断言整数。
 */

export interface CleanupAgedOptions {
  hotNewsDays: number;
  heatHistoryDays: number;
  /** 仅 count 候选行，不删 — 一次性 prod 验证用 */
  dryRun?: boolean;
}

export interface CleanupAgedResult {
  /** Aged hot_news 实际删除数 */
  hotNewsDeleted: number;
  /** Aged hot_news 删除时随之 CASCADE 清理的 heat_history 行数（informational; pre-count） */
  heatHistoryCascaded: number;
  /**
   * 第二阶段单独清的 heat_history snapshot 数 —— hot_news 仍活着但 snapshot
   * 已超 heatHistoryDays。Note: Step 2 cascade-deleted heat_history 已不在
   * 表里，所以这个数字不会重复算它们。
   */
  heatHistoryAged: number;
}

export async function cleanupAged(opts: CleanupAgedOptions): Promise<CleanupAgedResult> {
  const prisma = getPrisma();
  const now = new Date();
  const hotNewsCutoff = new Date(now.getTime() - opts.hotNewsDays * 86_400_000);
  const heatHistoryCutoff = new Date(now.getTime() - opts.heatHistoryDays * 86_400_000);

  // Dry-run: 只数候选，不动数据。
  if (opts.dryRun) {
    const [hotCount, heatCount] = await prisma.$transaction([
      prisma.hotNews.count({ where: { publishedAt: { lt: hotNewsCutoff } } }),
      prisma.heatHistory.count({ where: { bucketAt: { lt: heatHistoryCutoff } } }),
    ]);
    return {
      hotNewsDeleted: hotCount,
      heatHistoryCascaded: 0,
      heatHistoryAged: heatCount,
    };
  }

  // Step 1: 预先 count 即将被 CASCADE 清掉的 heat_history（仅 logging 信息）。
  const cascadePreview = await prisma.heatHistory.count({
    where: { hotNews: { publishedAt: { lt: hotNewsCutoff } } },
  });

  // Step 2: 删 aged hot_news，CASCADE 自动清掉关联的 heat_history / keyword_hits。
  const hotDel = await prisma.hotNews.deleteMany({
    where: { publishedAt: { lt: hotNewsCutoff } },
  });

  // Step 3: 删 hot_news 还活着但 snapshot 太老的 heat_history 行。
  // Step 2 已经 CASCADE 清掉的 row 此时已不在表，count 不会重复。
  const heatDel = await prisma.heatHistory.deleteMany({
    where: { bucketAt: { lt: heatHistoryCutoff } },
  });

  return {
    hotNewsDeleted: hotDel.count,
    heatHistoryCascaded: cascadePreview,
    heatHistoryAged: heatDel.count,
  };
}
