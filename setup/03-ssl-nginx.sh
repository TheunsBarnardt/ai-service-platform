#!/usr/bin/env bash
# =============================================================================
# 03 — SSL and Nginx
# Installs nginx, configures reverse proxy, obtains SSL certificate
# =============================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log_info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
log_success() { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error()   { echo -e "${RED}[FAIL]${NC}  $*"; }

MARKER="/var/lib/ai-platform/.03-ssl-nginx-done"
DOMAIN="${DOMAIN:-}"
EMAIL="${EMAIL:-}"
SETUP_DIR="${SETUP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"

if [[ -f "$MARKER" ]]; then
    log_warn "SSL/Nginx already configured (marker: $MARKER). Skipping."
    exit 2
fi

# ---------------------------------------------------------------------------
# Install nginx
# ---------------------------------------------------------------------------
if command -v nginx &>/dev/null; then
    log_warn "Nginx already installed: $(nginx -v 2>&1)"
else
    log_info "Installing nginx..."
    apt-get install -y nginx
    log_success "Nginx installed"
fi

# ---------------------------------------------------------------------------
# Deploy nginx site config
# ---------------------------------------------------------------------------
CONF_SRC="$SETUP_DIR/nginx/ai-platform.conf"
CONF_DEST="/etc/nginx/sites-available/ai-platform.conf"

if [[ ! -f "$CONF_SRC" ]]; then
    log_error "Nginx config not found: $CONF_SRC"
    exit 1
fi

log_info "Deploying nginx site config..."
cp "$CONF_SRC" "$CONF_DEST"

# Replace domain placeholder if domain is set
if [[ -n "$DOMAIN" ]]; then
    sed -i "s/server_name _;/server_name $DOMAIN;/g" "$CONF_DEST"
    sed -i "s/server_name localhost;/server_name $DOMAIN;/g" "$CONF_DEST"
    log_info "Set server_name to $DOMAIN"
fi

# Enable site, disable default
ln -sf "$CONF_DEST" /etc/nginx/sites-enabled/ai-platform.conf
rm -f /etc/nginx/sites-enabled/default

log_success "Nginx site config deployed"

# ---------------------------------------------------------------------------
# SSL certificate
# ---------------------------------------------------------------------------
if [[ -n "$DOMAIN" && -n "$EMAIL" ]]; then
    log_info "Obtaining Let's Encrypt SSL certificate for $DOMAIN..."

    # Ensure nginx config is valid for initial certbot run
    # Temporarily use self-signed to allow nginx to start
    mkdir -p /etc/nginx/ssl
    if [[ ! -f /etc/nginx/ssl/self-signed.crt ]]; then
        openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
            -keyout /etc/nginx/ssl/self-signed.key \
            -out /etc/nginx/ssl/self-signed.crt \
            -subj "/CN=$DOMAIN" 2>/dev/null
    fi

    # Test and reload nginx
    nginx -t
    systemctl reload nginx

    # Run certbot
    certbot --nginx \
        -d "$DOMAIN" \
        --non-interactive \
        --agree-tos \
        --email "$EMAIL" \
        --redirect \
        --staple-ocsp

    log_success "SSL certificate obtained for $DOMAIN"

    # Ensure auto-renewal timer is active
    systemctl enable certbot.timer 2>/dev/null || true
    systemctl start certbot.timer 2>/dev/null || true

    # Test renewal
    certbot renew --dry-run && log_success "Certbot renewal test passed"

elif [[ -n "$DOMAIN" ]]; then
    log_warn "No --email provided. Using self-signed certificate."
    mkdir -p /etc/nginx/ssl
    openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
        -keyout /etc/nginx/ssl/self-signed.key \
        -out /etc/nginx/ssl/self-signed.crt \
        -subj "/CN=$DOMAIN" 2>/dev/null
    log_success "Self-signed certificate created for $DOMAIN"
else
    log_warn "No domain provided. Creating self-signed certificate for localhost."
    mkdir -p /etc/nginx/ssl
    openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
        -keyout /etc/nginx/ssl/self-signed.key \
        -out /etc/nginx/ssl/self-signed.crt \
        -subj "/CN=localhost" 2>/dev/null
    log_success "Self-signed certificate created for localhost"
fi

# ---------------------------------------------------------------------------
# Start nginx
# ---------------------------------------------------------------------------
nginx -t
systemctl enable nginx
systemctl restart nginx
log_success "Nginx started and enabled"

# ---------------------------------------------------------------------------
# Set up certbot renewal cron (fallback if timer not available)
# ---------------------------------------------------------------------------
CRON_FILE="/etc/cron.d/certbot-renew"
if [[ -n "$DOMAIN" && -n "$EMAIL" ]] && ! systemctl is-active --quiet certbot.timer 2>/dev/null; then
    log_info "Setting up certbot renewal cron..."
    cat > "$CRON_FILE" <<'CRON'
# Renew Let's Encrypt certificates twice daily
0 3,15 * * * root certbot renew --quiet --deploy-hook "systemctl reload nginx"
CRON
    log_success "Certbot renewal cron installed"
fi

# ---------------------------------------------------------------------------
# Create marker
# ---------------------------------------------------------------------------
mkdir -p /var/lib/ai-platform
touch "$MARKER"
log_success "SSL and Nginx setup complete"
