import { BaseService, type ServiceRecord } from '../base-service.js';
import { logger } from '../../utils/logger.js';

type ToolHandler = (params: Record<string, unknown>) => Promise<unknown>;

const ALLOWED_URL_PROTOCOLS = ['https:', 'http:'];
const MAX_FETCH_SIZE = 1_048_576; // 1MB

const toolHandlers: Record<string, ToolHandler> = {
  async transform_json(params) {
    const data = params.data;
    const path = params.path as string;

    if (!data || !path) {
      throw new Error('transform_json requires "data" and "path" params');
    }

    // Simple dot-path extraction (jq-like but safe)
    const parts = path.split('.');
    let current: unknown = data;
    for (const part of parts) {
      if (current === null || current === undefined) break;
      if (typeof current === 'object' && !Array.isArray(current)) {
        current = (current as Record<string, unknown>)[part];
      } else if (Array.isArray(current)) {
        const idx = parseInt(part, 10);
        current = isNaN(idx) ? undefined : current[idx];
      } else {
        current = undefined;
      }
    }

    return { extracted: current };
  },

  async fetch_url(params) {
    const url = params.url as string;
    if (!url) {
      throw new Error('fetch_url requires "url" param');
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Invalid URL: ${url}`);
    }

    if (!ALLOWED_URL_PROTOCOLS.includes(parsed.protocol)) {
      throw new Error(`Unsupported protocol: ${parsed.protocol}`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: { 'User-Agent': 'ai-service-platform/1.0' },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > MAX_FETCH_SIZE) {
        throw new Error('Response too large (>1MB)');
      }

      const body = await response.text();
      return { body: body.slice(0, MAX_FETCH_SIZE), status: response.status };
    } finally {
      clearTimeout(timeout);
    }
  },

  async extract_text(params) {
    const data = params.data;
    const format = (params.format as string) ?? 'json';

    if (data === undefined || data === null) {
      throw new Error('extract_text requires "data" param');
    }

    if (format === 'json') {
      if (typeof data === 'string') {
        try {
          const parsed = JSON.parse(data);
          return { text: extractTextFromObject(parsed) };
        } catch {
          return { text: data };
        }
      }
      return { text: extractTextFromObject(data) };
    }

    if (format === 'html') {
      const html = typeof data === 'string' ? data : String(data);
      // Basic HTML tag stripping (safe, no eval)
      const text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return { text };
    }

    return { text: String(data) };
  },
};

function extractTextFromObject(obj: unknown): string {
  if (typeof obj === 'string') return obj;
  if (obj === null || obj === undefined) return '';
  if (typeof obj !== 'object') return String(obj);

  const parts: string[] = [];
  const values = Array.isArray(obj) ? obj : Object.values(obj);
  for (const val of values) {
    const text = extractTextFromObject(val);
    if (text) parts.push(text);
  }
  return parts.join(' ');
}

export class ToolExecutorService extends BaseService {
  async execute(
    _service: ServiceRecord,
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const tool = input.tool as string;
    const params = (input.params as Record<string, unknown>) ?? {};

    if (!tool) {
      throw new Error('Missing required field: tool');
    }

    const handler = toolHandlers[tool];
    if (!handler) {
      throw new Error(`Unknown tool: ${tool}. Available: ${Object.keys(toolHandlers).join(', ')}`);
    }

    logger.debug({ tool, params: Object.keys(params) }, 'Executing tool');

    const result = await handler(params);

    return {
      result,
      tool_used: tool,
      tokensInput: 0,
      tokensOutput: 0,
      latencyMs: 0,
    };
  }
}
