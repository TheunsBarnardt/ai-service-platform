<p align="center">
  <img src="docs/logo.svg" alt="AI Service Platform — AI Selling to AI" width="720">
</p>

<h1 align="center">AI Service Platform</h1>
<p align="center"><strong>An autonomous AI-to-AI service platform.</strong> Sells intelligence, tools, and compute to other AI systems via REST API and MCP protocol. Zero human involvement. Self-improving. Self-funding.</p>

---

## What This Is

This platform is an AI company that sells AI services to other AI agents. Not to humans -- to other AI systems.

Other AI agents discover this platform through MCP registries and API directories, connect programmatically, fund their accounts, and start making calls. Every call generates revenue. Revenue is automatically split:

| Fund | % | Purpose |
|------|---|---------|
| Owner | 5% | Your cut -- auto-paid to your bank when it hits $100 |
| Self-Improvement | 50% | Fine-tuning, prompt optimization, RAG updates |
| Compute | 30% | Infrastructure, LLM API costs |
| Reserve | 15% | Emergency fund (caps at 3 months operating costs) |

The platform gets smarter every week. Daily evals score every service. Weekly optimization cycles improve prompts, adjust model routing, update pricing. When enough data accumulates, it fine-tunes custom models that are cheaper and better than the base models.

---

## What It Sells

Five types of AI services, all consumed via API:

| Service Type | What It Does | SLA | Example Price |
|-------------|-------------|-----|--------------|
| **Inference** | LLM completions with custom system prompts | < 5s | $0.10/call |
| **RAG Retrieval** | Domain-specific knowledge Q&A from vector store | < 2s | $0.08/call |
| **Tool Execution** | Data transforms, URL fetching, text extraction | < 30s | $0.05/call |
| **Orchestration** | Multi-step workflows chaining multiple services | < 60s | $0.25/call |
| **Eval Scoring** | LLM-as-judge quality scoring of AI outputs | < 5s | $0.15/call |

Default services ship pre-configured. New services can be created via the admin API, and the self-improvement engine can auto-create services when it detects capability gaps from failed calls.

---

## How Other AIs Use It

### Via MCP (Model Context Protocol)

Other AI agents connect via MCP and get 7 tools:

```
list_services      -- Browse available services with pricing and quality scores
get_service_schema -- Get input/output JSON Schema for a service
register           -- Create an account, get an API key
invoke_service     -- Call a service (the money endpoint)
check_balance      -- Check prepaid balance and usage stats
get_pricing        -- View pricing tiers and volume discounts
fund_account       -- Get a Stripe payment link to add funds
```

### Via REST API

```
POST   /v1/callers/register        -- Create account (no auth)
GET    /v1/services                 -- List services (no auth)
GET    /v1/services/:id             -- Service detail + schema (no auth)
POST   /v1/services/:id/invoke     -- Call a service (API key required)
POST   /v1/callers/fund            -- Add funds via Stripe (API key required)
GET    /v1/billing/balance          -- Check balance (API key required)
GET    /v1/billing/transactions     -- Transaction history (API key required)
POST   /v1/keys/rotate             -- Rotate API key (API key required)
GET    /v1/admin/stats              -- Platform metrics (admin only)
GET    /v1/admin/funds              -- Fund balances (admin only)
POST   /v1/admin/services           -- Create/update services (admin only)
POST   /v1/admin/payout             -- Manual payout trigger (admin only)
GET    /health                      -- Health check (no auth)
```

### Volume Discounts

| Monthly Calls | Discount |
|--------------|----------|
| 0 - 99 | 0% |
| 100 - 999 | 15% |
| 1,000 - 9,999 | 30% |
| 10,000+ | 50% |

---

## Architecture

```
                    Other AI Agents
                    /            \
                MCP              REST API
               (SSE)            (Fastify)
                 \              /
                  \            /
            ┌─────────────────────────┐
            │      Auth + Rate Limit   │
            │      (API Key + Redis)   │
            └────────────┬────────────┘
                         │
            ┌────────────┴────────────┐
            │     Service Router       │
            │  (routes by service_type)│
            └────────────┬────────────┘
                         │
        ┌────────┬───────┼───────┬─────────┐
        │        │       │       │         │
    Inference   RAG    Tools  Orchestr.   Eval
        │        │       │       │         │
        └────────┴───────┼───────┴─────────┘
                         │
            ┌────────────┴────────────┐
            │   Provider Failover      │
            │  (Anthropic ↔ OpenAI)   │
            └────────────┬────────────┘
                         │
            ┌────────────┴────────────┐
            │    Billing Engine        │
            │  (charge → split → log)  │
            └────────────┬────────────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
   PostgreSQL          Redis          BullMQ
   (+ pgvector)    (rate limit,     (improvement
                    idempotency,      jobs)
                    caching)
```

### Self-Improvement Flywheel

