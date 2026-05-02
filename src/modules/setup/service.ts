/**
 * Setup wizard service — business logic for the 4-step first-boot wizard
 * and the env-var seed path.
 *
 * Each step commits independently for crash-resumability. The service
 * receives an EntityManager fork (per-request or per-boot-em) and operates
 * at the business-logic level, never touching HTTP directly.
 *
 * @see skills/zod-schema-first.md — types derived from schemas
 * @see skills/better-auth-session-and-api-tokens.md §Setup wizard
 * @see skills/mikroorm-dual-dialect.md — portable types only
 */

import { MikroORM } from '@mikro-orm/core';
import { Organization, Project, User } from '../../entities/index.js';
import type { AuthInstance } from '../../auth.js';
import type { SetupStep1, SetupStep2, SetupStep3 } from './schemas.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The wizard step the user should see on GET /setup. 0 = all done (410). */
export type SetupState = {
  currentStep: 1 | 2 | 3 | 4 | 0;
  /** The raw API token shown once in step 4, if already generated. */
  apiToken?: string;
  /** Project slug for CI snippet URLs. */
  projectSlug?: string;
  /** Organization slug. */
  orgSlug?: string;
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class SetupService {
  // ───────────────────────────────────────────────────────────────────────
  // getSetupState — determine which step to show
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Determine the current setup state by inspecting what exists in the DB.
   *
   * Logic:
   * - 0 users → step 1
   * - user exists, no org → step 2
   * - user + org exist, no project → step 3
   * - user + org + project exist, not yet complete → step 4
   * - all complete → step 0 (410 Gone)
   */
  async getSetupState(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    em: any,
  ): Promise<SetupState> {
    const userCount = await em.count(User);
    if (userCount === 0) return { currentStep: 1 };

    const org = await em.findOne(Organization, {} as never) as Organization | null;
    if (!org) return { currentStep: 2 };

    const project = await em.findOne(Project, { organization: org.id } as never) as Project | null;
    if (!project) return { currentStep: 3 };

    const metadata = (org.metadata ?? {}) as Record<string, unknown>;
    if (!metadata['setupCompletedAt']) return { currentStep: 4 };

    return { currentStep: 0 };
  }

  // ───────────────────────────────────────────────────────────────────────
  // Step 1 — Create admin user via Better Auth
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Create the initial admin user through Better Auth's signUpEmail API.
   *
   * Returns the session token so the route handler can set the cookie
   * and authenticate the user for subsequent steps.
   */
  async createAdminUser(
    auth: AuthInstance,
    data: SetupStep1,
  ): Promise<{ userId: string; sessionToken: string }> {
    const result = await auth.api.signUpEmail({
      body: {
        email: data.email,
        password: data.password,
        name: data.displayName,
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const token = (result as any).token as string | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = (result as any).user as { id: string } | undefined;

    if (!user || !token) {
      throw new Error('Better Auth sign-up did not return user or token');
    }

    return { userId: user.id, sessionToken: token };
  }

  // ───────────────────────────────────────────────────────────────────────
  // Step 2 — Create organization
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Create the first organization and record the admin user in metadata.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async createOrganization(em: any, userId: string, data: SetupStep2): Promise<Organization> {
    const org = em.create(Organization, {
      id: crypto.randomUUID(),
      name: data.orgName,
      slug: data.orgSlug,
      metadata: { adminUserId: userId },
      createdAt: new Date(),
    });
    await em.persistAndFlush(org);
    return org as Organization;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Step 3 — Create first project
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Create the first project scoped to the organization.
   *
   * `id` is auto-increment (integer primary key) — MikroORM assigns it
   * automatically on flush. Do not assign the id manually.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async createFirstProject(em: any, orgId: string, data: SetupStep3): Promise<Project> {
    const project = em.create(Project, {
      organization: orgId,
      name: data.projectName,
      slug: data.projectSlug,
      baseUrl: null,
      retentionDays: null,
      settings: {},
    });
    await em.persistAndFlush(project);
    return project as Project;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Generate API Token (used in step 3, shown in step 4)
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Create a project-scoped API token via Better Auth's apiKey plugin.
   *
   * The raw key is returned here so it can be displayed to the admin
   * exactly once in step 4. Only the hash is stored by Better Auth.
   */
  async generateApiToken(
    auth: AuthInstance,
    projectId: number,
    projectSlug: string,
  ): Promise<string> {
    const result = await auth.api.createApiKey({
      body: {
        name: `CI token for ${projectSlug}`,
        metadata: { projectId },
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawKey = (result as any).key as string | undefined;
    if (!rawKey) {
      throw new Error('Better Auth did not return the raw API key');
    }

    return rawKey;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Step 4 — Complete setup
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Mark setup as complete by setting `setupCompletedAt` in the
   * organization's metadata JSON field.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async completeSetup(em: any, orgId: string): Promise<void> {
    const org = await em.findOne(Organization, orgId) as Organization | null;
    if (!org) throw new Error('Organization not found');

    const metadata = (org.metadata ?? {}) as Record<string, unknown>;
    org.metadata = { ...metadata, setupCompletedAt: new Date().toISOString() };
    await em.persistAndFlush(org);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Env-var seed
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Bootstrap from environment variables at app startup.
   *
   * When `CTRFHUB_INITIAL_ADMIN_EMAIL`, `CTRFHUB_INITIAL_ADMIN_PASSWORD`,
   * and `CTRFHUB_INITIAL_ORG_NAME` are all set AND the users table is
   * empty, this creates user + org + (optional) project.
   *
   * Note: Better Auth manages its own Kysely connection independently from
   * MikroORM, so we cannot wrap user creation in a MikroORM transaction.
   * The user is created first via Better Auth (auto-committed), then org
   * + project are created via MikroORM. If org/project creation fails,
   * the wizard resumes from step 2 — this is acceptable for the env-seed
   * path since a crash during seed is extremely rare.
   *
   * Returns `true` if seeding was performed, `false` if skipped.
   */
  async seedFromEnv(auth: AuthInstance, orm: MikroORM): Promise<boolean> {
    const email = process.env['CTRFHUB_INITIAL_ADMIN_EMAIL'];
    const password = process.env['CTRFHUB_INITIAL_ADMIN_PASSWORD'];
    const orgName = process.env['CTRFHUB_INITIAL_ORG_NAME'];

    if (!email || !password || !orgName) return false;

    const em = orm.em.fork();
    let userCount = 0;
    try {
      userCount = await em.count(User);
    } catch {
      return false;
    }
    if (userCount > 0) return false;

    const projectName = process.env['CTRFHUB_INITIAL_PROJECT_NAME'];
    const projectSlug = projectName
      ? projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      : undefined;

    // Step A: Create user via Better Auth (separate connection — auto-commits)
    await this.createAdminUser(auth, {
      email,
      password,
      displayName: email.split('@')[0] ?? 'Admin',
    });

    // Step B: Create organization + (optional) project via MikroORM
    const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

    try {
      await em.begin();

      const user = await em.findOne(User, { email }) as { id: string } | null;
      if (!user) {
        await em.rollback();
        return false;
      }

      await this.createOrganization(em, user.id, { orgName, orgSlug: slug });

      if (projectName && projectSlug) {
        const org = await em.findOne(Organization, { slug }) as Organization | null;
        if (org) {
          await this.createFirstProject(em, org.id, { projectName, projectSlug, description: '' });
          await this.completeSetup(em, org.id);
        }
      } else {
        const org = await em.findOne(Organization, { slug }) as Organization | null;
        if (org) {
          await this.completeSetup(em, org.id);
        }
      }

      await em.commit();
      return true;
    } catch (err) {
      await em.rollback();
      throw err;
    }
  }
}
