import type { HeatService } from './heat.service';

export interface HeatJobData {
  hotNewsId: string;
}

export async function processHeatJob(
  data: HeatJobData,
  service: Pick<HeatService, 'run'>,
): Promise<void> {
  if (!data.hotNewsId) {
    throw new Error('processHeatJob: hotNewsId required');
  }
  await service.run(data.hotNewsId);
}
