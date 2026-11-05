/**
 * Nonce-based Content Security Policy (#134). The proxy creates a fresh nonce
 * per request; Next.js reads it from the request's CSP header and adds it to
 * its own framework and page scripts, so `script-src` needs no
 * 'unsafe-inline'. `'strict-dynamic'` lets those trusted scripts load the
 * app's chunks. Inline style attributes (progress bars) still need
 * `style-src 'unsafe-inline'`; they cannot execute code.
 */
export function createCspNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64");
}

export function buildContentSecurityPolicy(nonce: string, development = false): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    // React Refresh evaluates code in development only.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self'${development ? " ws:" : ""}`,
  ].join("; ");
}
