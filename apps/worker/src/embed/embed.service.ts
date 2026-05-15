import { Injectable, Logger } from '@nestjs/common';
import { getPrisma, Prisma } from '@ai-hot-news/db';
import { callEmbed } from './embed-client';
import { GroupService } from './group.service';

@Injectable()
export class EmbedService {
  private readonly logger = new Logger(EmbedService.name);

  constructor(private readonly groupService: GroupService) {}

  async run(hotNewsId: string): Promise<void> {
    const prisma = getPrisma();
    const row = await prisma.hotNews.findUnique({
      where: { id: hotNewsId },
      select: {
        id: true,
        title: true,
        titleZh: true,
        summary: true,
        status: true,
      },
    });
    if (!row) {
      this.logger.warn(`Row ${hotNewsId} not found, skip`);
      return;
    }
    if (row.status !== 'VISIBLE' || !row.summary) {
      this.logger.log(
        `embed skip ${hotNewsId} (status=${row.status}, hasSummary=${!!row.summary})`,
      );
      return;
    }

    const input = `${row.titleZh ?? row.title}\n${row.summary}`;
    const result = await callEmbed(input);

    // pgvector cast: Postgres accepts a string literal like '[0.1,0.2,...]'
    // and `::vector(2048)` coerces it. Prisma binds the literal as text;
    // the cast happens server-side. Dim must match schema.prisma's
    // `Unsupported("vector(2048)")` (see SP-7-A v3 ADR / EMBED_DIM_DEFAULT).
    const literal = `[${result.vector.join(',')}]`;
    await prisma.$executeRaw(
      Prisma.sql`UPDATE hot_news SET embedding = ${literal}::vector(2048) WHERE id = ${hotNewsId}`,
    );

    const { groupId, cosine } = await this.groupService.assignGroup(hotNewsId);
    this.logger.log(
      `embed ${hotNewsId} → ${result.tokensIn} tokens (${result.durationMs}ms), group=${groupId ?? 'singleton'}${groupId ? ` cosine=${cosine.toFixed(3)}` : ''}`,
    );
  }
}
