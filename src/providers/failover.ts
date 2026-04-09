import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import type { LLMProvider } from './interface.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';

const ERROR_WINDOW_MS = 60_000;
const ERROR_THRESHOLD = 5;
const RECOVERY_DELAY_MS = 5 * 60_000;

interface ErrorWindow {
  timestamps: number[];
}

let primaryProvider: LLMProvider;
let secondaryProvider: LLMProvider;
let activeProviderName: string;
let failedOver = false;
let recoveryTimer: ReturnType<typeof setTimeout> | null = null;

const errorWindows = new Map<string, ErrorWindow>();

function createProvider(name: string): LLMProvider {
  switch (name) {
    case 'anthropic':
      return new AnthropicProvider();
    case 'openai':
      return new OpenAIProvider();
    default:
      throw new Error(`Unknown provider: ${name}`);
  }
}

function init(): void {
  if (primaryProvider) return;
  primaryProvider = createProvider(config.providers.primary);
  secondaryProvider = createProvider(config.providers.secondary);
  activeProviderName = config.providers.primary;
}

function pruneWindow(window: ErrorWindow): void {
  const cutoff = Date.now() - ERROR_WINDOW_MS;
  window.timestamps = window.timestamps.filter((t) => t > cutoff);
}

function getWindow(providerName: string): ErrorWindow {
  let window = errorWindows.get(providerName);
  if (!window) {
    window = { timestamps: [] };
    errorWindows.set(providerName, window);
  }
  return window;
}

export function reportError(providerName: string): void {
  init();
  const window = getWindow(providerName);
  window.timestamps.push(Date.now());
  pruneWindow(window);

  if (
    providerName === config.providers.primary &&
    !failedOver &&
    window.timestamps.length >= ERROR_THRESHOLD
  ) {
    logger.warn(
      { provider: providerName, errors: window.timestamps.length },
      'Primary provider error threshold reached, failing over to secondary',
    );
    failedOver = true;
    activeProviderName = config.providers.secondary;
    scheduleRecovery();
  }
}

export function reportSuccess(providerName: string): void {
  init();
  const window = getWindow(providerName);
  // Clear errors on success for this provider
  window.timestamps = [];
}

function scheduleRecovery(): void {
  if (recoveryTimer) return;

  recoveryTimer = setTimeout(async () => {
    recoveryTimer = null;
    logger.info('Attempting recovery probe on primary provider');

    try {
      await primaryProvider.complete(
        [{ role: 'user', content: 'ping' }],
        { maxTokens: 5 },
      );

      logger.info('Primary provider recovered, switching back');
      failedOver = false;
      activeProviderName = config.providers.primary;
      const window = getWindow(config.providers.primary);
      window.timestamps = [];
    } catch {
      logger.warn('Primary provider still unhealthy, staying on secondary');
      scheduleRecovery();
    }
  }, RECOVERY_DELAY_MS);
}

export function getProvider(): LLMProvider {
  init();
  return failedOver ? secondaryProvider : primaryProvider;
}

/** Returns the OpenAI provider specifically for embeddings. */
export function getEmbeddingProvider(): LLMProvider {
  init();
  // OpenAI is always used for embeddings since Anthropic lacks an embedding API
  if (secondaryProvider.name === 'openai') return secondaryProvider;
  if (primaryProvider.name === 'openai') return primaryProvider;
  return new OpenAIProvider();
}

export function getActiveProviderName(): string {
  init();
  return activeProviderName;
}
