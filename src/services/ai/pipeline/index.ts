/**
 * AI Pipeline barrel exports.
 *
 * Single import point for the pipeline services used by `src/app.ts`
 * and integration tests.
 *
 * @see skills/ai-pipeline-event-bus.md
 */

export { categorizeRun } from './categorizer.js';
export { recoverStalePipelineRows } from './recovery.js';
export { isAiCloudPipelineConsented } from './consent.js';
export { CategorizeOutputSchema, AiCategoryEnum } from './schemas.js';
export type { ValidatedCategorizeOutput } from './schemas.js';