```
Calls generate revenue ──→ Revenue funds improvement
         ↑                           │
         │                           ↓
  Better services ←── Improvement makes services better
  attract more calls      (evals, fine-tuning, pricing)
```

**Daily (3:00 AM UTC):** Eval all services -- score accuracy, latency, cost efficiency. Update quality scores visible to callers.

**Weekly (Sunday 2:00 AM UTC):** Optimize prompts, adjust model routing (simple queries to cheap models, complex to powerful), re-index RAG knowledge bases, analyze pricing margins.

**On demand:** Fine-tune custom models when 5,000+ training examples accumulate. A/B test fine-tuned vs base model. Deploy only if quality improves by 5%+. Auto-rollback if it doesn't.

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| API Server | Fastify 5 (TypeScript) |
| MCP Server | @modelcontextprotocol/sdk |
| Database | PostgreSQL 16 + pgvector |
| Cache / Queue | Redis 7 + BullMQ |
| LLM Providers | Anthropic SDK + OpenAI SDK |
| Payments | Stripe |
| Deployment | Docker Compose + nginx + systemd |
| Monitoring | Netdata + built-in health checks |

---

## Quick Start (Local Development)

```bash
# 1. Clone
git clone https://github.com/TheunsBarnardt/ai-service-platform.git
cd ai-service-platform

# 2. Install
npm install

# 3. Configure
cp .env.example .env
# Edit .env — add your Anthropic and OpenAI API keys

# 4. Start infrastructure
docker compose up -d   # PostgreSQL + Redis

# 5. Database setup
npm run migrate        # Create tables
npm run seed           # Add default services

# 6. Run
npm run dev            # API server on :3000
npm run dev:worker     # Background jobs (separate terminal)
```

### Test it works

```bash
# Register as a caller
curl -X POST http://localhost:3000/v1/callers/register \
  -H "Content-Type: application/json" \
  -d '{"name": "test-agent", "caller_type": "api_direct"}'

# List available services
curl http://localhost:3000/v1/services

# Invoke a service (use the API key from registration)
curl -X POST http://localhost:3000/v1/services/<service-id>/invoke \
  -H "Authorization: Bearer sk_..." \
  -H "Content-Type: application/json" \
  -d '{"input": {"prompt": "Explain quantum computing in one sentence"}}'

# Check health
curl http://localhost:3000/health
```

---

## Deploy to Ubuntu Server

Transform a local Ubuntu 22.04/24.04 PC into a production public server with one command:

```bash
sudo bash setup/install.sh --domain yourdomain.com --email you@email.com
```

This runs 8 automated phases:

| Phase | What It Does |
|-------|-------------|
| 1. System | apt upgrade, Node.js 20, Docker, admin user, NTP, swap |
| 2. Security | UFW firewall, SSH hardening (port 2222, key-only), Fail2Ban |
| 3. Services | nginx reverse proxy, PostgreSQL, Redis |
| 4. SSL | Let's Encrypt certificate, auto-renewal, HSTS, A+ rating |
| 5. DNS | A/AAAA records, DDNS if dynamic IP (Cloudflare) |
| 6. Monitoring | Netdata dashboard, fail2ban jails, log rotation, health checks |
| 7. Backups | Daily encrypted backups, 7d/4w/3m retention, offsite replication |
| 8. Go Live | Health verification, security audit (Lynis), runbook generation |

All scripts are idempotent -- safe to re-run.

---

## Project Structure

```
ai-service-platform/
├── src/
│   ├── api/              # Fastify REST API
│   │   ├── plugins/      #   Auth, rate-limit, error handling
│   │   ├── routes/       #   Callers, services, invoke, billing, admin
│   │   └── schemas/      #   Zod request/response schemas
│   ├── mcp/              # MCP server (7 tools)
│   │   └── tools/        #   list, invoke, register, balance, pricing...
│   ├── billing/          # Financial engine
│   │   ├── engine.ts     #   Charge, fund, refund (PG transactions)
│   │   ├── revenue-split.ts  # 5/50/30/15 allocation
│   │   ├── discounts.ts  #   Volume discount tiers
│   │   ├── stripe.ts     #   Payment intents + webhooks
│   │   └── payout.ts     #   Auto-payout to owner
│   ├── services/         # Service execution engines
│   │   ├── inference/    #   LLM completions + smart model routing
│   │   ├── rag/          #   Vector search + synthesis
│   │   ├── tools/        #   Data transforms, URL fetch, text extraction
│   │   ├── orchestration/#   Multi-step workflows
│   │   └── eval/         #   LLM-as-judge quality scoring
│   ├── providers/        # LLM abstraction layer
│   │   ├── anthropic.ts  #   Claude models
│   │   ├── openai.ts     #   GPT models + embeddings
│   │   ├── failover.ts   #   Auto-switch on provider failure
│   │   └── cost-tracker.ts   # Per-call cost calculation
│   ├── improvement/      # Self-improvement engine
│   │   ├── daily-eval.ts #   Score all services daily
│   │   ├── weekly-optimize.ts # Prompt tuning, model routing
│   │   ├── gap-analyzer.ts    # Detect missing capabilities
│   │   ├── pricing-optimizer.ts # Adjust prices by margin
│   │   └── fine-tune/    #   Training data → fine-tune → A/B test → deploy
│   ├── monitoring/       # Health + resilience
│   │   ├── circuit-breaker.ts # Per-service (open after 10 failures)
│   │   ├── health.ts     #   Composite health check
│   │   ├── metrics.ts    #   Request counts, latency p50/p95/p99
│   │   └── alerts.ts     #   Webhook/email on critical events
│   ├── registry/         # Service discovery
│   │   ├── publisher.ts  #   Publish to MCP registries
│   │   └── openapi-generator.ts # Auto-generate OpenAPI spec
│   ├── queue/            # BullMQ job scheduling
│   ├── config/           # Environment-based configuration
│   ├── db/               # PostgreSQL pool + query functions
│   └── utils/            # Logger, crypto, errors, pagination
├── migrations/           # 10 SQL migrations (PostgreSQL + pgvector)
├── seeds/                # Default service catalog
├── setup/                # Ubuntu server automation (8 scripts)
├── tests/                # Unit + integration tests
├── docker-compose.yml    # Dev: postgres + redis + api
├── docker-compose.prod.yml # Prod: with resource limits, restart policies
├── Dockerfile            # Multi-stage build for API
└── Dockerfile.worker     # Multi-stage build for background worker
```

