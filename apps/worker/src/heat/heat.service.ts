import { Logger } from '@nestjs/common';
import { getPrisma, Prisma, type Platform } from '@ai-hot-news/db';
import { interactionSignal } from './interaction-signal';
import type { HeatConfig } from './heat.config';

export interface HeatComputeInput {
  sourcePlatform: Platform;
  publishedAt: Date;
  interactionData: Prisma.JsonValue | null;
}

export function computeHeatScore(
  row: HeatComputeInput,
  sourceWeight: number,
  now: Date,
  cfg: HeatConfig,
): number {
  if (row.sourcePlatform === 'RSS') return 0;

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

  return (
    timeScore * 0.25 +
    interactionScore * 0.35 +
    sourceScore * 0.25 +
    crossPlatformScore * 0.15
  );
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

    const score = computeHeatScore(row, sourceWeight, new Date(), this.cfg);

    await prisma.hotNews.update({
      where: { id: hotNewsId },
      data: { heatScore: score },
    });
  }
}
