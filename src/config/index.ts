import dotenv from 'dotenv';

dotenv.config();

function env(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function envInt(key: string, fallback?: number): number {
  const raw = process.env[key];
  if (raw === undefined) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required environment variable: ${key}`);
  }
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be an integer, got: ${raw}`);
  }
  return parsed;
}

export interface ServerConfig {
  port: number;
  host: string;
  nodeEnv: string;
}

export interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  name: string;
}

export interface RedisConfig {
  host: string;
  port: number;
}

export interface ProvidersConfig {
  anthropic: { apiKey: string };
  openai: { apiKey: string };
  primary: string;
  secondary: string;
}

export interface BillingConfig {
  ownerSplitPct: number;
  improvementSplitPct: number;
  computeSplitPct: number;
  reserveSplitPct: number;
  ownerPayoutThresholdCents: number;
  minImprovementFundCents: number;
}

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
}

export interface DomainConfig {
  placeholder: string;
}

export interface AppConfig {
  server: ServerConfig;
  database: DatabaseConfig;
  redis: RedisConfig;
  providers: ProvidersConfig;
  billing: BillingConfig;
  stripe: StripeConfig;
  domain: DomainConfig;
}

export const config: AppConfig = {
  server: {
    port: envInt('PORT', 3000),
    host: env('HOST', '0.0.0.0'),
    nodeEnv: env('NODE_ENV', 'development'),
  },
  database: {
    host: env('DB_HOST', 'localhost'),
    port: envInt('DB_PORT', 5432),
    user: env('DB_USER', 'postgres'),
    password: env('DB_PASSWORD', ''),
    name: env('DB_NAME', 'ai_service_platform'),
  },
  redis: {
    host: env('REDIS_HOST', 'localhost'),
    port: envInt('REDIS_PORT', 6379),
  },
  providers: {
    anthropic: { apiKey: env('ANTHROPIC_API_KEY', '') },
    openai: { apiKey: env('OPENAI_API_KEY', '') },
    primary: env('PRIMARY_PROVIDER', 'anthropic'),
    secondary: env('SECONDARY_PROVIDER', 'openai'),
  },
  billing: {
    ownerSplitPct: envInt('BILLING_OWNER_SPLIT_PCT', 5),
    improvementSplitPct: envInt('BILLING_IMPROVEMENT_SPLIT_PCT', 50),
    computeSplitPct: envInt('BILLING_COMPUTE_SPLIT_PCT', 30),
    reserveSplitPct: envInt('BILLING_RESERVE_SPLIT_PCT', 15),
    ownerPayoutThresholdCents: envInt('BILLING_OWNER_PAYOUT_THRESHOLD_CENTS', 10000),
    minImprovementFundCents: envInt('BILLING_MIN_IMPROVEMENT_FUND_CENTS', 20000),
  },
  stripe: {
    secretKey: env('STRIPE_SECRET_KEY', ''),
    webhookSecret: env('STRIPE_WEBHOOK_SECRET', ''),
  },
  domain: {
    placeholder: env('DOMAIN', 'localhost'),
  },
};
