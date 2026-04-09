#!/usr/bin/env bash
# =============================================================================
# 07 — Systemd Services
# Creates systemd unit to manage the Docker Compose stack on boot
# =============================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log_info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
log_success() { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }

MARKER="/var/lib/ai-platform/.07-systemd-done"
PLATFORM_DIR="/opt/ai-service-platform"
SERVICE_FILE="/etc/systemd/system/ai-platform.service"

if [[ -f "$MARKER" ]]; then
    log_warn "Systemd services already configured (marker: $MARKER). Skipping."
    exit 2
fi

# ---------------------------------------------------------------------------
# Create systemd unit file
# ---------------------------------------------------------------------------
log_info "Creating ai-platform.service unit file..."

cat > "$SERVICE_FILE" <<UNIT
[Unit]
Description=AI Service Platform (Docker Compose)
Documentation=https://github.com/your-org/ai-service-platform
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$PLATFORM_DIR

# Load environment
EnvironmentFile=-$PLATFORM_DIR/.env

# Start the stack
ExecStart=/usr/bin/docker compose -f docker-compose.prod.yml up -d --remove-orphans
ExecStop=/usr/bin/docker compose -f docker-compose.prod.yml down
ExecReload=/usr/bin/docker compose -f docker-compose.prod.yml up -d --remove-orphans

# Restart policy
Restart=on-failure
RestartSec=10

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=ai-platform

# Security
NoNewPrivileges=false
ProtectSystem=false

# Resource limits
LimitNOFILE=65536
LimitNPROC=4096

[Install]
WantedBy=multi-user.target
UNIT

log_success "Unit file created: $SERVICE_FILE"

# ---------------------------------------------------------------------------
# Create restart helper service (watches for failures)
# ---------------------------------------------------------------------------
log_info "Creating watchdog timer for automatic restarts..."

cat > /etc/systemd/system/ai-platform-watchdog.service <<WATCHDOG
[Unit]
Description=AI Service Platform Watchdog
After=ai-platform.service

[Service]
Type=oneshot
ExecStart=/bin/bash -c 'cd $PLATFORM_DIR && docker compose -f docker-compose.prod.yml ps --format json | jq -e "select(.State != \"running\")" && docker compose -f docker-compose.prod.yml up -d --remove-orphans || true'
StandardOutput=journal
StandardError=journal
SyslogIdentifier=ai-platform-watchdog
WATCHDOG

cat > /etc/systemd/system/ai-platform-watchdog.timer <<TIMER
[Unit]
Description=AI Service Platform Watchdog Timer

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
AccuracySec=30s

[Install]
WantedBy=timers.target
TIMER

log_success "Watchdog timer created (checks every 5 minutes)"

# ---------------------------------------------------------------------------
# Create log cleanup timer
# ---------------------------------------------------------------------------
log_info "Creating Docker log cleanup timer..."

cat > /etc/systemd/system/ai-platform-log-cleanup.service <<LOGCLEAN
[Unit]
Description=AI Service Platform Docker Log Cleanup

[Service]
Type=oneshot
ExecStart=/bin/bash -c 'docker system prune -f --volumes=false 2>/dev/null; journalctl --vacuum-time=7d --vacuum-size=500M 2>/dev/null || true'
StandardOutput=journal
StandardError=journal
SyslogIdentifier=ai-platform-log-cleanup
LOGCLEAN

cat > /etc/systemd/system/ai-platform-log-cleanup.timer <<LOGTIMER
[Unit]
Description=Weekly Docker log cleanup

[Timer]
OnCalendar=Sun 03:00:00
AccuracySec=1h
Persistent=true

[Install]
WantedBy=timers.target
LOGTIMER

log_success "Log cleanup timer created (weekly Sunday 03:00)"

# ---------------------------------------------------------------------------
# Reload and enable
# ---------------------------------------------------------------------------
log_info "Enabling systemd services..."

systemctl daemon-reload

# Enable main service
systemctl enable ai-platform.service
log_success "ai-platform.service enabled (starts on boot)"

# Enable watchdog timer
systemctl enable ai-platform-watchdog.timer
systemctl start ai-platform-watchdog.timer
log_success "ai-platform-watchdog.timer enabled"

# Enable log cleanup timer
systemctl enable ai-platform-log-cleanup.timer
systemctl start ai-platform-log-cleanup.timer
log_success "ai-platform-log-cleanup.timer enabled"

# Start the main service (if not already running via Docker)
if ! systemctl is-active --quiet ai-platform.service; then
    systemctl start ai-platform.service
    log_success "ai-platform.service started"
else
    log_warn "ai-platform.service already running"
fi

# ---------------------------------------------------------------------------
# Show status
# ---------------------------------------------------------------------------
echo ""
log_info "Service status:"
systemctl status ai-platform.service --no-pager || true
echo ""
log_info "Timer status:"
systemctl list-timers ai-platform-* --no-pager || true

# ---------------------------------------------------------------------------
# Create marker
# ---------------------------------------------------------------------------
mkdir -p /var/lib/ai-platform
touch "$MARKER"
log_success "Systemd services setup complete"
