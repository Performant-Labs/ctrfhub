# Uranus Recon — CTRFHub Migration Readiness

**Date:** 2026-05-17 · **Recon by:** Code session on the Mac (read-only, nothing installed/changed)

## Host summary

| Property | Value |
|---|---|
| Hostname | `uranus` |
| OS | Ubuntu, kernel 6.8.0-90-generic, x86_64 |
| Uptime | 21 days, load avg ~0.5 |
| SSH login user | **`root`** (the `uranus` SSH alias logs in as root, `pwd` = `/root`) |
| Disk | Single `/dev/sda1`, 150 GB total, **84 GB free** (43% used) — `/home`, `/var`, `/tmp` all on it |
| Timezone | America/Boise (MDT, -0600) |
| Locale | `en_US.UTF-8` |
| Tailscale | Up — `uranus` = `100.66.126.125` (also has IPv6) |

This is André's heavily-used "Hermes" infra box: ~30 Docker containers running (Coolify, Mattermost, Harbor, Penpot, Jenkins, Phoenix, RustDesk, Uptime-Kuma, WAHA, open-webui, etc.).

---

## Already good

- **Docker 29.4.1** — installed, `systemctl is-active docker` = `active`. ✓
- **Docker Compose v5.1.3** — `docker compose` plugin present. ✓
- **git 2.43.0** — present. ✓
- **tmux 3.4** — present. ✓
- **rsync 3.2.7** (protocol 31) — present; matches the Mac side for `rsync`-based file pushes. ✓
- **Disk headroom** — 84 GB free is ample for the app image, Postgres volume, and artifact storage.
- **Port 3000 is free** — CTRFHub's default `PORT` (`compose.yml` / `compose.sqlite.yml`, `src/index.ts:16`). No host process listens on 3000. ✓
- **GitHub SSH reachable** — `ssh -T git@github.com` authenticates (see caveat under Decisions).
- **Tailscale connectivity** — uranus is on the tailnet, so the Mac and Cowork can reach it privately.

---

## Needs install / setup

### 1. Node.js 22 + npm — **not installed** (`node`/`npm`/`nvm` all "command not found")
CTRFHub's `package.json` requires `node >=22.0.0`; `.nvmrc` pins **22**.
- **Not required for a pure Docker deployment** — the published/built image bundles its own Node. Host Node is only needed for running migrations, scripts, or dev work directly on the box.
- If host Node is wanted (recommended for `mikro-orm` migration CLI / debugging):
  ```bash
  # nvm route (matches dev machines, honors .nvmrc)
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  source ~/.bashrc && nvm install 22 && nvm alias default 22
  # — OR — system-wide NodeSource
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs
  ```

### 2. `gh` CLI — **not installed**
Needed if we authenticate the CTRFHub repo clone via `gh` (see Decisions).
```bash
sudo apt-get update && sudo apt-get install -y gh   # or via the official keyring repo
gh auth login
```

### 3. `claude` CLI — **not installed**
Only needed if we want to run Claude Code sessions *on* uranus. Not required to run CTRFHub itself.
```bash
npm install -g @anthropic-ai/claude-code   # requires Node first
```

### 4. CTRFHub working tree / paths — **none exist**
`/home/aangel/CTRFHub`, `/home/aangel/Sites/ai_guidance`, and `/home/aangel/.claude` do **not** exist (checked under both `/home/aangel` and `/root`). A fresh checkout/transfer is needed wherever we decide CTRFHub should live.

### 5. Container image
`compose.yml` and `compose.sqlite.yml` both pull `ghcr.io/ctrfhub/ctrfhub:${CTRFHUB_TAG:-latest}`. The compose file's own comment says **this image does not exist yet** (CI-001's release job hasn't published it). We must either (a) wait for CI to publish it, or (b) build locally on uranus from the repo `Dockerfile` and retag. Docker is present, so building on uranus works.

---

## Decisions / open questions

1. **Raw `docker compose` vs. Coolify.** Uranus already runs **Coolify 4.0.0** (`coolify`, `coolify-db`, `coolify-redis`, `coolify-realtime` containers). Parking-lot item **PL-020** is explicitly "Coolify migration path." Decide: deploy CTRFHub as a standalone `docker compose` stack, or import it as a Coolify application. Coolify would also handle TLS/routing for us.

2. **Reverse proxy / TLS — ports 80, 443, 8080, 8443, 8000 are all taken** by existing `docker-proxy` listeners (likely Coolify's Traefik + others). CTRFHub on `3000` must sit behind whatever proxy already owns 80/443. Need: a vhost/domain, and `PUBLIC_URL` set accordingly. Open question: public domain vs. Tailscale-only access.

3. **GitHub auth for the source repo.** `ssh -T git@github.com` authenticates as **`Performant-Labs/uranus-infra`** — i.e. a *deploy key scoped to the `uranus-infra` repo only*. It will **not** grant access to the CTRFHub source repo. To clone CTRFHub we need one of: a CTRFHub-scoped deploy key, `gh auth login` with a PAT, or `rsync` the working tree from the Mac over Tailscale (no GitHub auth needed).

4. **Run-as user.** SSH lands as `root`. CTRFHub should not run as root. Decide: a dedicated service user, or the `aangel` account. Note `/home/aangel` already contains Hermes data with files owned by UID `10000` (a container UID-map) — don't co-mingle CTRFHub there without a clear subdirectory.

5. **`ai_guidance` origin.** `/home/aangel/Sites/ai_guidance` is absent. CLAUDE.md says org standards live there *on dev machines* and that the relevant rules are already inlined into `skills/` — so it's **not needed for the prod runtime**. Only fetch it if we plan to run implementer/reviewer agents on uranus.

6. **Postgres vs. SQLite deployment.** `compose.yml` (bundled Postgres 16) vs. `compose.sqlite.yml` (single container). Several Postgres containers already run on the box but are network-isolated per stack, so the bundled-Postgres path has no port conflict. Decide which target topology we want.

7. **`DEFAULT_TIMEZONE`.** Host TZ is America/Boise; CTRFHub defaults to `UTC`. Confirm desired `DEFAULT_TIMEZONE` env value.
