/**
 * Project entity — a single application or site under test.
 *
 * One organization can own many projects. Projects are the primary
 * scope boundary for test runs, tokens, and settings.
 *
 * CTRFHub-owned: this table IS created by CTRFHub migrations.
 *
 * @see docs/planning/database-design.md §4.2
 * @see skills/mikroorm-dual-dialect.md — portable types only
 */

import { defineEntity, p } from '@mikro-orm/core';
import { OrganizationSchema } from './Organization.js';

const ProjectSchema = defineEntity({
  name: 'Project',
  tableName: 'projects',
  properties: {
    id:             p.integer().primary(),
    organization:   () => p.manyToOne(OrganizationSchema),
    name:           p.string().length(255),
    slug:           p.string().length(100),
    idPrefix:       p.string().length(10).default(''),
    baseUrl:        p.string().length(500).nullable(),
    retentionDays:  p.integer().nullable(),
    settings:       p.json().default('{}'),
    createdAt:      p.datetime().defaultRaw('CURRENT_TIMESTAMP'),
    updatedAt:      p.datetime().defaultRaw('CURRENT_TIMESTAMP'),
  },
});

/**
 * Project entity class.
 *
 * Domain methods can be added here as needed by downstream stories.
 */
export class Project extends ProjectSchema.class {}
ProjectSchema.setClass(Project);

export { ProjectSchema };
