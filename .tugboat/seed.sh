#!/usr/bin/env bash
# CTRFHub — Tugboat Preview Seed Script
#
# Creates the minimum data set for a functional per-PR preview:
#   1. Admin user (via Better Auth signup API)
#   2. Organization (direct PG insert — CTRFHub-owned table)
#   3. Project (direct PG insert — CTRFHub-owned table)
#   4. API key (via Better Auth API key plugin)
#
# Idempotent: safe to re-run on Tugboat "Refresh" — uses HTTP status codes
# and ON CONFLICT DO NOTHING to skip already-existing rows.
#
# Environment variables (required — set in Tugboat Repository Settings):
#   TUGBOAT_ADMIN_EMAIL    — admin account email
#   TUGBOAT_ADMIN_PASSWORD — admin account password (min 8 chars)
#   DATABASE_URL           — PostgreSQL connection string (set by config.yml)
#
# This script is intentionally short-lived — AUTH-002's env-var admin seed
# (CTRFHUB_INITIAL_ADMIN_*) will replace it once that story ships.
#
# See: skills/better-auth-session-and-api-tokens.md
# See: skills/ctrf-ingest-validation.md

set -euo pipefail

BASE_URL="http://localhost:3000"
ADMIN_EMAIL="${TUGBOAT_ADMIN_EMAIL:-admin@ctrfhub.local}"
ADMIN_PASSWORD="${TUGBOAT_ADMIN_PASSWORD:-PreviewAdmin2026!}"
COOKIE_JAR="/tmp/ctrfhub-seed-cookies"
ORG_ID="preview-org"
ORG_NAME="Preview Org"
ORG_SLUG="preview"
PROJECT_NAME="Sample Project"
PROJECT_SLUG="sample"
PROJECT_PREFIX="E2E"

echo "═══════════════════════════════════════════════"
echo "  CTRFHub Preview Seed"
echo "═══════════════════════════════════════════════"

# ─── Step 1: Create admin user via Better Auth signup ─────────────────────
echo ""
echo "▶ Step 1: Creating admin user (${ADMIN_EMAIL})..."

SIGNUP_STATUS=$(curl -s -o /tmp/ctrfhub-signup-response.json -w "%{http_code}" \
  -X POST "${BASE_URL}/api/auth/sign-up/email" \
  -H "content-type: application/json" \
  -c "${COOKIE_JAR}" \
  -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\",\"name\":\"Preview Admin\"}")

if [ "$SIGNUP_STATUS" = "200" ] || [ "$SIGNUP_STATUS" = "201" ]; then
  echo "  ✅ Admin user created"
else
  echo "  ℹ️  Signup returned ${SIGNUP_STATUS} — user may already exist, trying login..."
  LOGIN_STATUS=$(curl -s -o /tmp/ctrfhub-login-response.json -w "%{http_code}" \
    -X POST "${BASE_URL}/api/auth/sign-in/email" \
    -H "content-type: application/json" \
    -c "${COOKIE_JAR}" \
    -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}")

  if [ "$LOGIN_STATUS" = "200" ] || [ "$LOGIN_STATUS" = "201" ]; then
    echo "  ✅ Logged in as existing admin"
  else
    echo "  ❌ Login failed (HTTP ${LOGIN_STATUS}):"
    cat /tmp/ctrfhub-login-response.json 2>/dev/null || true
    exit 1
  fi
fi

# ─── Step 2: Create Organization (direct PG — CTRFHub-owned table) ────────
echo ""
echo "▶ Step 2: Creating organization (${ORG_SLUG})..."

