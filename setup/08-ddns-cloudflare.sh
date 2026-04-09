#!/usr/bin/env bash
# =============================================================================
# 08 — Dynamic DNS via Cloudflare API
# Updates DNS A record when public IP changes
# =============================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log_info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
log_success() { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }

MARKER="/var/lib/ai-platform/.08-ddns-done"
DOMAIN="${DOMAIN:-}"

if [[ -f "$MARKER" ]]; then
    log_warn "DDNS already configured (marker: $MARKER). Skipping."
    exit 2
fi

# ---------------------------------------------------------------------------
# Check prerequisites
# ---------------------------------------------------------------------------
# Source platform .env if it exists (may contain Cloudflare vars)
if [[ -f /opt/ai-service-platform/.env ]]; then
    set +u
    source <(grep -E '^CLOUDFLARE_' /opt/ai-service-platform/.env 2>/dev/null || true)
    set -u
fi

CF_API_TOKEN="${CLOUDFLARE_API_TOKEN:-}"
CF_ZONE_ID="${CLOUDFLARE_ZONE_ID:-}"

if [[ -z "$CF_API_TOKEN" || -z "$CF_ZONE_ID" ]]; then
    log_warn "Cloudflare credentials not configured. Skipping DDNS setup."
    log_info "To enable DDNS, set these environment variables:"
    log_info "  CLOUDFLARE_API_TOKEN=your-api-token"
    log_info "  CLOUDFLARE_ZONE_ID=your-zone-id"
    log_info "Then re-run this script."

    # Still mark as done (not an error, just not applicable)
    mkdir -p /var/lib/ai-platform
    touch "$MARKER"
    exit 0
fi

if [[ -z "$DOMAIN" ]]; then
    log_warn "No domain configured. DDNS requires a domain. Skipping."
    mkdir -p /var/lib/ai-platform
    touch "$MARKER"
    exit 0
fi

# ---------------------------------------------------------------------------
# Create DDNS update script
# ---------------------------------------------------------------------------
log_info "Creating Cloudflare DDNS update script..."

DDNS_SCRIPT="/opt/ai-service-platform/scripts/cloudflare-ddns.sh"
mkdir -p "$(dirname "$DDNS_SCRIPT")"

cat > "$DDNS_SCRIPT" <<'DDNS'
#!/usr/bin/env bash
# =============================================================================
# Cloudflare Dynamic DNS Updater
# Checks public IP and updates DNS A record if changed
# =============================================================================
set -euo pipefail

LOG_FILE="/var/log/ai-platform/ddns.log"
IP_CACHE="/var/lib/ai-platform/.ddns-last-ip"
mkdir -p /var/lib/ai-platform /var/log/ai-platform

TIMESTAMP=$(date -u '+%Y-%m-%d %H:%M:%S UTC')

# Load configuration
CF_API_TOKEN="${CLOUDFLARE_API_TOKEN:-}"
CF_ZONE_ID="${CLOUDFLARE_ZONE_ID:-}"
CF_DOMAIN="${CLOUDFLARE_DOMAIN:-}"
CF_PROXIED="${CLOUDFLARE_PROXIED:-true}"

if [[ -z "$CF_API_TOKEN" || -z "$CF_ZONE_ID" || -z "$CF_DOMAIN" ]]; then
    echo "$TIMESTAMP [ERROR] Missing Cloudflare configuration" >> "$LOG_FILE"
    exit 1
fi

