---
name: artifact-security-and-serving
description: Security rules for user-uploaded artifacts — CSP sandbox, Content-Disposition, magic-bytes validation, rate limits, iframe sandbox, and the ARTIFACT_PUBLIC_URL isolation pattern.
trigger: implementing artifact upload; implementing GET /api/files/*; serving HTML reports; rendering Playwright traces or video artifacts in the UI
source: docs/planning/architecture.md §Artifact file serving, §Content Security Policy, §Artifact-response CSP, §Iframe sandbox; docs/planning/product.md §Feature 4 Acceptance criteria, §Security
---

## Rule

User-uploaded artifacts are treated as adversarial content; HTML and SVG artifacts download by default (never render inline); all files are magic-bytes validated against their claimed MIME type at ingest; `GET /api/files/*` returns strict isolation headers; Playwright HTML reports and `text/html` attachments render in an opaque-origin iframe without `allow-same-origin`; the per-user file-serving rate limit is 300 req/min.

## Why

User-uploaded artifacts can contain malicious HTML, SVG, or JavaScript. If a script inside a Playwright HTML report could read `document.cookie` or call `fetch('/api/v1/…')` with the user's session, an attacker could exfiltrate data by uploading a malicious report. The iframe `sandbox` without `allow-same-origin` makes the report run in an opaque origin — cookies and session are invisible to report scripts.

These rules are specified in `architecture.md §Content Security Policy`, `§Artifact-response CSP`, `§Iframe sandbox for user-content HTML`, and `product.md §Security`.

## How to apply

### At ingest — validate before storing:

1. Read the first 12 bytes of each artifact file and validate against the `file-type` library's magic number list.
2. Reject any file whose claimed `Content-Type` does not match the magic bytes — return 422.
3. Validate that the `attachment.path` value in CTRF JSON matches the file part name exactly (no path traversal).

### Per-file size limits (return 413 when exceeded):

| File type | Limit |
|---|---|
| Images (`image/*`) | 10 MB |
| Video (`video/*`) | 100 MB |
| ZIP archives | 200 MB |
| Logs (`text/plain`) | 5 MB |

Per-run total: `MAX_ARTIFACT_SIZE_PER_RUN` env var (default 1 GB).

### Serving headers (all responses from `GET /api/files/*`):

```
X-Content-Type-Options: nosniff
Cross-Origin-Resource-Policy: same-site         (or 'cross-origin' if ARTIFACT_PUBLIC_URL is set)
Referrer-Policy: no-referrer
Cache-Control: private, max-age=300, immutable
```

### Content-Disposition rules:

- **Safe types (inline):** `image/png`, `image/jpeg`, `image/webp`, `image/gif`, `video/mp4`, `video/webm`, `audio/mpeg`, `audio/ogg`, `text/plain ≤ 500 KB` → `Content-Disposition: inline`
- **All other types including HTML, SVG, XML, PDF, archives** → `Content-Disposition: attachment; filename*=UTF-8''<sanitised>`
- Filename sanitisation: RFC 5987 encoding, strip `\r\n\0`, cap at 200 characters.

### HTML artifact rendering (Run Detail reports):

```html
<!-- ✅ Correct: sandbox WITHOUT allow-same-origin -->
<iframe
  src="/api/files/<storage-key>"
  sandbox="allow-scripts allow-forms allow-popups"
  class="w-full h-[600px] border-0">
</iframe>
<!-- allow-same-origin is intentionally absent — opaque origin blocks cookie/session access -->
```

### CSP for artifact responses (HTML only):

```
Content-Security-Policy: sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:
```

### Rate limit:

```typescript
// In global or per-route rate-limit config
{
  keyGenerator: (req) => req.session?.user?.id ?? req.ip,
  max: 300,
  timeWindow: 60_000,  // 300 req/min per session user
}
// S3/MinIO pre-signed URLs don't need this limit — they're single-use and expire in 1 hour
```

### S3-backed artifacts:

Return a pre-signed URL with 1-hour expiry — do not proxy the file through the app server. Include `Cross-Origin-Resource-Policy: cross-origin` on the redirect response.

## Bad example

```html
<!-- ❌ iframe with allow-same-origin — nullifies the sandbox -->
<iframe src="/api/files/report.html" sandbox="allow-scripts allow-same-origin">
  <!-- A script inside the report can now read document.cookie and call /api/v1/* as the user -->
</iframe>

<!-- ❌ Serving HTML inline without Content-Disposition: attachment -->
<!-- → browser renders the HTML, scripts run in the parent origin context -->
```

```typescript
// ❌ No magic-bytes validation — a PNG with a <script> payload gets stored
fastify.post('/api/v1/projects/:slug/runs', async (request, reply) => {
  const parts = request.parts();
  for await (const part of parts) {
    if (part.type === 'file') {
      await storage.store(key, part.file);  // no magic-bytes check — dangerous
    }
  }
});
```
