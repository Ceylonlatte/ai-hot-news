import {
  SummarizationStrategy,
  StrategyRowInput,
  StrategyVerdict,
} from './strategy.interface';

export class SummarizeAllVisibleStrategy implements SummarizationStrategy {
  shouldSummarize(row: StrategyRowInput): StrategyVerdict {
    if (row.status !== 'VISIBLE') {
      return `skip:status_${row.status}` as StrategyVerdict;
    }
    return 'allow';
  }
}
