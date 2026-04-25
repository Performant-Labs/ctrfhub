/**
 * User entity — authenticated user identity.
 *
 * **Better Auth managed.** This table is created and maintained by Better Auth.
 * CTRFHub defines this entity for ORM relationship mapping only — CTRFHub
 * migrations MUST NOT create or alter this table. The `schemaGenerator.skipTables`
 * config excludes it from migration generation.
 *
 * The columns declared here match Better Auth's core user schema:
 * id, name, email, emailVerified, image, createdAt, updatedAt.
 *
 * @see docs/planning/database-design.md §4 (Better Auth note)
 * @see skills/better-auth-session-and-api-tokens.md §User Schema
 */

import { defineEntity, p } from '@mikro-orm/core';

/**
 * Schema definition for the User entity.
 *
 * Field names match Better Auth's default column naming. Only the fields
 * CTRFHub needs for relationships and display are declared here.
 * Better Auth may add additional columns (sessions, accounts, etc.)
 * via its own migrations.
 */
const UserSchema = defineEntity({
  name: 'User',
  tableName: 'user',
  properties: {
    id:            p.string().primary(),
    name:          p.string().length(255),
    email:         p.string().length(255),
    emailVerified: p.boolean().default(false),
    image:         p.string().length(500).nullable(),
    createdAt:     p.datetime(),
    updatedAt:     p.datetime(),
  },
});

/**
 * User entity class.
 *
 * Domain methods can be added here as needed by downstream stories.
 */
export class User extends UserSchema.class {}
UserSchema.setClass(User);

export { UserSchema };
