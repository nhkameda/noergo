import type { IncomingMessage, ServerResponse } from 'node:http';

export function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers }).end(JSON.stringify(body));
}

/**
 * The client's address as the reverse proxy saw it. mcp listens only behind the proxy
 * (loopback or the compose network), which sets X-Real-IP (Nginx) or X-Forwarded-For (Caddy).
 */
export function clientIp(req: IncomingMessage): string | null {
  const real = req.headers['x-real-ip'];
  if (typeof real === 'string' && real) return real.trim();
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0]!.trim();
  return req.socket.remoteAddress ?? null;
}

export const header = (req: IncomingMessage, name: string): string | null => {
  const v = req.headers[name];
  return typeof v === 'string' ? v : null;
};

/** The request body as text, or null past `max` bytes or `timeoutMs`. */
export async function readBody(req: IncomingMessage, max: number, timeoutMs = 10_000): Promise<string | null> {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > max) return null;
  const chunks: Buffer[] = [];
  let size = 0;
  const timer = setTimeout(() => req.destroy(new Error('body timeout')), timeoutMs);
  try {
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > max) return null;
      chunks.push(chunk as Buffer);
    }
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
  return Buffer.concat(chunks).toString('utf8');
}
