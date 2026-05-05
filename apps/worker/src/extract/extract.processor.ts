import { ExtractService } from './extract.service';

export interface ExtractJobData {
  hotNewsId: string;
}

export async function processExtractJob(
  data: ExtractJobData,
  service: ExtractService,
): Promise<void> {
  await service.run(data.hotNewsId);
}
