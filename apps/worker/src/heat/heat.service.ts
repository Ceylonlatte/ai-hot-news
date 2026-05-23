import { Logger } from '@nestjs/common';
import { getPrisma, Prisma, type Platform } from '@ai-hot-news/db';
import { interactionSignal } from './interaction-signal';
import type { HeatConfig } from './heat.config';

export interface HeatComputeInput {
  sourcePlatform: Platform;
  publishedAt: Date;
  interactionData: Prisma.JsonValue | null;
}

export interface HeatComputeResult {
  /** SP-6 V1 公式 = time × 0.25 + interaction × 0.35 + source × 0.25 + cross × 0.15.
   *  RSS row → 0. 仍是 "近期 + 热门" 综合分，dashboard heatLevel BURST/HOT/NORMAL/LOW
   *  NTILE 重排基于此列。0-100 范围（V1 cross=0 实际上限 ~72.5）。*/
  heatScore: number;
  /** SP-6 follow-up (2026-05-23): "engagement-only" 分量，**不含 time decay**。
   *  = interaction × 0.35 + source × 0.25 + cross × 0.15.
   *  RSS row → 0. /news + /vault 的 ?sort=heat 用此列排序，让 ?range=7d/30d 下
   *  能看到真正"绝对热"的内容（而不被 48h 内的新文章主导）。
   *  范围 0-75（V1 cross=0 实际上限 ~60）。*/
  engagementScore: number;
}

export function computeHeatScore(
  row: HeatComputeInput,
  sourceWeight: number,
  now: Date,
  cfg: HeatConfig,
): HeatComputeResult {
  if (row.sourcePlatform === 'RSS') return { heatScore: 0, engagementScore: 0 };

  const ageHours = (now.getTime() - row.publishedAt.getTime()) / 3_600_000;
  const timeScore = Math.exp(-ageHours / cfg.decayTauHours) * 100;

  const interaction =
    row.interactionData != null &&
    typeof row.interactionData === 'object' &&
    !Array.isArray(row.interactionData)
      ? (row.interactionData as Record<string, unknown>)
      : null;
  const interactionScore = interactionSignal(row.sourcePlatform, interaction, cfg);

  const sourceScore = sourceWeight * 100;
  // SP-7 will populate this once pgvector cross-platform merging lands.
  const crossPlatformScore = 0;

  const engagementScore =
    interactionScore * 0.35 +
    sourceScore * 0.25 +
    crossPlatformScore * 0.15;

  const heatScore = timeScore * 0.25 + engagementScore;

  return { heatScore, engagementScore };
}

export class HeatService {
  private readonly logger = new Logger(HeatService.name);

  constructor(private readonly cfg: HeatConfig) {}

  async run(hotNewsId: string): Promise<void> {
    const prisma = getPrisma();
    const row = await prisma.hotNews.findUnique({
      where: { id: hotNewsId },
      select: { sourcePlatform: true, publishedAt: true, interactionData: true },
    });
    if (!row) {
      this.logger.warn(`HeatService.run: row not found for id=${hotNewsId}`);
      return;
    }

    // V1: HotNews has no sourceConfigId FK, so we look up the platform's first
    // enabled SourceConfig and read its `weight`. All rows of the same platform
    // share the same weight in V1 (spec §0 Q6 ships 0.5 for everyone anyway).
    // V2 follow-up: thread sourceConfigId through ingestion + JOIN per-source.
    const sourceConfig = await prisma.sourceConfig.findFirst({
      where: { platform: row.sourcePlatform, enabled: true },
      select: { weight: true },
    });
    const sourceWeight = sourceConfig?.weight ?? 0.5;

    const { heatScore, engagementScore } = computeHeatScore(
      row,
      sourceWeight,
      new Date(),
      this.cfg,
    );

    await prisma.hotNews.update({
      where: { id: hotNewsId },
      data: { heatScore, engagementScore },
    });
  }
}
