#!/usr/bin/env bash
# =============================================================================
# 04 — PostgreSQL 16 + pgvector and Redis 7 (native install)
# Skipped when using Docker-based databases (default)
# =============================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log_info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
log_success() { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }

MARKER="/var/lib/ai-platform/.04-postgres-redis-done"
SKIP_DOCKER_DB="${SKIP_DOCKER_DB:-false}"

if [[ -f "$MARKER" ]]; then
    log_warn "PostgreSQL/Redis already configured (marker: $MARKER). Skipping."
    exit 2
fi

# If using Docker for DB (default), skip native install
if [[ "$SKIP_DOCKER_DB" != "true" ]]; then
    log_info "Databases will run in Docker (default). Skipping native install."
    log_info "Pass --skip-docker-db to install.sh to install natively."
    mkdir -p /var/lib/ai-platform
    touch "$MARKER"
    exit 0
fi

# ---------------------------------------------------------------------------
# PostgreSQL 16
# ---------------------------------------------------------------------------
if command -v psql &>/dev/null && psql --version | grep -q "16"; then
    log_warn "PostgreSQL 16 already installed"
else
    log_info "Installing PostgreSQL 16..."

    # Add PostgreSQL APT repo
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | \
        gpg --dearmor -o /etc/apt/keyrings/postgresql.gpg

    echo "deb [signed-by=/etc/apt/keyrings/postgresql.gpg] \
        http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" | \
        tee /etc/apt/sources.list.d/pgdg.list > /dev/null

    apt-get update -y
    apt-get install -y postgresql-16 postgresql-client-16

    log_success "PostgreSQL 16 installed"
fi

# ---------------------------------------------------------------------------
# pgvector extension
# ---------------------------------------------------------------------------
log_info "Installing pgvector extension..."
apt-get install -y postgresql-16-pgvector 2>/dev/null || {
    log_info "pgvector not in apt, building from source..."
    apt-get install -y postgresql-server-dev-16
    PGVEC_TMP=$(mktemp -d)
    git clone --branch v0.7.4 https://github.com/pgvector/pgvector.git "$PGVEC_TMP"
    cd "$PGVEC_TMP"
    make PG_CONFIG=/usr/bin/pg_config
    make install PG_CONFIG=/usr/bin/pg_config
    cd /
    rm -rf "$PGVEC_TMP"
}
log_success "pgvector extension installed"

# ---------------------------------------------------------------------------
# Configure PostgreSQL
# ---------------------------------------------------------------------------
log_info "Configuring PostgreSQL database and user..."

# Generate a random password
DB_PASSWORD=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 32)

# Start PostgreSQL
systemctl enable postgresql
systemctl start postgresql

# Create database and user
sudo -u postgres psql <<SQL
-- Create user if not exists
DO \$\$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'aiplatform') THEN
        CREATE ROLE aiplatform WITH LOGIN PASSWORD '$DB_PASSWORD';
    END IF;
END
\$\$;

-- Create database if not exists
SELECT 'CREATE DATABASE ai_service_platform OWNER aiplatform'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'ai_service_platform')\gexec

-- Enable pgvector
\c ai_service_platform
CREATE EXTENSION IF NOT EXISTS vector;
SQL

# Save credentials for later use
mkdir -p /opt/ai-service-platform
cat > /opt/ai-service-platform/.db-credentials <<CREDS
DB_HOST=localhost
DB_PORT=5432
DB_USER=aiplatform
DB_PASSWORD=$DB_PASSWORD
DB_NAME=ai_service_platform
CREDS
chmod 600 /opt/ai-service-platform/.db-credentials

log_success "PostgreSQL configured: database=ai_service_platform, user=aiplatform"

# Tune PostgreSQL for production
PG_CONF="/etc/postgresql/16/main/postgresql.conf"
if [[ -f "$PG_CONF" ]]; then
    log_info "Tuning PostgreSQL for production..."

    # Calculate shared_buffers (25% of RAM, max 4GB)
    TOTAL_RAM_KB=$(grep MemTotal /proc/meminfo | awk '{print $2}')
    SHARED_BUFFERS=$((TOTAL_RAM_KB / 4 / 1024))MB
    if [[ $((TOTAL_RAM_KB / 4 / 1024)) -gt 4096 ]]; then
        SHARED_BUFFERS="4GB"
    fi

    cat >> "$PG_CONF" <<PGCONF

# AI Platform production tuning
shared_buffers = $SHARED_BUFFERS
effective_cache_size = $((TOTAL_RAM_KB * 3 / 4 / 1024))MB
work_mem = 16MB
maintenance_work_mem = 256MB
max_connections = 100
PGCONF

    systemctl restart postgresql
    log_success "PostgreSQL tuned (shared_buffers=$SHARED_BUFFERS)"
fi

# ---------------------------------------------------------------------------
# Redis 7
# ---------------------------------------------------------------------------
if command -v redis-server &>/dev/null && redis-server --version | grep -q "v=7"; then
    log_warn "Redis 7 already installed"
else
    log_info "Installing Redis 7..."

    # Add Redis APT repo
    curl -fsSL https://packages.redis.io/gpg | \
        gpg --dearmor -o /etc/apt/keyrings/redis.gpg

    echo "deb [signed-by=/etc/apt/keyrings/redis.gpg] \
        https://packages.redis.io/deb $(lsb_release -cs) main" | \
        tee /etc/apt/sources.list.d/redis.list > /dev/null

    apt-get update -y
    apt-get install -y redis-server

    log_success "Redis installed: $(redis-server --version)"
fi

# ---------------------------------------------------------------------------
# Configure Redis for production
# ---------------------------------------------------------------------------
log_info "Configuring Redis for production..."

REDIS_CONF="/etc/redis/redis.conf"
if [[ -f "$REDIS_CONF" ]]; then
    # Backup original
    cp "$REDIS_CONF" "${REDIS_CONF}.bak"

    # Production settings
    sed -i 's/^# maxmemory .*/maxmemory 512mb/' "$REDIS_CONF"
    sed -i 's/^maxmemory .*/maxmemory 512mb/' "$REDIS_CONF"

    # Add maxmemory if not present
    if ! grep -q "^maxmemory " "$REDIS_CONF"; then
        echo "maxmemory 512mb" >> "$REDIS_CONF"
    fi

    sed -i 's/^# maxmemory-policy .*/maxmemory-policy allkeys-lru/' "$REDIS_CONF"
    sed -i 's/^maxmemory-policy .*/maxmemory-policy allkeys-lru/' "$REDIS_CONF"

    # Enable AOF persistence
    sed -i 's/^appendonly no/appendonly yes/' "$REDIS_CONF"

    # Bind to localhost only
    sed -i 's/^bind .*/bind 127.0.0.1 ::1/' "$REDIS_CONF"

    # Disable dangerous commands
    echo 'rename-command FLUSHDB ""' >> "$REDIS_CONF"
    echo 'rename-command FLUSHALL ""' >> "$REDIS_CONF"

    systemctl enable redis-server
    systemctl restart redis-server

    log_success "Redis configured: maxmemory=512mb, appendonly=yes, localhost only"
fi

# ---------------------------------------------------------------------------
# Create marker
# ---------------------------------------------------------------------------
mkdir -p /var/lib/ai-platform
touch "$MARKER"
log_success "PostgreSQL and Redis setup complete"
