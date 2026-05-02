import { buildApp } from '../src/app.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, '..', '.e2e-test.db');
if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

const app = await buildApp({ testing: true, db: dbPath });

await app.register(async (fastify) => {
  fastify.get('/__test__/home', {
    config: { skipAuth: true },
    schema: {},
  }, async (_request, reply) => reply.page('home', { title: 'CTRFHub' }));
});

const seedRes = await app.inject({
  method: 'POST',
  url: '/api/auth/sign-up/email',
  headers: { 'content-type': 'application/json' },
  payload: { email: 'e2e-test@example.com', password: 'P@ssw0rd!', name: 'E2E Tester' },
});
if (seedRes.statusCode >= 400) {
  console.error('Failed to create test user:', seedRes.body.substring(0, 200));
  process.exit(1);
}
console.log('E2E test user created');

const verifyRes = await app.inject({ method: 'GET', url: '/__test__/home' });
console.log('Home page status:', verifyRes.statusCode, verifyRes.body.substring(0, 80));

await app.listen({ port: 3000, host: '127.0.0.1' });
console.log('E2E test server listening on http://127.0.0.1:3000');