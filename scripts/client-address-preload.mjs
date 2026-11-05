/**
 * Records each HTTP request's socket address in a header the application can
 * trust (#124).
 *
 * Next.js does not expose the socket address to route handlers, and its own
 * `x-forwarded-for` keeps any value the client sent. Without a trusted reverse
 * proxy, rate limits therefore had no per-client key and all clients shared one
 * bucket. Loaded with `node --import`, this module overwrites
 * `x-stickerfolio-client-address` on every incoming request with the
 * connection's remote address, so clients cannot choose it. The marker on
 * `globalThis` tells the application that the header is trustworthy; without
 * the preload the header is ignored.
 *
 * Behind a reverse proxy, the socket address is the proxy's address. Configure
 * AUTH_TRUSTED_IP_HEADER in that case.
 */
import http from "node:http";

const header = "x-stickerfolio-client-address";
const marker = Symbol.for("stickerfolio.clientAddressPreload");

function normalize(address) {
  if (typeof address !== "string" || address.length === 0) return undefined;
  // IPv4 clients on a dual-stack socket appear as IPv4-mapped IPv6 addresses.
  return address.startsWith("::ffff:") && address.includes(".") ? address.slice(7) : address;
}

if (!globalThis[marker]) {
  const originalEmit = http.Server.prototype.emit;
  http.Server.prototype.emit = function emitWithClientAddress(event, request, ...rest) {
    if (event === "request" && request && request.headers) {
      const address = normalize(request.socket && request.socket.remoteAddress);
      if (address) request.headers[header] = address;
      else delete request.headers[header];
    }
    return originalEmit.call(this, event, request, ...rest);
  };
  globalThis[marker] = true;
}