# Get current public IP (try multiple services)
CURRENT_IP=""
for service in "https://api.ipify.org" "https://ifconfig.me/ip" "https://icanhazip.com" "https://checkip.amazonaws.com"; do
    CURRENT_IP=$(curl -sf --max-time 10 "$service" 2>/dev/null | tr -d '[:space:]')
    if [[ -n "$CURRENT_IP" && "$CURRENT_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        break
    fi
    CURRENT_IP=""
done

if [[ -z "$CURRENT_IP" ]]; then
    echo "$TIMESTAMP [ERROR] Could not determine public IP" >> "$LOG_FILE"
    exit 1
fi

# Check cached IP
LAST_IP=""
if [[ -f "$IP_CACHE" ]]; then
    LAST_IP=$(cat "$IP_CACHE")
fi

if [[ "$CURRENT_IP" == "$LAST_IP" ]]; then
    # IP unchanged, nothing to do
    exit 0
fi

echo "$TIMESTAMP [INFO] IP changed: $LAST_IP -> $CURRENT_IP" >> "$LOG_FILE"

# Get existing DNS record ID
RECORD_ID=$(curl -sf \
    -H "Authorization: Bearer $CF_API_TOKEN" \
    -H "Content-Type: application/json" \
    "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records?type=A&name=$CF_DOMAIN" \
    | jq -r '.result[0].id // empty')

if [[ -z "$RECORD_ID" ]]; then
    # Create new A record
    echo "$TIMESTAMP [INFO] Creating new A record for $CF_DOMAIN" >> "$LOG_FILE"

    RESPONSE=$(curl -sf \
        -X POST \
        -H "Authorization: Bearer $CF_API_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{\"type\":\"A\",\"name\":\"$CF_DOMAIN\",\"content\":\"$CURRENT_IP\",\"proxied\":$CF_PROXIED,\"ttl\":1}" \
        "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records")

    SUCCESS=$(echo "$RESPONSE" | jq -r '.success')
    if [[ "$SUCCESS" == "true" ]]; then
        echo "$TIMESTAMP [OK] Created A record: $CF_DOMAIN -> $CURRENT_IP" >> "$LOG_FILE"
        echo "$CURRENT_IP" > "$IP_CACHE"
    else
        ERRORS=$(echo "$RESPONSE" | jq -r '.errors[].message // "unknown"')
        echo "$TIMESTAMP [ERROR] Failed to create record: $ERRORS" >> "$LOG_FILE"
        exit 1
    fi
else
    # Update existing A record
    echo "$TIMESTAMP [INFO] Updating A record $RECORD_ID for $CF_DOMAIN" >> "$LOG_FILE"

    RESPONSE=$(curl -sf \
        -X PUT \
        -H "Authorization: Bearer $CF_API_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{\"type\":\"A\",\"name\":\"$CF_DOMAIN\",\"content\":\"$CURRENT_IP\",\"proxied\":$CF_PROXIED,\"ttl\":1}" \
        "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records/$RECORD_ID")

    SUCCESS=$(echo "$RESPONSE" | jq -r '.success')
    if [[ "$SUCCESS" == "true" ]]; then
        echo "$TIMESTAMP [OK] Updated A record: $CF_DOMAIN -> $CURRENT_IP" >> "$LOG_FILE"
        echo "$CURRENT_IP" > "$IP_CACHE"
    else
        ERRORS=$(echo "$RESPONSE" | jq -r '.errors[].message // "unknown"')
        echo "$TIMESTAMP [ERROR] Failed to update record: $ERRORS" >> "$LOG_FILE"
        exit 1
    fi
fi
DDNS

chmod +x "$DDNS_SCRIPT"
log_success "DDNS update script created: $DDNS_SCRIPT"

# ---------------------------------------------------------------------------
# Install as cron job
# ---------------------------------------------------------------------------
log_info "Installing DDNS cron job (every 5 minutes)..."

CRON_FILE="/etc/cron.d/ai-platform-ddns"
cat > "$CRON_FILE" <<CRON
# Cloudflare Dynamic DNS — update every 5 minutes
CLOUDFLARE_API_TOKEN=$CF_API_TOKEN
CLOUDFLARE_ZONE_ID=$CF_ZONE_ID
CLOUDFLARE_DOMAIN=$DOMAIN
CLOUDFLARE_PROXIED=true
*/5 * * * * root $DDNS_SCRIPT
CRON
chmod 600 "$CRON_FILE"

log_success "DDNS cron job installed"

# ---------------------------------------------------------------------------
# Run initial update
# ---------------------------------------------------------------------------
log_info "Running initial DNS update..."
CLOUDFLARE_API_TOKEN="$CF_API_TOKEN" \
CLOUDFLARE_ZONE_ID="$CF_ZONE_ID" \
CLOUDFLARE_DOMAIN="$DOMAIN" \
CLOUDFLARE_PROXIED="true" \
bash "$DDNS_SCRIPT" && log_success "Initial DNS update complete" || log_warn "Initial DNS update skipped (may be first run)"

# ---------------------------------------------------------------------------
# Create marker
# ---------------------------------------------------------------------------
mkdir -p /var/lib/ai-platform
touch "$MARKER"
log_success "Dynamic DNS setup complete"
