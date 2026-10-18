/**
 * Reads a request body up to maxBytes, counting bytes as they arrive: Content-Length can
 * be absent (chunked) or a lie. Returns null when the body is too large or too slow.
 */
export async function readBoundedBytes(req: Request, maxBytes: number, timeoutMs = 10_000): Promise<Uint8Array | null> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    void req.body?.cancel().catch(() => {});
    return null;
  }
  const reader = req.body?.getReader();
  if (!reader) return new Uint8Array(0);
  // One allocation up front: a stream of one-byte chunks must not multiply overhead.
  // A declared length sizes it; a lying one only means the read stops at maxBytes.
  let bytes = new Uint8Array(declared > 0 ? declared : maxBytes);
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('body_read_timeout')), timeoutMs);
  });
  try {
    const consume = async (): Promise<Uint8Array | null> => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return bytes.subarray(0, size);
        if (size + value.byteLength > maxBytes) {
          void reader.cancel().catch(() => {});
          return null;
        }
        if (size + value.byteLength > bytes.byteLength) {
          const grown = new Uint8Array(maxBytes);
          grown.set(bytes.subarray(0, size));
          bytes = grown;
        }
        bytes.set(value, size);
        size += value.byteLength;
      }
    };
    return await Promise.race([consume(), expired]);
  } catch {
    void reader.cancel().catch(() => {});
    return null;
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}

export async function readBoundedText(req: Request, maxBytes: number, timeoutMs = 10_000): Promise<string | null> {
  const bytes = await readBoundedBytes(req, maxBytes, timeoutMs);
  return bytes === null ? null : new TextDecoder().decode(bytes);
}
