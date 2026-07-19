export const maximumJsonRequestBytes = 32 * 1024;

export type LimitedBodyResult<T> =
  | { status: "ok"; value: T }
  | { status: "invalid" }
  | { status: "too-large" };

async function readLimitedBytes(
  request: Request,
  maximumBytes: number,
): Promise<LimitedBodyResult<Uint8Array>> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const declaredLength = Number(contentLength);
    if (!Number.isSafeInteger(declaredLength) || declaredLength < 0) return { status: "invalid" };
    if (declaredLength > maximumBytes) return { status: "too-large" };
  }

  if (!request.body) return { status: "ok", value: new Uint8Array() };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    totalBytes += chunk.value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel();
      return { status: "too-large" };
    }
    chunks.push(chunk.value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { status: "ok", value: body };
}

export async function readLimitedJson(
  request: Request,
  maximumBytes = maximumJsonRequestBytes,
): Promise<LimitedBodyResult<unknown>> {
  const body = await readLimitedBytes(request, maximumBytes);
  if (body.status !== "ok") return body;
  try {
    return { status: "ok", value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body.value)) };
  } catch {
    return { status: "invalid" };
  }
}

export async function readLimitedText(
  request: Request,
  maximumBytes: number,
): Promise<LimitedBodyResult<string>> {
  const body = await readLimitedBytes(request, maximumBytes);
  if (body.status !== "ok") return body;
  try {
    return {
      status: "ok",
      value: new TextDecoder("utf-8", { fatal: true }).decode(body.value),
    };
  } catch {
    return { status: "invalid" };
  }
}

export async function cloneWithLimitedBody(
  request: Request,
  maximumBytes = maximumJsonRequestBytes,
): Promise<LimitedBodyResult<Request>> {
  const body = await readLimitedBytes(request, maximumBytes);
  if (body.status !== "ok") return body;
  const copy = new Uint8Array(body.value.byteLength);
  copy.set(body.value);
  return { status: "ok", value: new Request(request, { body: copy.buffer }) };
}
