#!/usr/bin/env bash
# =============================================================================
# 02 — Firewall and SSH Hardening
# Configures UFW, moves SSH to port 2222, disables password auth
# =============================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log_info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
log_success() { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }

MARKER="/var/lib/ai-platform/.02-firewall-done"
SSHD_CONFIG="/etc/ssh/sshd_config"
SSHD_DROP_IN="/etc/ssh/sshd_config.d/99-ai-platform.conf"

if [[ -f "$MARKER" ]]; then
    log_warn "Firewall already configured (marker: $MARKER). Skipping."
    exit 2
fi

# ---------------------------------------------------------------------------
# SSH hardening
# ---------------------------------------------------------------------------
log_info "Hardening SSH configuration..."

# Use drop-in config to avoid breaking the main file
mkdir -p /etc/ssh/sshd_config.d

cat > "$SSHD_DROP_IN" <<'SSHCONF'
# AI Service Platform — SSH hardening
Port 2222
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
MaxAuthTries 3
ClientAliveInterval 300
ClientAliveCountMax 3
X11Forwarding no
AllowAgentForwarding no
SSHCONF

# Ensure Include directive is present in main config
if ! grep -q "^Include /etc/ssh/sshd_config.d/" "$SSHD_CONFIG" 2>/dev/null; then
    # Prepend Include line
    sed -i '1i Include /etc/ssh/sshd_config.d/*.conf' "$SSHD_CONFIG"
fi

# Validate config before restarting
if sshd -t 2>/dev/null; then
    log_success "SSH config validated"
else
    log_warn "SSH config test failed, reverting drop-in..."
    rm -f "$SSHD_DROP_IN"
    exit 1
fi

# Restart SSH
systemctl restart sshd || systemctl restart ssh
log_success "SSH hardened: port 2222, key-only, no root, MaxAuthTries 3, idle timeout 15m"

# ---------------------------------------------------------------------------
# UFW configuration
# ---------------------------------------------------------------------------
log_info "Configuring UFW firewall..."

# Reset UFW to clean state (non-interactive)
ufw --force reset

# Default policies
ufw default deny incoming
ufw default allow outgoing

# Allow ports
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'
ufw allow 2222/tcp comment 'SSH'

# Enable logging
ufw logging on

# Enable UFW (non-interactive)
ufw --force enable

log_success "UFW enabled: deny incoming, allow 80/443/2222"

# Show status
ufw status verbose

# ---------------------------------------------------------------------------
# Create marker
# ---------------------------------------------------------------------------
mkdir -p /var/lib/ai-platform
touch "$MARKER"
log_success "Firewall and SSH hardening complete"

echo ""
log_warn "IMPORTANT: SSH is now on port 2222. Reconnect with: ssh -p 2222 user@host"
log_warn "IMPORTANT: Ensure you have SSH keys configured before closing this session!"
