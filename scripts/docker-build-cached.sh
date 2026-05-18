#!/usr/bin/env bash
#
# docker-build-cached.sh — fast, cache-backed Docker build for F↔A iteration.
#
# Why this exists
# ---------------
# Each F↔A loop iteration re-runs `docker build`. A plain cold build is
# ~2–3 min on Uranus. This script uses two cooperating cache mechanisms:
#
#   1. A buildx LOCAL cache backend (--cache-from / --cache-to type=local).
#      Persists exported BuildKit layers to disk between builds.
#   2. The Dockerfile's `RUN --mount=type=cache,target=/root/.npm` mounts,
#      which persist npm's package cache inside the build (see Dockerfile).
#
# Together these bring a warm build (no source change) to well under 30s.
#
# Cache location
# --------------
#   Build cache dir : /tmp/ctrfhub-buildcache   (override with $CTRFHUB_BUILDCACHE_DIR)
# This is local-disk only — NO remote registry cache (single-host dev setup).
# Wipe it any time to force a fully cold build:  rm -rf /tmp/ctrfhub-buildcache
#
# Shared-host safety (Uranus)
# ---------------------------
# Uranus runs a live multi-container Coolify stack. This script ONLY:
#   - creates a dedicated, story-scoped buildx builder (ctrfhub-buildcache-builder)
#   - writes to its own /tmp cache dir and image tag
# It never stops/prunes/touches other containers, networks, or volumes.
# The `docker` driver (default builder) cannot export type=local cache, so a
# `docker-container`-driver builder is required; we create our own rather than
# disturbing the shared `default` builder.
#
# Usage
# -----
#   scripts/docker-build-cached.sh                # build, tag ctrfhub:local
#   scripts/docker-build-cached.sh my-tag:foo     # custom image tag
#   CTRFHUB_BUILDCACHE_DIR=/path ./scripts/docker-build-cached.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."

IMAGE_TAG="${1:-ctrfhub:local}"
CACHE_DIR="${CTRFHUB_BUILDCACHE_DIR:-/tmp/ctrfhub-buildcache}"
BUILDER_NAME="ctrfhub-buildcache-builder"
DOCKERFILE="Dockerfile"

mkdir -p "$CACHE_DIR"

# Ensure a story-scoped docker-container builder exists (required for
# type=local cache export — the default 'docker' driver cannot do it).
if ! docker buildx inspect "$BUILDER_NAME" >/dev/null 2>&1; then
  echo "==> Creating dedicated buildx builder: $BUILDER_NAME"
  docker buildx create --name "$BUILDER_NAME" --driver docker-container --bootstrap >/dev/null
fi

echo "==> Building $IMAGE_TAG"
echo "    builder:   $BUILDER_NAME"
echo "    cache dir: $CACHE_DIR"

BUILD_START=$(date +%s)

docker buildx build \
  --builder "$BUILDER_NAME" \
  -f "$DOCKERFILE" \
  --cache-from "type=local,src=$CACHE_DIR" \
  --cache-to "type=local,dest=$CACHE_DIR,mode=max" \
  --load \
  -t "$IMAGE_TAG" \
  .

BUILD_END=$(date +%s)
echo "==> Build complete in $(( BUILD_END - BUILD_START ))s — image: $IMAGE_TAG"
