#!/usr/bin/env bash
# =============================================================================
# 05 — Docker Compose Deployment
# Deploys the AI Service Platform using docker-compose.prod.yml
# =============================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log_info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
log_success() { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error()   { echo -e "${RED}[FAIL]${NC}  $*"; }

MARKER="/var/lib/ai-platform/.05-docker-compose-done"
PLATFORM_DIR="/opt/ai-service-platform"
SETUP_DIR="${SETUP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
PROJECT_ROOT="$(dirname "$SETUP_DIR")"

if [[ -f "$MARKER" ]]; then
    log_warn "Docker deployment already completed (marker: $MARKER). Skipping."
    exit 2
fi

# ---------------------------------------------------------------------------
# Verify Docker is running
# ---------------------------------------------------------------------------
if ! docker info &>/dev/null; then
    log_error "Docker is not running. Start Docker first."
    exit 1
fi
log_success "Docker is running"

# ---------------------------------------------------------------------------
# Deploy platform files
# ---------------------------------------------------------------------------
log_info "Deploying platform to $PLATFORM_DIR..."
mkdir -p "$PLATFORM_DIR"

# Copy project files (excluding node_modules, .git, etc.)
rsync -a --delete \
    --exclude 'node_modules' \
    --exclude '.git' \
    --exclude '.env' \
    --exclude 'setup' \
    "$PROJECT_ROOT/" "$PLATFORM_DIR/"

# Copy production compose file
if [[ -f "$PROJECT_ROOT/docker-compose.prod.yml" ]]; then
    cp "$PROJECT_ROOT/docker-compose.prod.yml" "$PLATFORM_DIR/docker-compose.prod.yml"
else
    log_error "docker-compose.prod.yml not found in project root"
    exit 1
fi

chown -R aiplatform:aiplatform "$PLATFORM_DIR"
log_success "Platform files deployed to $PLATFORM_DIR"

# ---------------------------------------------------------------------------
# Generate .env file
# ---------------------------------------------------------------------------
ENV_FILE="$PLATFORM_DIR/.env"

if [[ -f "$ENV_FILE" ]]; then
    log_warn ".env already exists. Preserving existing configuration."
else
    log_info "Generating .env with secure secrets..."

    # Generate secrets
    JWT_SECRET=$(openssl rand -base64 48 | tr -dc 'a-zA-Z0-9' | head -c 64)
    API_KEY_SALT=$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 32)
    ENCRYPTION_KEY=$(openssl rand -hex 32)
    DB_PASSWORD=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 32)
    REDIS_PASSWORD=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 32)

    cat > "$ENV_FILE" <<ENV
# =============================================================================
# AI Service Platform — Production Environment
# Generated: $(date -u '+%Y-%m-%d %H:%M:%S UTC')
# =============================================================================

# Application
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
DOMAIN=${DOMAIN:-localhost}

# Database
DB_HOST=postgres
DB_PORT=5432
DB_USER=aiplatform
DB_PASSWORD=$DB_PASSWORD
DB_NAME=ai_service_platform

# Redis
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=$REDIS_PASSWORD

# Security
JWT_SECRET=$JWT_SECRET
API_KEY_SALT=$API_KEY_SALT
ENCRYPTION_KEY=$ENCRYPTION_KEY

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100

# Logging
LOG_LEVEL=info
LOG_FORMAT=json
ENV

    chmod 600 "$ENV_FILE"
    chown aiplatform:aiplatform "$ENV_FILE"
    log_success ".env generated with secure secrets"
fi

# ---------------------------------------------------------------------------
# Build and start containers
# ---------------------------------------------------------------------------
log_info "Building and starting containers..."
cd "$PLATFORM_DIR"

# Pull base images first
docker compose -f docker-compose.prod.yml pull 2>/dev/null || true

# Build
docker compose -f docker-compose.prod.yml build --no-cache

# Start in detached mode
docker compose -f docker-compose.prod.yml up -d

log_success "Containers started"

# ---------------------------------------------------------------------------
# Wait for healthy containers
# ---------------------------------------------------------------------------
log_info "Waiting for containers to become healthy..."

MAX_WAIT=120
ELAPSED=0
HEALTHY=false

while [[ $ELAPSED -lt $MAX_WAIT ]]; do
    # Check if all services are up
    UNHEALTHY=$(docker compose -f docker-compose.prod.yml ps --format json 2>/dev/null | \
        jq -r 'select(.Health != "healthy" and .Health != "" and .State == "running") | .Name' 2>/dev/null | wc -l)

    RUNNING=$(docker compose -f docker-compose.prod.yml ps --format json 2>/dev/null | \
        jq -r 'select(.State == "running") | .Name' 2>/dev/null | wc -l)

    if [[ $RUNNING -ge 3 && $UNHEALTHY -eq 0 ]]; then
        HEALTHY=true
        break
    fi

    sleep 5
    ELAPSED=$((ELAPSED + 5))
    echo -n "."
done
echo ""

if [[ "$HEALTHY" == "true" ]]; then
    log_success "All containers healthy after ${ELAPSED}s"
else
    log_warn "Some containers may not be fully healthy yet (waited ${MAX_WAIT}s)"
    docker compose -f docker-compose.prod.yml ps
fi

# ---------------------------------------------------------------------------
# Run migrations and seed
# ---------------------------------------------------------------------------
log_info "Running database migrations..."
if docker compose -f docker-compose.prod.yml exec -T api npm run migrate 2>/dev/null; then
    log_success "Migrations completed"
else
    log_warn "Migrations may have already been applied or API container is not ready"
fi

log_info "Running database seed..."
if docker compose -f docker-compose.prod.yml exec -T api npm run seed 2>/dev/null; then
    log_success "Database seeded"
else
    log_warn "Seed may have already been applied or API container is not ready"
fi

# ---------------------------------------------------------------------------
# Verify API is responding
# ---------------------------------------------------------------------------
log_info "Verifying API health..."
sleep 3

if curl -sf http://localhost:3000/health &>/dev/null; then
    log_success "API is responding on port 3000"
else
    log_warn "API not yet responding on port 3000 (may still be starting)"
fi

# ---------------------------------------------------------------------------
# Show container status
# ---------------------------------------------------------------------------
echo ""
log_info "Container status:"
docker compose -f docker-compose.prod.yml ps

# ---------------------------------------------------------------------------
# Create marker
# ---------------------------------------------------------------------------
mkdir -p /var/lib/ai-platform
touch "$MARKER"
log_success "Docker Compose deployment complete"
