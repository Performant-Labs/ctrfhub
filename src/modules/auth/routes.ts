/**
 * Auth module — `/api/auth/*` catch-all route.
 *
 * Delegates all Better Auth HTTP traffic to `auth.handler()`.
 * This route does NOT use ZodTypeProvider or the service-layer pattern
 * because Better Auth is itself the service — it owns the request/response
 * contract for authentication endpoints.
 *
 * Why this is the ONLY route that skips ZodTypeProvider:
 * Better Auth's handler is a black-box that accepts standard Fetch API
 * `Request` objects and returns standard `Response` objects. We construct
 * the Fetch `Request` from the Fastify request and copy the `Response`
 * headers/status/body back to the Fastify reply.
 *
 * Per `better-auth-session-and-api-tokens.md §Routes to always mark skipAuth`:
 * - `/api/auth/*` is in the global skipAuth allow-list
 * - `config: { skipAuth: true }` is required so the global preHandler
 *   does not try to authenticate the auth-handler's own requests
 *
 * @see skills/better-auth-session-and-api-tokens.md §Good example
 * @see skills/fastify-route-convention.md §Auth guard
 * @see https://www.better-auth.com/docs/integrations/fastify
 */

import type { FastifyInstance } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';
import type { AuthInstance } from '../../auth.js';

/**
 * Register the `/api/auth/*` catch-all route.
 *
 * @param fastify - The Fastify application instance.
 * @param auth   - The Better Auth instance (injected by `buildApp()`
 *                 so integration tests can use their own isolated instance).
 */
export async function registerAuthRoutes(
  fastify: FastifyInstance,
  auth: AuthInstance,
): Promise<void> {
  /**
   * Catch-all for all Better Auth HTTP endpoints.
   *
   * Accepts GET, POST, PUT, DELETE, and PATCH because Better Auth uses all
   * of these methods for its session, account, and api-key management endpoints.
   *
   * `config: { skipAuth: true }` bypasses the global auth preHandler —
   * Better Auth handles its own authentication for these endpoints.
   */
  fastify.route({
    method: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    url: '/api/auth/*',
    config: { skipAuth: true },

    async handler(request, reply) {
      try {
        // Build the full URL from the raw request.url (which is just the path)
        // and the host header. This gives Better Auth the full URL it needs
        // for redirect generation and CSRF checks.
        const url = new URL(request.url, `http://${request.headers.host}`);

        // `fromNodeHeaders` converts Node.js's IncomingMessage header object
        // (which Fastify exposes) into the standard Fetch API `Headers` object
        // that Better Auth expects.
        const headers = fromNodeHeaders(request.headers);

        // Build a Fetch API `Request`. Forward the body only when the method
        // has one — GET/HEAD requests must NOT have a body or some runtimes throw.
        const hasBody = !['GET', 'HEAD'].includes(request.method.toUpperCase());
        const fetchRequest = new Request(url.toString(), {
          method: request.method,
          headers,
          ...(hasBody && request.body != null
            ? { body: JSON.stringify(request.body) }
            : {}),
        });

        // Delegate to Better Auth's HTTP handler
        const response = await auth.handler(fetchRequest);

        // Copy status code
        reply.status(response.status);

        // Copy all response headers (Set-Cookie, Content-Type, etc.)
        response.headers.forEach((value, key) => {
          reply.header(key, value);
        });

        // Forward response body (null for 204 No Content, etc.)
        if (response.body) {
          return reply.send(await response.text());
        }
        return reply.send(null);
      } catch (error) {
        fastify.log.error({ err: error }, 'Better Auth handler error');
        return reply.status(500).send({
          error: 'Internal authentication error',
          code: 'AUTH_FAILURE',
        });
      }
    },
  });
}
