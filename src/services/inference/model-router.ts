const CODE_PATTERNS = [
  /```/,
  /function\s/,
  /class\s/,
  /import\s/,
  /export\s/,
  /const\s/,
  /async\s/,
  /=>/,
  /\bdef\s/,
  /\bSQL\b/i,
];

const TECHNICAL_TERMS = [
  'algorithm', 'architecture', 'kubernetes', 'docker', 'microservice',
  'distributed', 'concurrency', 'optimization', 'cryptography', 'protocol',
  'compiler', 'database', 'infrastructure', 'pipeline', 'deployment',
];

const CHEAP_MODELS: Record<string, string> = {
  anthropic: 'claude-haiku-4-5-20251001',
  openai: 'gpt-4o-mini',
};

const POWERFUL_MODELS: Record<string, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
};

const TOKEN_THRESHOLD = 500;

function estimateTokens(text: string): number {
  // Rough estimate: ~4 chars per token
  return Math.ceil(text.length / 4);
}

function hasCodeContent(text: string): boolean {
  return CODE_PATTERNS.some((pattern) => pattern.test(text));
}

function hasTechnicalTerms(text: string): boolean {
  const lower = text.toLowerCase();
  return TECHNICAL_TERMS.some((term) => lower.includes(term));
}

/**
 * Select the appropriate model based on input complexity.
 * Simple queries (<500 tokens, no code/technical content) use cheap models.
 * Complex queries use powerful models.
 */
export function selectModel(
  input: string,
  serviceConfig?: Record<string, unknown>,
): string {
  // If the service explicitly specifies a model, use it
  if (serviceConfig?.model && typeof serviceConfig.model === 'string') {
    return serviceConfig.model;
  }

  const provider = (serviceConfig?.provider as string) ?? 'anthropic';
  const tokenEstimate = estimateTokens(input);
  const isComplex =
    tokenEstimate > TOKEN_THRESHOLD ||
    hasCodeContent(input) ||
    hasTechnicalTerms(input);

  const modelMap = isComplex ? POWERFUL_MODELS : CHEAP_MODELS;
  return modelMap[provider] ?? modelMap['anthropic'];
}
