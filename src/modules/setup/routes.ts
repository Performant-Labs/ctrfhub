/**
 * Setup wizard routes — `GET /setup`, `POST /setup/step/{1..4}`.
 *
 * The setup wizard is the first-boot experience: 4 steps that bootstrap
 * the admin account, organization, first project, and CI/CD configuration.
 * Each step commits independently for crash-resumability.
 *
 * @see skills/fastify-route-convention.md — plugin pattern
 * @see skills/zod-schema-first.md — Zod schemas in schemas.ts
 * @see skills/better-auth-session-and-api-tokens.md §Setup wizard
 */

import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import {
  SetupStep1Schema,
  SetupStep2Schema,
  SetupStep3Schema,
} from './schemas.js';
import { SetupService } from './service.js';
import { User, Organization, Project } from '../../entities/index.js';
import type { AuthInstance } from '../../auth.js';

// ---------------------------------------------------------------------------
// CI/CD snippet templates (static — swapped client-side by framework)
// ---------------------------------------------------------------------------

function ciSnippets(token: string, projectSlug: string): Record<string, string> {
  const baseUrl = process.env['BETTER_AUTH_URL'] ?? 'http://localhost:3000';
  const endpoint = `${baseUrl}/api/v1/projects/${projectSlug}/runs`;

  return {
    'github-actions': `# .github/workflows/ctrf-report.yml
name: CTRF Report
on: [push]
jobs:
  test-and-report:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npx playwright test
      - name: Upload CTRF report
        if: always()
        uses: ctrf-io/github-actions-ctrf@v1
        with:
          ctrf-url: '${endpoint}'
          ctrf-token: \${{ secrets.CTRFHUB_API_TOKEN }}`,

    'gitlab-ci': `# .gitlab-ci.yml
test-and-report:
  image: mcr.microsoft.com/playwright:latest
  script:
    - npx playwright test
  after_script:
    - |
      curl -X POST '${endpoint}' \\
        -H 'x-api-token: \${CTRFHUB_API_TOKEN}' \\
        -H 'Content-Type: application/json' \\
        -d @ctrf/ctrf-report.json`,

    'circleci': `# .circleci/config.yml
version: 2.1
jobs:
  test-and-report:
    docker:
      - image: cimg/node:22.0
    steps:
      - checkout
      - run: npx playwright test
      - run: |
          curl -X POST '${endpoint}' \\
            -H 'x-api-token: \${CTRFHUB_API_TOKEN}' \\
            -H 'Content-Type: application/json' \\
            -d @ctrf/ctrf-report.json`,

    jenkins: `// Jenkinsfile
pipeline {
  agent any
  stages {
    stage('Test') {
      steps {
        sh 'npx playwright test'
      }
    }
  }
  post {
    always {
      sh """
        curl -X POST '${endpoint}' \\
          -H 'x-api-token: ${token}' \\
          -H 'Content-Type: application/json' \\
          -d @ctrf/ctrf-report.json
      """
    }
  }
}`,

    curl: `# Manual upload via curl
curl -X POST '${endpoint}' \\
  -H 'x-api-token: ${token}' \\
  -H 'Content-Type: application/json' \\
  -d @ctrf/ctrf-report.json`,
  };
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

const setupPlugin: FastifyPluginAsync = async (fastify) => {
  const service = new SetupService();

  // -----------------------------------------------------------------------
  // GET /setup — render the wizard at the current step
  // -----------------------------------------------------------------------

  fastify.get('/setup', {
    config: { skipAuth: true },
  }, async (request, reply) => {
    const state = await service.getSetupState(request.em);

    if (state.currentStep === 0) {
      return reply.status(410).send('Setup is complete. This route is no longer available.');
    }

    return reply.view('pages/setup', {
      currentStep: state.currentStep,
      title: 'Setup — CTRFHub',
      apiToken: state.apiToken,
      projectSlug: state.projectSlug,
      orgSlug: state.orgSlug,
    });
  });

  // -----------------------------------------------------------------------
  // POST /setup/step/1 — Create admin account
  // -----------------------------------------------------------------------

  fastify.post('/setup/step/1', {
    config: { skipAuth: true },
  }, async (request, reply) => {
    const parseResult = SetupStep1Schema.safeParse(request.body);
    if (!parseResult.success) {
      return renderSetupError(reply, 'Invalid input. Please check your email, password, and display name.');
    }

    const data = parseResult.data;

    const userCount = await request.em.count(User);
    if (userCount > 0) {
      return renderSetupError(reply, 'An admin account already exists. Setup cannot be restarted.');
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const auth = (fastify as any).auth as AuthInstance;
      const { sessionToken } = await service.createAdminUser(auth, data);

      reply.header('Set-Cookie', `better-auth.session_token=${sessionToken}; Path=/; HttpOnly; SameSite=Lax`);

      return reply.view('partials/setup-card', { currentStep: 2 });
    } catch (err) {
      fastify.log.error({ err }, 'Failed to create admin account');
      const message = err instanceof Error ? err.message : 'Failed to create admin account';
      return renderSetupError(reply, message);
    }
  });

  // -----------------------------------------------------------------------
  // POST /setup/step/2 — Create organization
  // -----------------------------------------------------------------------

  fastify.post('/setup/step/2', {
    config: { skipAuth: true },
  }, async (request, reply) => {
    const parseResult = SetupStep2Schema.safeParse(request.body);
    if (!parseResult.success) {
      return renderSetupError(reply, 'Invalid organization details.');
    }

    const data = parseResult.data;

    const userCount = await request.em.count(User);
    if (userCount === 0) {
      return renderSetupError(reply, 'No admin account found. Please complete step 1 first.');
    }
    const existingOrg = await request.em.findOne(Organization, {} as never);
    if (existingOrg) {
      return renderSetupError(reply, 'An organization already exists.');
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = await request.em.findOne(User, {} as never) as { id: string } | null;
    if (!user) {
      return renderSetupError(reply, 'Admin user not found.');
    }

    try {
      await service.createOrganization(request.em, user.id, data);

      return reply.view('partials/setup-card', { currentStep: 3 });
    } catch (err) {
      fastify.log.error({ err }, 'Failed to create organization');
      const message = err instanceof Error ? err.message : 'Failed to create organization';
      return renderSetupError(reply, message);
    }
  });

  // -----------------------------------------------------------------------
  // POST /setup/step/3 — Create first project + generate API token
  // -----------------------------------------------------------------------

  fastify.post('/setup/step/3', {
    config: { skipAuth: true },
  }, async (request, reply) => {
    const parseResult = SetupStep3Schema.safeParse(request.body);
    if (!parseResult.success) {
      return renderSetupError(reply, 'Invalid project details.');
    }

    const data = parseResult.data;

    const userCount = await request.em.count(User);
    if (userCount === 0) {
      return renderSetupError(reply, 'No admin account found. Please complete step 1 first.');
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const org = await request.em.findOne(Organization, {} as never) as { id: string; slug: string } | null;
    if (!org) {
      return renderSetupError(reply, 'No organization found. Please complete step 2 first.');
    }

    const existingProject = await request.em.findOne(Project, { organization: org.id } as never);
    if (existingProject) {
      return renderSetupError(reply, 'A project already exists.');
    }

    try {
      const project = await service.createFirstProject(request.em, org.id, data);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const auth = (fastify as any).auth as AuthInstance;
      const rawToken = await service.generateApiToken(auth, project.id as number, data.projectSlug);

      const snippets = ciSnippets(rawToken, data.projectSlug);

      return reply.view('partials/setup-card', {
        currentStep: 4,
        apiToken: rawToken,
        projectSlug: data.projectSlug,
        orgSlug: org.slug,
        snippets,
      });
    } catch (err) {
      fastify.log.error({ err }, 'Failed to create project or API token');
      const message = err instanceof Error ? err.message : 'Failed to create project';
      return renderSetupError(reply, message);
    }
  });

  // -----------------------------------------------------------------------
  // POST /setup/step/4 — Complete setup
  // -----------------------------------------------------------------------

  fastify.post('/setup/step/4', {
    config: { skipAuth: true },
  }, async (request, reply) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const org = await request.em.findOne(Organization, {} as never) as { id: string } | null;

      if (!org) {
        return renderSetupError(reply, 'No organization found.');
      }

      await service.completeSetup(request.em, org.id);

      reply.header('HX-Redirect', '/');
      return reply.status(200).send();
    } catch (err) {
      fastify.log.error({ err }, 'Failed to complete setup');
      const message = err instanceof Error ? err.message : 'Failed to complete setup';
      return renderSetupError(reply, message);
    }
  });
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderSetupError(reply: FastifyReply, message: string) {
  return reply.view('partials/setup-error', { error: message });
}

export default setupPlugin;
