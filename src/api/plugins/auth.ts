import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { pool } from '../../config/database.js';
import { hashApiKey } from '../../utils/crypto.js';
import { UnauthorizedError } from '../../utils/errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    callerId: string | null;
    callerTier: string | null;
  }
}

/** Routes that bypass authentication */
const PUBLIC_PREFIXES = [
  '/health',
  '/docs',
  '/documentation',
];

const PUBLIC_ROUTES = new Set([
  '/api/v1/auth/register',
  '/api/v1/services',
]);

function isPublicRoute(url: string): boolean {
  const path = url.split('?')[0];

  if (PUBLIC_ROUTES.has(path)) return true;

  for (const prefix of PUBLIC_PREFIXES) {
    if (path.startsWith(prefix)) return true;
  }

  return false;
}

const authPlugin: FastifyPluginAsync = async (fastify) => {
  // Decorate request with caller fields
  fastify.decorateRequest('callerId', null);
  fastify.decorateRequest('callerTier', null);

  fastify.addHook(
    'onRequest',
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Skip auth for public routes
      if (isPublicRoute(request.url)) {
        return;
      }

      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new UnauthorizedError('Missing or malformed Authorization header');
      }

      const token = authHeader.slice(7);
      if (!token) {
        throw new UnauthorizedError('Empty bearer token');
      }

      const keyHash = hashApiKey(token);

      const result = await pool.query<{
        caller_id: string;
        is_active: boolean;
        expires_at: Date | null;
        tier: string;
      }>(
        `SELECT ak.caller_id, ak.is_active, ak.expires_at, c.tier
         FROM api_keys ak
         JOIN callers c ON c.id = ak.caller_id
         WHERE ak.key_hash = $1
         LIMIT 1`,
        [keyHash],
      );

      if (result.rows.length === 0) {
        throw new UnauthorizedError('Invalid API key');
      }

      const row = result.rows[0];

      if (!row.is_active) {
        throw new UnauthorizedError('API key is deactivated');
      }

      if (row.expires_at && new Date(row.expires_at) < new Date()) {
        throw new UnauthorizedError('API key has expired');
      }

      request.callerId = row.caller_id;
      request.callerTier = row.tier;
    },
  );
};

export const auth = fp(authPlugin, {
  name: 'auth',
  fastify: '5.x',
});
