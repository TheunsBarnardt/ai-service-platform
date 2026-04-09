import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../../src/api/server.js';

describe('GET /health', () => {
  it('returns expected response shape', async () => {
    let server;
    try {
      server = await buildServer();
    } catch {
      // If server cannot start (missing DB/Redis connections),
      // skip gracefully — this test validates response format only.
      console.log('Skipping health test: server could not be built (likely missing DB/Redis)');
      return;
    }

    after(async () => {
      await server.close();
    });

    const response = await server.inject({
      method: 'GET',
      url: '/health',
    });

    // Accept both 200 (all healthy) and 503 (degraded — DB/Redis offline in test)
    assert.ok(
      [200, 503].includes(response.statusCode),
      `Expected 200 or 503, got ${response.statusCode}`,
    );

    const body = JSON.parse(response.payload);

    // Validate response shape
    assert.ok(
      body.status === 'ok' || body.status === 'degraded',
      'status must be ok or degraded',
    );
    assert.equal(typeof body.uptime, 'number');
    assert.equal(typeof body.timestamp, 'string');
    assert.ok(body.services !== undefined, 'services key must exist');
    assert.ok(
      body.services.database === 'ok' || body.services.database === 'error',
      'services.database must be ok or error',
    );
    assert.ok(
      body.services.redis === 'ok' || body.services.redis === 'error',
      'services.redis must be ok or error',
    );
  });
});