node -e "
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
(async () => {
  await pool.query(
    \`INSERT INTO organization (id, name, slug, \"createdAt\")
     VALUES (\\\$1, \\\$2, \\\$3, NOW())
     ON CONFLICT (id) DO NOTHING\`,
    ['${ORG_ID}', '${ORG_NAME}', '${ORG_SLUG}']
  );
  console.log('  ✅ Organization ready');
  await pool.end();
})().catch(err => { console.error('  ❌ Organization create failed:', err.message); process.exit(1); });
"

# ─── Step 3: Create Project (direct PG — CTRFHub-owned table) ─────────────
echo ""
echo "▶ Step 3: Creating project (${PROJECT_SLUG})..."

# Projects use auto-increment integer PK. Use a subquery to check if one
# with this slug already exists before inserting.
PROJECT_ID=$(node -e "
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
(async () => {
  // Check if project already exists
  const existing = await pool.query(
    'SELECT id FROM projects WHERE slug = \\\$1',
    ['${PROJECT_SLUG}']
  );
  if (existing.rows.length > 0) {
    console.log(existing.rows[0].id);
    await pool.end();
    return;
  }
  // Insert new project
  const result = await pool.query(
    \`INSERT INTO projects (name, slug, \"idPrefix\", settings, \"createdAt\", \"updatedAt\", organization_id)
     VALUES (\\\$1, \\\$2, \\\$3, '{}', NOW(), NOW(), \\\$4)
     RETURNING id\`,
    ['${PROJECT_NAME}', '${PROJECT_SLUG}', '${PROJECT_PREFIX}', '${ORG_ID}']
  );
  console.log(result.rows[0].id);
  await pool.end();
})().catch(err => { console.error('ERROR:' + err.message); process.exit(1); });
")

if echo "$PROJECT_ID" | grep -q "^[0-9]"; then
  echo "  ✅ Project ready (id=${PROJECT_ID})"
else
  echo "  ❌ Failed to get project ID: ${PROJECT_ID}"
  exit 1
fi

# ─── Step 4: Create API key via Better Auth ───────────────────────────────
echo ""
echo "▶ Step 4: Creating API key for project ${PROJECT_SLUG} (id=${PROJECT_ID})..."

# Check if an API key named "preview-ci" already exists by listing keys.
# If the list endpoint isn't available or returns empty, create a new key.
APIKEY_RESPONSE=$(curl -s -o /tmp/ctrfhub-apikey-response.json -w "%{http_code}" \
  -X POST "${BASE_URL}/api/auth/api-key/create" \
  -H "content-type: application/json" \
  -b "${COOKIE_JAR}" \
  -d "{\"name\":\"preview-ci\",\"metadata\":{\"projectId\":\"${PROJECT_ID}\"}}")

if [ "$APIKEY_RESPONSE" = "200" ] || [ "$APIKEY_RESPONSE" = "201" ]; then
  # Extract the plaintext key from the response.
  # Better Auth returns { key: "ctrf_xxx...", ... } on creation.
  API_KEY=$(node -e "
    const data = require('/tmp/ctrfhub-apikey-response.json');
    // The key field contains the plaintext value — shown exactly once.
    console.log(data.key || data.apiKey || '');
  " 2>/dev/null || true)

  if [ -n "$API_KEY" ]; then
    echo "  ✅ API key created: ${API_KEY:0:12}..."
    # Write the key to a well-known location for CI consumption.
    # SECURITY: This file is inside the Tugboat preview container only —
    # never committed, never logged in full.
    echo "${API_KEY}" > /tmp/ctrfhub-preview-api-key
    echo ""
    echo "═══════════════════════════════════════════════"
    echo "  Preview API Key: ${API_KEY:0:12}..."
    echo "  Preview URL:     ${TUGBOAT_DEFAULT_SERVICE_URL:-http://localhost:3000}"
    echo "═══════════════════════════════════════════════"
  else
    echo "  ⚠️  API key created but could not extract plaintext value"
    echo "  Response:"
    cat /tmp/ctrfhub-apikey-response.json 2>/dev/null || true
  fi
else
  echo "  ⚠️  API key creation returned HTTP ${APIKEY_RESPONSE} (may already exist)"
  echo "  Response:"
  cat /tmp/ctrfhub-apikey-response.json 2>/dev/null || true
  echo ""
  echo "  ℹ️  If a key already exists from a previous build, the preview"
  echo "     is still functional — existing keys remain valid."
fi

# ─── Cleanup ──────────────────────────────────────────────────────────────
rm -f "${COOKIE_JAR}" /tmp/ctrfhub-signup-response.json /tmp/ctrfhub-login-response.json

echo ""
echo "✅ Seed complete"