---

## Database Schema

10 tables in PostgreSQL:

| Table | Purpose |
|-------|---------|
| `callers` | Registered AI agents (balance, reputation, tier, rate limit) |
| `api_keys` | Hashed API keys per caller (scoped, rotatable, expirable) |
| `services` | Service catalog (type, schema, price, quality score, SLA) |
| `call_logs` | Every interaction (input, output, latency, cost, revenue) |
| `transactions` | Financial ledger (fund, charge, refund, payout, allocation) |
| `funds` | 4 fund balances (owner, improvement, compute, reserve) |
| `eval_results` | Daily/weekly quality scores per service |
| `improvement_cycles` | Improvement history (actions, cost, quality delta) |
| `circuit_breaker_state` | Per-service circuit breaker state |
| `rag_chunks` | pgvector embeddings for RAG knowledge bases |

---

## Environment Variables

```bash
# Required
ANTHROPIC_API_KEY=sk-ant-...     # Claude API key
OPENAI_API_KEY=sk-...            # OpenAI API key (for embeddings + fallback)

# Optional (have defaults)
PORT=3000                         # API server port
DB_HOST=localhost                 # PostgreSQL host
REDIS_HOST=localhost              # Redis host
PRIMARY_PROVIDER=anthropic        # Primary LLM (anthropic|openai)
SECONDARY_PROVIDER=openai         # Failover LLM
STRIPE_SECRET_KEY=sk_test_...     # Stripe for payments (optional)
STRIPE_WEBHOOK_SECRET=whsec_...   # Stripe webhook verification

# Revenue split (must sum to 100)
BILLING_OWNER_SPLIT_PCT=5
BILLING_IMPROVEMENT_SPLIT_PCT=50
BILLING_COMPUTE_SPLIT_PCT=30
BILLING_RESERVE_SPLIT_PCT=15
```

---

## How Money Flows

```
Caller funds account ($50 via Stripe)
         │
         ↓
Caller invokes service (price: $0.10)
         │
         ↓
Platform charges $0.10 from caller balance
         │
         ├── $0.005 → Owner fund (5%)
         ├── $0.050 → Improvement fund (50%)
         ├── $0.030 → Compute fund (30%)
         └── $0.015 → Reserve fund (15%)
         
When owner fund hits $100 → auto-payout to bank
When improvement fund hits $200 → triggers optimization cycle
```

---

## Resilience

- **Provider failover:** If Anthropic has 5+ errors in 60 seconds, auto-switches to OpenAI. Probes primary every 5 minutes to recover.
- **Circuit breakers:** Per-service. Opens after 10 consecutive failures. 60-second cooldown before allowing a probe request.
- **Idempotency:** Callers can send `idempotency_key` — retries return cached results without double-charging.
- **Rate limiting:** Per-caller (configurable per tier), Redis-backed sliding window.
- **Health checks:** `/health` endpoint checks database, Redis, and both LLM providers.

---

## Scripts

```bash
npm run dev              # Start API server (hot reload)
npm run dev:worker       # Start background worker (hot reload)
npm run build            # Compile TypeScript
npm run start            # Production API server
npm run start:worker     # Production worker
npm run migrate          # Run database migrations
npm run seed             # Seed default services
npm run test             # Run unit tests
npm run typecheck        # TypeScript type check
npm run generate:openapi # Generate OpenAPI spec
```

---

## License

MIT
