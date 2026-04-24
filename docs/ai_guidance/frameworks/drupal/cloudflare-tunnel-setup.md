# Cloudflare Tunnel — local.performantlabs.com

> **Public URL:** `https://local.performantlabs.com`
> **Origin:** DDEV project `pl-performantlabs.com.2` (Drupal 11)
> **Tunnel name:** `pl2-local`
> **Date configured:** 2026-04-20

## Overview

A Cloudflare tunnel exposes the local DDEV development site
`pl-performantlabs.com.2` to the public internet via
`https://local.performantlabs.com`. This allows external collaborators,
devices, and services to reach the local Drupal site without port forwarding
or a static IP.

## Architecture

```
Browser
  │  GET https://local.performantlabs.com/…
  ▼
Cloudflare Edge
  │  Terminates TLS, injects CF-Visitor / CF-Connecting-IP headers
  ▼
cloudflared (local daemon)
  │  Rewrites Host header → pl-performantlabs.com.2.ddev.site
  │  Forwards to https://pl-performantlabs.com.2.ddev.site:8493
  ▼
DDEV traefik → nginx → PHP-FPM
  │  index.php detects CF-Visitor header, rewrites $_SERVER['HTTP_HOST']
  │  back to local.performantlabs.com before Symfony reads it
  ▼
Drupal 11  →  Response with correct public URLs
```

## Files Involved

### 1. `~/.cloudflared/config.yml`

The tunnel daemon configuration. Lives **outside** the project directory.

```yaml
tunnel: pl2-local
credentials-file: /Users/andreangelantoni/.cloudflared/5ac51e3b-cb34-4c3a-8b93-e11cf956df23.json
ingress:
  - hostname: local.performantlabs.com
    service: https://pl-performantlabs.com.2.ddev.site:8493
    originRequest:
      httpHostHeader: pl-performantlabs.com.2.ddev.site
      noTLSVerify: true
  - service: http_status:404
```

| Key | Purpose |
|-----|---------|
| `service` | Points to the DDEV site's HTTPS endpoint (port from `ddev describe`) |
| `httpHostHeader` | Overrides the `Host:` header sent upstream so DDEV's nginx can route the request to the correct vhost |
| `noTLSVerify` | Accepts DDEV's self-signed certificate |

### 2. `web/index.php` — Host header rewrite (the critical fix)

```php
// Cloudflare tunnel: rewrite HTTP_HOST before Symfony reads $_SERVER.
if (!empty($_SERVER['HTTP_CF_VISITOR']) &&
    !empty($_SERVER['HTTP_HOST']) &&
    str_contains($_SERVER['HTTP_HOST'], '.ddev.site')) {
  $_SERVER['HTTP_HOST']   = 'local.performantlabs.com';
  $_SERVER['SERVER_NAME'] = 'local.performantlabs.com';
  $_SERVER['HTTPS']       = 'on';
  $_SERVER['SERVER_PORT'] = '443';
}
```

**Why this is in index.php and not settings.php:**

Drupal's bootstrap sequence is:

1. `index.php` loads the autoloader
2. `index.php` creates `DrupalKernel`
3. **`Request::createFromGlobals()`** — captures `$_SERVER` into an immutable Symfony Request object
4. `$kernel->handle($request)` — boots Drupal, loads `settings.php`

Because `settings.php` runs at step 4 — after the Request is already built at
step 3 — any `$_SERVER` overrides there are too late to affect redirects and
URL generation. The override **must** happen before `Request::createFromGlobals()`.

### 3. `web/sites/default/settings.php` — Trusted hosts & backup override

```php
$settings['trusted_host_patterns'] = [
  '^.+\.ddev\.site$',
  '^127\.0\.0\.1$',
  '^local\.performantlabs\.com$',   // ← must be listed
];

// Backup: sets $base_url for subsystems that use it directly.
if (!empty($_SERVER['HTTP_CF_VISITOR']) &&
    !empty($_SERVER['HTTP_HOST']) &&
    strpos($_SERVER['HTTP_HOST'], '.ddev.site') !== FALSE) {
  $base_url = 'https://local.performantlabs.com';
  $_SERVER['HTTP_HOST'] = 'local.performantlabs.com';
  $_SERVER['HTTPS'] = 'on';
}
```

## Operations

### Starting the tunnel

```bash
cloudflared tunnel --config ~/.cloudflared/config.yml run pl2-local
```

Or run in the background:

```bash
cloudflared tunnel --config ~/.cloudflared/config.yml run pl2-local \
  > /tmp/cloudflared-pl2.log 2>&1 &
```

### Stopping the tunnel

```bash
pkill -f "cloudflared.*pl2-local"
```

### Verifying the tunnel

```bash
# Check connections are registered
tail -5 /tmp/cloudflared-pl2.log | grep "Registered"

# Test homepage
curl -sk -o /dev/null -w "HTTP %{http_code}\n" https://local.performantlabs.com/

# Verify redirects stay on the public hostname (not .ddev.site)
curl -s -D - -o /dev/null https://local.performantlabs.com/node/1 2>&1 | grep "location:"

# Verify canonical URL in HTML
curl -sk https://local.performantlabs.com/ | grep -o 'rel="canonical" href="[^"]*"'
```

### DDEV port changes

DDEV assigns **dynamic host-mapped ports** on each restart. The HTTPS port
(currently `8493`) is configured in `.ddev/config.yaml` as a router port and
is stable. If it ever changes:

1. Run `ddev describe` to find the new port.
2. Update `~/.cloudflared/config.yml` → `service:` URL with the new port.
3. Restart the tunnel.

## Troubleshooting

### Symptom: 301 redirects point to `.ddev.site`

The `index.php` override is missing or not running. Check:

```bash
curl -s -D - -o /dev/null https://local.performantlabs.com/node/1 2>&1 | grep "location:"
```

If the `location:` header contains `.ddev.site`, verify
`web/index.php` has the CF-Visitor detection block **before**
`Request::createFromGlobals()`.

### Symptom: 502 Bad Gateway

The DDEV site is down or the port changed.

```bash
ddev describe   # Check the site is running and note the HTTPS port
```

### Symptom: 404 on all pages (including homepage)

If the `httpHostHeader` is removed from the tunnel config, DDEV's nginx
receives `local.performantlabs.com` as the Host and has no matching vhost.
The `httpHostHeader` directive is **required** so nginx routes the request.

### Symptom: Tunnel won't start / "tunnel not found"

The tunnel must be registered in the Cloudflare dashboard under
`performantlabs.com` → Access → Tunnels. The credentials file
(`5ac51e3b-…-…json`) must exist in `~/.cloudflared/`.

## DNS

The `local.performantlabs.com` CNAME record is managed by Cloudflare and
points to the tunnel's `.cfargotunnel.com` ingress. This was configured in the
Cloudflare dashboard, not locally.
