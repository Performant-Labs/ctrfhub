/**
 * AI Pipeline barrel exports.
 *
 * Single import point for the pipeline services used by `src/app.ts`
 * and integration tests.
 *
 * @see skills/ai-pipeline-event-bus.md
 */

export { categorizeRun } from './categorizer.js';
export { correlateRootCauses } from './correlator.js';
export { generateSummary } from './summarizer.js';
export { startSweeper } from './sweeper.js';
export { recoverStalePipelineRows } from './recovery.js';
export { isAiCloudPipelineConsented } from './consent.js';
export {
  CategorizeOutputSchema,
  CorrelateOutputSchema,
  SummaryOutputSchema,
  AiCategoryEnum,
} from './schemas.js';
export type {
  ValidatedCategorizeOutput,
  ValidatedCorrelateOutput,
  ValidatedSummaryOutput,
} from './schemas.js';
