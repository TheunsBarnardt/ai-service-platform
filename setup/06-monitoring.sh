#!/usr/bin/env bash
# =============================================================================
# 06 — Monitoring, Logging, and Health Checks
# Installs Netdata, configures fail2ban, logrotate, and health check cron
# =============================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log_info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
log_success() { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }

MARKER="/var/lib/ai-platform/.06-monitoring-done"
DOMAIN="${DOMAIN:-localhost}"
EMAIL="${EMAIL:-}"

if [[ -f "$MARKER" ]]; then
    log_warn "Monitoring already configured (marker: $MARKER). Skipping."
    exit 2
fi

# ---------------------------------------------------------------------------
# Netdata
# ---------------------------------------------------------------------------
if command -v netdata &>/dev/null || systemctl is-active --quiet netdata 2>/dev/null; then
    log_warn "Netdata already installed"
else
    log_info "Installing Netdata..."
    curl -fsSL https://get.netdata.cloud/kickstart.sh > /tmp/netdata-kickstart.sh
    bash /tmp/netdata-kickstart.sh --non-interactive --stable-channel
    rm -f /tmp/netdata-kickstart.sh

    # Restrict Netdata to localhost (accessible via SSH tunnel or nginx proxy)
    NETDATA_CONF="/etc/netdata/netdata.conf"
    if [[ -f "$NETDATA_CONF" ]]; then
        # Ensure [web] section exists and bind to localhost
        if grep -q "\[web\]" "$NETDATA_CONF"; then
            sed -i '/\[web\]/a\    bind to = 127.0.0.1' "$NETDATA_CONF"
        else
            cat >> "$NETDATA_CONF" <<NDCONF

[web]
    bind to = 127.0.0.1
NDCONF
        fi
        systemctl restart netdata
    fi

    log_success "Netdata installed (listening on localhost:19999)"
fi

# ---------------------------------------------------------------------------
# Fail2ban jails
# ---------------------------------------------------------------------------
log_info "Configuring fail2ban jails..."

F2B_LOCAL="/etc/fail2ban/jail.local"

cat > "$F2B_LOCAL" <<'F2B'
[DEFAULT]
bantime  = 3600
findtime = 600
maxretry = 5
banaction = ufw

# SSH jail (custom port 2222)
[sshd]
enabled  = true
port     = 2222
filter   = sshd
logpath  = /var/log/auth.log
maxretry = 3
bantime  = 7200

# Nginx HTTP auth
[nginx-http-auth]
enabled  = true
port     = http,https
filter   = nginx-http-auth
logpath  = /var/log/nginx/error.log
maxretry = 5

# Nginx rate limit (ban IPs hitting 429)
[nginx-limit-req]
enabled  = true
port     = http,https
filter   = nginx-limit-req
logpath  = /var/log/nginx/error.log
maxretry = 10
bantime  = 3600

# Nginx bad bots
[nginx-botsearch]
enabled  = true
port     = http,https
filter   = nginx-botsearch
logpath  = /var/log/nginx/access.log
maxretry = 2
bantime  = 86400
F2B

systemctl enable fail2ban
systemctl restart fail2ban
log_success "Fail2ban configured with SSH, nginx-http-auth, nginx-limit-req, nginx-botsearch jails"

# ---------------------------------------------------------------------------
# Logrotate for platform logs
# ---------------------------------------------------------------------------
log_info "Configuring logrotate for platform logs..."

cat > /etc/logrotate.d/ai-platform <<'LOGROTATE'
/var/log/ai-platform/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 aiplatform aiplatform
    sharedscripts
    postrotate
        # Signal Docker to rotate if using json-file driver
        docker kill --signal=USR1 $(docker ps -qf "name=ai-service-platform") 2>/dev/null || true
    endscript
}

/var/log/nginx/ai-platform-*.log {
    daily
    missingok
    rotate 30
    compress
    delaycompress
    notifempty
    create 0640 www-data adm
    sharedscripts
    postrotate
        [ -f /var/run/nginx.pid ] && kill -USR1 $(cat /var/run/nginx.pid) 2>/dev/null || true
    endscript
}
LOGROTATE

# Create log directory
mkdir -p /var/log/ai-platform
chown aiplatform:aiplatform /var/log/ai-platform

log_success "Logrotate configured (14d platform, 30d nginx)"

