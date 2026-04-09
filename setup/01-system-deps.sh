#!/usr/bin/env bash
# =============================================================================
# 01 — System Dependencies
# Installs core packages, Node.js 20 LTS, Docker Engine + Compose plugin
# =============================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log_info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
log_success() { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }

MARKER="/var/lib/ai-platform/.01-system-deps-done"

if [[ -f "$MARKER" ]]; then
    log_warn "System dependencies already installed (marker: $MARKER). Skipping."
    exit 2
fi

# ---------------------------------------------------------------------------
# System update
# ---------------------------------------------------------------------------
log_info "Updating system packages..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get full-upgrade -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold"
log_success "System packages updated"

# ---------------------------------------------------------------------------
# Core packages
# ---------------------------------------------------------------------------
log_info "Installing core packages..."
apt-get install -y \
    build-essential \
    curl \
    wget \
    git \
    jq \
    htop \
    tmux \
    unzip \
    ufw \
    fail2ban \
    certbot \
    python3-certbot-nginx \
    apt-transport-https \
    ca-certificates \
    gnupg \
    lsb-release \
    software-properties-common \
    logrotate \
    cron
log_success "Core packages installed"

# ---------------------------------------------------------------------------
# Node.js 20 LTS via NodeSource
# ---------------------------------------------------------------------------
if command -v node &>/dev/null && node --version | grep -q "v20"; then
    log_warn "Node.js 20 already installed: $(node --version)"
else
    log_info "Installing Node.js 20 LTS..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
    log_success "Node.js installed: $(node --version)"
fi

# ---------------------------------------------------------------------------
# Docker Engine + Compose plugin
# ---------------------------------------------------------------------------
if command -v docker &>/dev/null; then
    log_warn "Docker already installed: $(docker --version)"
else
    log_info "Installing Docker Engine..."

    # Remove old versions if present
    apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true

    # Add Docker GPG key
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc

    # Add Docker repo
    echo \
        "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
        https://download.docker.com/linux/ubuntu \
        $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
        tee /etc/apt/sources.list.d/docker.list > /dev/null

    apt-get update -y
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

    # Start and enable Docker
    systemctl enable docker
    systemctl start docker

    log_success "Docker installed: $(docker --version)"
fi

# Verify Docker Compose
if docker compose version &>/dev/null; then
    log_success "Docker Compose available: $(docker compose version --short)"
else
    log_warn "Docker Compose plugin not found, installing..."
    apt-get install -y docker-compose-plugin
fi

# ---------------------------------------------------------------------------
# Create 'aiplatform' system user
# ---------------------------------------------------------------------------
if id "aiplatform" &>/dev/null; then
    log_warn "User 'aiplatform' already exists"
else
    log_info "Creating 'aiplatform' system user..."
    useradd --system --create-home --shell /bin/bash --groups docker aiplatform
    log_success "User 'aiplatform' created and added to docker group"
fi

# Ensure aiplatform is in docker group even if user already existed
usermod -aG docker aiplatform 2>/dev/null || true

# ---------------------------------------------------------------------------
# Timezone and NTP
# ---------------------------------------------------------------------------
log_info "Setting timezone to UTC..."
timedatectl set-timezone UTC
log_success "Timezone set to UTC"

log_info "Configuring NTP..."
if systemctl is-active --quiet systemd-timesyncd; then
    log_success "systemd-timesyncd already active"
else
    apt-get install -y systemd-timesyncd
    systemctl enable systemd-timesyncd
    systemctl start systemd-timesyncd
    log_success "NTP configured via systemd-timesyncd"
fi
timedatectl set-ntp true

# ---------------------------------------------------------------------------
# Swap configuration (if RAM < 4GB)
# ---------------------------------------------------------------------------
TOTAL_RAM_KB=$(grep MemTotal /proc/meminfo | awk '{print $2}')
TOTAL_RAM_GB=$((TOTAL_RAM_KB / 1024 / 1024))

if [[ $TOTAL_RAM_GB -lt 4 ]]; then
    if swapon --show | grep -q "/swapfile"; then
        log_warn "Swap already configured"
    else
        log_info "RAM < 4GB ($TOTAL_RAM_GB GB). Creating 2GB swap..."
        fallocate -l 2G /swapfile
        chmod 600 /swapfile
        mkswap /swapfile
        swapon /swapfile

        # Make persistent
        if ! grep -q "/swapfile" /etc/fstab; then
            echo "/swapfile none swap sw 0 0" >> /etc/fstab
        fi

        # Tune swappiness
        sysctl vm.swappiness=10
        if ! grep -q "vm.swappiness" /etc/sysctl.conf; then
            echo "vm.swappiness=10" >> /etc/sysctl.conf
        fi

        log_success "2GB swap created and enabled"
    fi
else
    log_info "RAM >= 4GB ($TOTAL_RAM_GB GB). Swap not needed."
fi

# ---------------------------------------------------------------------------
# Create marker
# ---------------------------------------------------------------------------
mkdir -p /var/lib/ai-platform
touch "$MARKER"
log_success "System dependencies setup complete"
