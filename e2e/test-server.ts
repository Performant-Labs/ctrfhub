import { buildApp } from '../src/app.js';
import { Eta } from 'eta';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, '..', '.e2e-test.db');
if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

const app = await buildApp({ testing: true, db: dbPath });

const eta = new Eta({
  views: path.resolve(__dirname, '..', 'src', 'views'),
  cache: false,
});

app.get('/', { config: { skipAuth: true } }, async (_request, reply) => {
  const homeHtml = eta.render('pages/home', { title: 'CTRFHub' });
  return reply.type('text/html').send(`<!DOCTYPE html>
<html lang="en" class="bg-[--color-surface] text-slate-100">
<head><meta charset="UTF-8"><meta name="viewport" content="width=1280"><title>CTRFHub</title>
<link rel="stylesheet" href="/assets/tailwind.css">
<script src="/assets/htmx.min.js"></script><script src="/assets/idiomorph-ext.min.js"></script>
<script defer src="/assets/alpine.min.js"></script><script src="/assets/flowbite.min.js"></script>
<script type="module" src="/assets/app.js"></script>
</head><body hx-ext="morph" class="min-h-screen">${homeHtml}</body></html>`);
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

const verifyRes = await app.inject({ method: 'GET', url: '/' });
console.log('Home page status:', verifyRes.statusCode, verifyRes.body.substring(0, 80));

await app.listen({ port: 3000, host: '127.0.0.1' });
console.log('E2E test server listening on http://127.0.0.1:3000');