# ---------------------------------------------------------------------------
# Health check cron
# ---------------------------------------------------------------------------
log_info "Setting up health check cron..."

HEALTH_SCRIPT="/opt/ai-service-platform/scripts/health-check.sh"
mkdir -p "$(dirname "$HEALTH_SCRIPT")"

cat > "$HEALTH_SCRIPT" <<'HEALTHCHECK'
#!/usr/bin/env bash
# AI Service Platform — Health Check
# Runs every 5 minutes via cron

HEALTH_URL="http://localhost:3000/health"
LOG_FILE="/var/log/ai-platform/health-check.log"
ALERT_FILE="/var/lib/ai-platform/.health-alert-sent"
MAX_FAILURES=3
FAILURE_COUNT_FILE="/var/lib/ai-platform/.health-failure-count"

mkdir -p /var/lib/ai-platform /var/log/ai-platform

# Initialize failure count
if [[ ! -f "$FAILURE_COUNT_FILE" ]]; then
    echo "0" > "$FAILURE_COUNT_FILE"
fi

TIMESTAMP=$(date -u '+%Y-%m-%d %H:%M:%S UTC')

# Check health endpoint
HTTP_CODE=$(curl -sf -o /dev/null -w '%{http_code}' --max-time 10 "$HEALTH_URL" 2>/dev/null || echo "000")

if [[ "$HTTP_CODE" == "200" ]]; then
    echo "$TIMESTAMP [OK] Health check passed (HTTP $HTTP_CODE)" >> "$LOG_FILE"

    # Reset failure count
    echo "0" > "$FAILURE_COUNT_FILE"

    # Remove alert flag if it was set (service recovered)
    if [[ -f "$ALERT_FILE" ]]; then
        rm -f "$ALERT_FILE"
        echo "$TIMESTAMP [RECOVERED] Service is back online" >> "$LOG_FILE"

        # Send recovery notification
        ADMIN_EMAIL="${ADMIN_EMAIL:-}"
        if [[ -n "$ADMIN_EMAIL" ]] && command -v mail &>/dev/null; then
            echo "AI Service Platform has recovered and is responding normally." | \
                mail -s "[RECOVERED] AI Service Platform" "$ADMIN_EMAIL"
        fi
    fi
else
    # Increment failure count
    FAILURES=$(cat "$FAILURE_COUNT_FILE")
    FAILURES=$((FAILURES + 1))
    echo "$FAILURES" > "$FAILURE_COUNT_FILE"

    echo "$TIMESTAMP [FAIL] Health check failed (HTTP $HTTP_CODE, failure $FAILURES/$MAX_FAILURES)" >> "$LOG_FILE"

    # Alert after MAX_FAILURES consecutive failures
    if [[ $FAILURES -ge $MAX_FAILURES && ! -f "$ALERT_FILE" ]]; then
        touch "$ALERT_FILE"
        echo "$TIMESTAMP [ALERT] Service down after $FAILURES consecutive failures" >> "$LOG_FILE"

        # Try to restart the service
        echo "$TIMESTAMP [ACTION] Attempting automatic restart..." >> "$LOG_FILE"
        cd /opt/ai-service-platform
        docker compose -f docker-compose.prod.yml restart api 2>/dev/null || true

        # Send alert email
        ADMIN_EMAIL="${ADMIN_EMAIL:-}"
        if [[ -n "$ADMIN_EMAIL" ]] && command -v mail &>/dev/null; then
            echo "AI Service Platform health check failed $FAILURES times. Automatic restart attempted. Check server status." | \
                mail -s "[ALERT] AI Service Platform DOWN" "$ADMIN_EMAIL"
        fi
    fi
fi
HEALTHCHECK

chmod +x "$HEALTH_SCRIPT"

# Install cron job
CRON_FILE="/etc/cron.d/ai-platform-health"
cat > "$CRON_FILE" <<CRON
# AI Service Platform health check — every 5 minutes
ADMIN_EMAIL=${EMAIL}
*/5 * * * * root $HEALTH_SCRIPT
CRON
chmod 644 "$CRON_FILE"

log_success "Health check cron installed (every 5 minutes)"

# ---------------------------------------------------------------------------
# Create marker
# ---------------------------------------------------------------------------
mkdir -p /var/lib/ai-platform
touch "$MARKER"
log_success "Monitoring setup complete"
