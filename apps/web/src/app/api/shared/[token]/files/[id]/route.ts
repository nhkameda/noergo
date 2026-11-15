import { sharedFile } from '@noergo/core';
import { apiFailure } from '@/lib/api';
import { sharedRequest } from '@/lib/shared';

export const dynamic = 'force-dynamic';

/**
 * A file a shared link shows (a thought's cover). As /api/files/:id, it can only ever be
 * an image; unlike it, the browser revalidates, so a link turned off stops serving it.
 */
export async function GET(req: Request, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  const r = await sharedRequest(req, token, 'file', 240);
  if ('error' in r) return r.error;
  try {
    const file = await sharedFile(r.link, id.toLowerCase());
    const etag = `"${file.sha256}"`;
    const headers = {
      'Content-Type': file.mime,
      'Cache-Control': 'private, no-cache',
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Content-Disposition': 'inline',
    };
    if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
    return new Response(new Uint8Array(file.bytes), { headers });
  } catch (err) {
    return apiFailure(err, 'GET /api/shared/:token/files/:id');
  }
}
