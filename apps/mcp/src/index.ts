import { createServer } from 'node:http';
import { getDb, sql } from '@noergo/core/db';

/**
 * The MCP endpoint and the OAuth 2.1 authorization server for agents. This first version
 * only answers the health probe; the protocol lands in phase F1 (see docs/architecture.md).
 */
const port = Number(process.env.MCP_PORT ?? 3042);
const host = process.env.MCP_HOST ?? '127.0.0.1';

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    try {
      await sql`SELECT 1`.execute(getDb());
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end('{"ok":true}');
    } catch {
      res.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end('{"ok":false}');
    }
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not_found"}');
});

server.listen(port, host, () => console.info(JSON.stringify({ mcp: 'listening', host, port })));

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
