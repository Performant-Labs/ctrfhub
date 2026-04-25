/**
 * Entity barrel export — re-exports all MikroORM entities and their schemas.
 *
 * Import entities and schemas from this module rather than from individual
 * entity files to keep import paths short and consistent.
 *
 * @example
 * ```typescript
 * import { Project, TestRun, TestRunSchema } from '../entities/index.js';
 * ```
 */

export { Organization, OrganizationSchema } from './Organization.js';
export { User, UserSchema } from './User.js';
export { Project, ProjectSchema } from './Project.js';
export { TestRun, TestRunSchema } from './TestRun.js';
export { TestResult, TestResultSchema } from './TestResult.js';
export { TestArtifact, TestArtifactSchema } from './TestArtifact.js';
