#!/usr/bin/env bash
# =============================================================================
# AI Service Platform — Master Installer
# Transforms a fresh Ubuntu 22.04/24.04 LTS into a production server
# Usage: sudo bash install.sh --domain example.com --email admin@example.com
# =============================================================================
set -euo pipefail

# ---------------------------------------------------------------------------
# Colors and formatting
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log_info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
log_success() { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error()   { echo -e "${RED}[FAIL]${NC}  $*"; }
log_step()    { echo -e "\n${CYAN}${BOLD}==> $*${NC}"; }

# ---------------------------------------------------------------------------
# Setup log
# ---------------------------------------------------------------------------
SETUP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="/var/log/ai-platform-setup.log"
mkdir -p "$(dirname "$LOG_FILE")"
exec > >(tee -a "$LOG_FILE") 2>&1

echo ""
echo -e "${BOLD}=============================================${NC}"
echo -e "${BOLD}  AI Service Platform — Server Setup${NC}"
echo -e "${BOLD}=============================================${NC}"
echo "  Started: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "  Log:     $LOG_FILE"
echo ""

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
DOMAIN=""
EMAIL=""
SKIP_DOCKER_DB="false"
DRY_RUN="false"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --domain)      DOMAIN="$2"; shift 2 ;;
        --email)       EMAIL="$2"; shift 2 ;;
        --skip-docker-db) SKIP_DOCKER_DB="true"; shift ;;
        --dry-run)     DRY_RUN="true"; shift ;;
        -h|--help)
            echo "Usage: sudo bash install.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --domain DOMAIN    Domain name for SSL (e.g., api.example.com)"
            echo "  --email EMAIL      Email for Let's Encrypt notifications"
            echo "  --skip-docker-db   Install PostgreSQL/Redis natively instead of Docker"
            echo "  --dry-run          Print what would be done without executing"
            echo "  -h, --help         Show this help"
            exit 0
            ;;
        *) log_error "Unknown option: $1"; exit 1 ;;
    esac
done

# Export for sub-scripts
export DOMAIN EMAIL SKIP_DOCKER_DB SETUP_DIR LOG_FILE

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------
log_step "Pre-flight checks"

# Must be root
if [[ $EUID -ne 0 ]]; then
    log_error "This script must be run as root (use sudo)"
    exit 1
fi
log_success "Running as root"

# Check Ubuntu version
if [[ -f /etc/os-release ]]; then
    . /etc/os-release
    if [[ "$ID" != "ubuntu" ]]; then
        log_error "This script requires Ubuntu. Detected: $ID"
        exit 1
    fi
    UBUNTU_VERSION="$VERSION_ID"
    case "$UBUNTU_VERSION" in
        22.04|24.04)
            log_success "Ubuntu $UBUNTU_VERSION LTS detected"
            ;;
        *)
            log_error "Unsupported Ubuntu version: $UBUNTU_VERSION (need 22.04 or 24.04)"
            exit 1
            ;;
    esac
else
    log_error "Cannot detect OS version (/etc/os-release not found)"
    exit 1
fi

export UBUNTU_VERSION

# Check internet connectivity
if ! ping -c 1 -W 5 8.8.8.8 &>/dev/null; then
    log_error "No internet connectivity"
    exit 1
fi
log_success "Internet connectivity OK"

# Warn if no domain
if [[ -z "$DOMAIN" ]]; then
    log_warn "No --domain provided. Self-signed SSL will be used."
fi

if [[ "$DRY_RUN" == "true" ]]; then
    log_warn "DRY RUN mode — no changes will be made"
    exit 0
fi

# ---------------------------------------------------------------------------
# Run sub-scripts in order
# ---------------------------------------------------------------------------
SCRIPTS=(
    "01-system-deps.sh:System Dependencies"
    "02-firewall.sh:Firewall and SSH Hardening"
    "03-ssl-nginx.sh:SSL and Nginx"
    "04-postgres-redis.sh:PostgreSQL and Redis"
    "05-docker-compose.sh:Docker Compose Deployment"
    "06-monitoring.sh:Monitoring and Logging"
    "07-systemd-services.sh:Systemd Services"
    "08-ddns-cloudflare.sh:Dynamic DNS (Cloudflare)"
)

TOTAL=${#SCRIPTS[@]}
PASSED=0
FAILED=0
SKIPPED=0
RESULTS=()

for i in "${!SCRIPTS[@]}"; do
    IFS=':' read -r script_file script_name <<< "${SCRIPTS[$i]}"
    step_num=$((i + 1))

    log_step "[$step_num/$TOTAL] $script_name"

    script_path="$SETUP_DIR/$script_file"
    if [[ ! -f "$script_path" ]]; then
        log_error "Script not found: $script_path"
        RESULTS+=("${RED}FAIL${NC}  $script_name — script not found")
        ((FAILED++))
        continue
    fi

    if bash "$script_path"; then
        log_success "$script_name completed"
        RESULTS+=("${GREEN}OK${NC}    $script_name")
        ((PASSED++))
    else
        exit_code=$?
        if [[ $exit_code -eq 2 ]]; then
            log_warn "$script_name skipped (already configured)"
            RESULTS+=("${YELLOW}SKIP${NC}  $script_name")
            ((SKIPPED++))
        else
            log_error "$script_name failed (exit code: $exit_code)"
            RESULTS+=("${RED}FAIL${NC}  $script_name")
            ((FAILED++))
        fi
    fi
done

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo -e "${BOLD}=============================================${NC}"
echo -e "${BOLD}  Setup Complete — Summary${NC}"
echo -e "${BOLD}=============================================${NC}"
echo ""

for result in "${RESULTS[@]}"; do
    echo -e "  $result"
done

echo ""
echo -e "  Passed: ${GREEN}$PASSED${NC}  Skipped: ${YELLOW}$SKIPPED${NC}  Failed: ${RED}$FAILED${NC}"
echo ""

if [[ -n "$DOMAIN" ]]; then
    DASHBOARD_URL="https://$DOMAIN"
else
    SERVER_IP=$(hostname -I | awk '{print $1}')
    DASHBOARD_URL="https://$SERVER_IP"
fi

echo -e "${BOLD}  Dashboard:${NC}  $DASHBOARD_URL"
echo -e "${BOLD}  API:${NC}        $DASHBOARD_URL/v1/"
echo -e "${BOLD}  Health:${NC}     $DASHBOARD_URL/health"
echo -e "${BOLD}  MCP SSE:${NC}    $DASHBOARD_URL/mcp/"
echo -e "${BOLD}  SSH:${NC}        ssh -p 2222 aiplatform@${DOMAIN:-$SERVER_IP}"
echo ""
echo -e "  Setup log: $LOG_FILE"
echo -e "  Finished:  $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo ""

if [[ $FAILED -gt 0 ]]; then
    log_error "Some steps failed. Review the log: $LOG_FILE"
    exit 1
fi

log_success "All steps completed successfully."
