/**
 * Organization entity — top-level tenant boundary.
 *
 * **Better Auth managed.** This table is created and maintained by Better Auth's
 * `organization` plugin. CTRFHub defines this entity for ORM relationship
 * mapping only — CTRFHub migrations MUST NOT create or alter this table.
 * The `schemaGenerator.skipTables` config excludes it from migration generation.
 *
 * All data in the system belongs to an organization. Projects, users, and
 * settings are scoped to a single org.
 *
 * @see docs/planning/database-design.md §4.1
 * @see skills/better-auth-session-and-api-tokens.md
 */

import { defineEntity, p } from '@mikro-orm/core';

/**
 * Schema definition for the Organization entity.
 *
 * Column names follow the Better Auth convention (camelCase in JS,
 * snake_case in DB). Only fields that CTRFHub reads or writes are
 * declared here — Better Auth may have additional columns.
 */
const OrganizationSchema = defineEntity({
  name: 'Organization',
  tableName: 'organization',
  properties: {
    id:        p.string().primary(),
    name:      p.string().length(255),
    slug:      p.string().length(100),
    logo:      p.string().length(500).nullable(),
    metadata:  p.json().nullable(),
    createdAt: p.datetime(),
  },
});

/**
 * Organization entity class.
 *
 * Domain methods can be added here as needed by downstream stories.
 */
export class Organization extends OrganizationSchema.class {}
OrganizationSchema.setClass(Organization);

export { OrganizationSchema };
