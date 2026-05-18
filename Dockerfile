# CTRFHub — Production Dockerfile
#
# Multi-stage build per docs/planning/architecture.md §Image build:
#   Stage 1 (builder): compile TypeScript → dist/, build Tailwind CSS
#   Stage 2 (runner):  copy dist/ + prod node_modules; no source, no devDeps
#
# better-sqlite3 is a native module compiled during `npm ci`.
# It is linked against the system's glibc/musl, so both stages must use
# the same base image version to avoid runtime linker mismatches.
#
# Build:
#   docker build -f Dockerfile -t ctrfhub:local .
#
# This file is owned by CI-001. Dockerfile.dev is owned by CI-002.

# ---------------------------------------------------------------------------
# Stage 1 — builder
# ---------------------------------------------------------------------------
FROM node:22-alpine AS builder

# Install native build toolchain needed by better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy the full source tree BEFORE `npm ci`.
# `npm ci` triggers the `postinstall` hook (scripts/copy-vendor-assets.mjs),
# which needs scripts/ and src/client/ present — so sources must already
# be in the image when install runs.
COPY . .

# Install all dependencies (including devDeps for tsc, tailwind CLI, etc.).
# The postinstall hook vendors client JS into src/assets/.
RUN npm ci

# 1. Compile TypeScript → dist/
RUN npx tsc

# 2. Build and minify Tailwind CSS → dist/assets/tailwind.css
#    The assets directory must exist in dist/ for @fastify/static to serve it.
RUN mkdir -p dist/assets && \
    npx @tailwindcss/cli \
      -i src/assets/input.css \
      -o dist/assets/tailwind.css \
      --minify

# 3. Bridge vendored client assets into dist/assets/.
#    postinstall (copy-vendor-assets.mjs) writes vendored JS into src/assets/,
#    but production serves static assets from dist/assets/ (src/app.ts §5).
#    Copy them across so htmx/alpine/flowbite/app.js resolve at runtime.
RUN cp -r src/assets/. dist/assets/

# ---------------------------------------------------------------------------
# Stage 2 — runner
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runner

# Install only the runtime native libs needed by better-sqlite3
# (python3/make/g++ are not needed — we copy the already-compiled .node file)
RUN apk add --no-cache wget

WORKDIR /app

# Copy package manifests (needed by npm to locate the deps)
COPY package.json package-lock.json ./

# Install production-only deps.
# This re-compiles better-sqlite3 native bindings for the runner image.
# Using the same alpine version as builder ensures ABI compatibility.
#
# --ignore-scripts: the `postinstall` hook (copy-vendor-assets.mjs) is a
# build-time step that needs scripts/ + src/client/ + esbuild (a devDep),
# none of which exist in the runner stage. The vendored assets it produces
# are already baked into dist/assets/ by the builder, so the runner must
# skip it. better-sqlite3's own install scripts run via the explicit
# `npm rebuild` below.
RUN apk add --no-cache python3 make g++ && \
    npm ci --omit=dev --ignore-scripts && \
    npm rebuild better-sqlite3 && \
    apk del python3 make g++

# Copy the compiled application from the builder stage
COPY --from=builder /app/dist ./dist

# Expose the application port (override with PORT env var at runtime)
EXPOSE 3000

# Health check — liveness probe that Docker Compose/orchestrators use
# to determine when the container is ready to serve traffic.
# --start-period gives the app time to run migrations before health checks begin.
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-3000}/health | grep -q '"status":"ok"' || exit 1

# Run the compiled entrypoint
CMD ["node", "dist/index.js"]
