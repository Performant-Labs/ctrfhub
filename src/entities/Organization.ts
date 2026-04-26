/**
 * Organization entity — top-level tenant boundary.
 *
 * **CTRFHub-owned.** This table's DDL is managed by MikroORM's schema-generator
 * (`orm.schema.update()`), not by Better Auth. The `organization` table was
 * originally planned as a Better Auth `organization` plugin table, but the
 * INFRA-005 pivot moved it to be schema-generator-managed so that FK
 * relationships to `projects` are created in the correct topological order.
 *
 * All data in the system belongs to an organization. Projects, users, and
 * settings are scoped to a single org.
 *
 * @see docs/planning/database-design.md §4.1
 * @see skills/mikroorm-dual-dialect.md
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
