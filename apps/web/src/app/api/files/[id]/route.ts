import { readFile, userContext } from '@noergo/core';
import { apiError, apiFailure, apiUser } from '@/lib/api';

export const dynamic = 'force-dynamic';

/**
 * One stored file of the signed-in person's workspace. Files never change (a new picture
 * is a new id), so the browser keeps them. The answer can only ever be an image: no
 * sniffing, no script, not embeddable elsewhere.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiUser();
  if (!user) return apiError('unauthenticated', 'sign in first');
  const { id } = await params;
  try {
    const { workspaceId } = await userContext(user.id);
    const file = await readFile(workspaceId, id);
    const etag = `"${file.sha256}"`;
    const headers = {
      'Content-Type': file.mime,
      'Cache-Control': 'private, max-age=31536000, immutable',
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Content-Disposition': 'inline',
    };
    if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
    return new Response(new Uint8Array(file.bytes), { headers });
  } catch (err) {
    return apiFailure(err, 'GET /api/files/:id');
  }
}
