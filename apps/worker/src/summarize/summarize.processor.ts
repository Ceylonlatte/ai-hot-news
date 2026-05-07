import { SummarizeService } from './summarize.service';

export interface SummaryJobData {
  hotNewsId: string;
}

export async function processSummaryJob(
  data: SummaryJobData,
  service: SummarizeService,
): Promise<void> {
  await service.run(data.hotNewsId);
}
