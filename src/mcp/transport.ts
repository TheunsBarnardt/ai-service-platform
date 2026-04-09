import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { logger } from '../utils/logger.js';

/**
 * Starts the MCP server with stdio transport.
 * Used when the server is invoked as a subprocess by an MCP client.
 */
export async function startStdioTransport(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('MCP server started with stdio transport');
}

/**
 * Starts the MCP server with SSE (Server-Sent Events) transport.
 * Creates an HTTP server that handles SSE connections on GET /sse
 * and accepts messages on POST /messages.
 */
export async function startSseTransport(server: McpServer, port: number): Promise<void> {
  const sessions = new Map<string, SSEServerTransport>();

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    // CORS headers for cross-origin MCP clients
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // SSE connection endpoint
    if (req.method === 'GET' && url.pathname === '/sse') {
      const transport = new SSEServerTransport('/messages', res);
      sessions.set(transport.sessionId, transport);

      logger.info({ sessionId: transport.sessionId }, 'SSE client connected');

      res.on('close', () => {
        sessions.delete(transport.sessionId);
        logger.info({ sessionId: transport.sessionId }, 'SSE client disconnected');
      });

      await server.connect(transport);
      return;
    }

    // Message endpoint for SSE clients
    if (req.method === 'POST' && url.pathname === '/messages') {
      const sessionId = url.searchParams.get('sessionId');

      if (!sessionId || !sessions.has(sessionId)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid or missing sessionId' }));
        return;
      }

      const transport = sessions.get(sessionId)!;
      await transport.handlePostMessage(req, res);
      return;
    }

    // Health check
    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', sessions: sessions.size }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  return new Promise<void>((resolve) => {
    httpServer.listen(port, () => {
      logger.info({ port }, 'MCP SSE server listening');
      resolve();
    });
  });
}
