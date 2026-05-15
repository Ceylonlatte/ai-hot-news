import { EmbedService } from './embed.service';

export interface EmbedJobData {
  hotNewsId: string;
}

export async function processEmbedJob(
  data: EmbedJobData,
  service: EmbedService,
): Promise<void> {
  await service.run(data.hotNewsId);
}
