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

# Copy package manifests first for layer-cache efficiency
COPY package.json package-lock.json ./

# Install all dependencies (including devDeps for tsc, tailwind CLI, etc.)
RUN npm ci

# Copy the rest of the source tree
COPY . .

# 1. Compile TypeScript → dist/
RUN npx tsc

# 2. Build and minify Tailwind CSS → dist/assets/tailwind.css
#    The assets directory must exist in dist/ for @fastify/static to serve it.
RUN mkdir -p dist/assets && \
    npx @tailwindcss/cli \
      -i src/assets/input.css \
      -o dist/assets/tailwind.css \
      --minify

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
RUN apk add --no-cache python3 make g++ && \
    npm ci --omit=dev && \
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
