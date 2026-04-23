# Artifact origin isolation (optional)

**Audience:** operators who want GitHub-grade cookie-jar isolation for user-uploaded test artifacts.
**Prerequisite:** CTRFHub is already running behind a reverse proxy on its main origin.

This runbook covers the optional `ARTIFACT_PUBLIC_URL` deployment pattern described in DD-028 I2. Setting up a separate origin for artifacts is **not required** — the default same-origin deployment is secure for the MVP threat model (DD-028 I1 iframe sandbox + I3–I7 headers handle attacker-controllable artifact content). This runbook exists for operators who want the additional cookie-jar isolation layer that GitHub, GitLab, and Bitbucket all use for raw user content.

---

## What it buys you

When artifacts serve from the same origin as the main app:
- The CTRFHub session cookie is scoped to the main origin.
- DD-028 I1's opaque-origin iframe sandbox prevents report scripts from reading `document.cookie` anyway.
- The attacker needs to bypass the sandbox to touch the session. Opaque-origin sandboxes are a standardised browser primitive; bypasses would be significant browser bugs.

When artifacts serve from a separate origin (`artifacts.ctrfhub.example.com` vs. `ctrfhub.example.com`):
- The session cookie is domain-scoped to the main origin only.
- Even if an attacker broke out of the iframe sandbox entirely, they're on the artifact origin — a different cookie jar. The session cookie isn't reachable by `document.cookie` there.
- The artifact origin has no API routes. An artifact-origin XSS can fetch other artifacts (boring) but can't hit `/api/v1/admin/users`.

Defence in depth. Pick this pattern if:
- You're running CTRFHub in a shared/multi-tenant environment.
- You already run a reverse proxy that makes adding a subdomain cheap.
- You want to match the GitHub/GitLab isolation posture for org-wide security review.

---

## How it works

Set `ARTIFACT_PUBLIC_URL` in the CTRFHub environment:

```
ARTIFACT_PUBLIC_URL=https://artifacts.ctrfhub.example.com
```

Two things change:

1. **Rendered URLs.** When the app emits HTML referencing an artifact — an `<img>` for a screenshot, a `<video>` for a recording, an `<a>` for a download link, the iframe `src` for a report — it prefixes with `ARTIFACT_PUBLIC_URL` instead of the app's own origin.
2. **Response headers.** Artifact responses emit `Cross-Origin-Resource-Policy: cross-origin` instead of `same-site`, so the cross-origin fetch from the main app doesn't hit a CORP block.

CTRFHub itself does not bind additional ports or listeners — the `artifacts.` subdomain points at your reverse proxy, which routes `/api/files/*` and `/runs/*/report/*` to the same backend process.

---

## nginx snippet

Assumes you already have a server block for the main origin and TLS termination is handled upstream.

```nginx
# Main CTRFHub origin — unchanged
server {
    listen 443 ssl http2;
    server_name ctrfhub.example.com;

    ssl_certificate     /etc/letsencrypt/live/ctrfhub.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ctrfhub.example.com/privkey.pem;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Forwarded-For   $remote_addr;
        proxy_set_header   X-Forwarded-Proto https;
        proxy_set_header   X-Real-IP         $remote_addr;
    }
}

# Artifact origin — NEW
server {
    listen 443 ssl http2;
    server_name artifacts.ctrfhub.example.com;

    ssl_certificate     /etc/letsencrypt/live/artifacts.ctrfhub.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/artifacts.ctrfhub.example.com/privkey.pem;

    # Only serve artifact paths. Everything else 404s — this origin is not for UI.
    location ~ ^/(api/files|runs/[0-9]+/report)/ {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Forwarded-For   $remote_addr;
        proxy_set_header   X-Forwarded-Proto https;
        proxy_set_header   X-Real-IP         $remote_addr;

        # Range requests must pass through for the Playwright Trace Viewer.
        proxy_set_header   Range             $http_range;
        proxy_set_header   If-Range          $http_if_range;
    }

    location / {
        return 404;
    }
}
```

Session cookies are **not set on `artifacts.ctrfhub.example.com`** because Better Auth scopes cookies to the main origin domain (default behaviour). Verify with the browser devtools cookie inspector after a login — you should see the `better-auth.session_token` cookie on `ctrfhub.example.com` but not on `artifacts.ctrfhub.example.com`.

---

## Caddy snippet

```
ctrfhub.example.com {
    reverse_proxy 127.0.0.1:3000
}

artifacts.ctrfhub.example.com {
    @artifact path /api/files/* /runs/*/report/*
    handle @artifact {
        reverse_proxy 127.0.0.1:3000
    }
    handle {
        respond 404
    }
}
```

Caddy handles TLS cert issuance automatically for both names.

---

## DNS

Add an A/AAAA record (or CNAME) for the subdomain pointing at the same host as the main origin:

```
artifacts.ctrfhub.example.com.  IN  A  203.0.113.42
```

Same host, same port, different `Host` header → same backend process → different rendered-URL and cookie-jar scope.

---

## Verifying the setup

After setting `ARTIFACT_PUBLIC_URL` and redeploying:

1. Upload a run with a screenshot attachment.
2. Open the run detail page in the browser (main origin).
3. In devtools Network tab, find the screenshot request. Its URL should start with `https://artifacts.ctrfhub.example.com/api/files/…`.
4. In devtools Application → Cookies, confirm the session cookie appears only under `ctrfhub.example.com`, not under `artifacts.ctrfhub.example.com`.
5. Open a run with a Playwright HTML report attachment. Confirm the iframe `src` points at `https://artifacts.ctrfhub.example.com/runs/<id>/report/`.
6. Open the iframe URL directly in a new tab. The report should render but browser devtools Console (for the iframe's frame) should show no cookies when you run `document.cookie`.

If step 4 shows the session cookie on the artifacts subdomain, your proxy is likely forwarding cookies incorrectly — check that Better Auth's cookie `Domain` attribute is set to the main origin, not `.example.com`. Setting it to the apex defeats the whole point.

---

## When to unset `ARTIFACT_PUBLIC_URL`

- Downgrading from a multi-origin deployment back to single-origin: remove the env var, redeploy. Artifacts immediately start serving from the main origin; DD-028 I1's sandbox is still the primary defence.
- Reverse-proxy misconfiguration blocking artifact range requests from the Playwright Trace Viewer: debug first, but unsetting the var is a fast rollback if viewer functionality breaks in production.

---

## See also

- DD-028 — artifact XSS hardening (this runbook implements I2).
- DD-014 — artifact storage interface and CORS for the Trace Viewer (CORS is orthogonal to origin isolation; both co-exist).
- `deployment-architecture.md` → `ARTIFACT_PUBLIC_URL` env var.
