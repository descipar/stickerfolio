import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { clientAddressHeader, isClientAddressPreloadActive } from "./request-security";

/**
 * The preload (`scripts/client-address-preload.mjs`) must overwrite the client
 * address header with the socket address, so a client cannot choose its own
 * rate-limit bucket (#124).
 */
describe("client address preload", () => {
  let server: http.Server;
  let port: number;
  let seen: string | undefined;

  beforeAll(async () => {
    await import("../../../scripts/client-address-preload.mjs");
    server = http.createServer((request, response) => {
      seen = request.headers[clientAddressHeader] as string | undefined;
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function send(headers: Record<string, string> = {}): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const request = http.request({ host: "127.0.0.1", port, headers }, (response) => {
        response.resume();
        response.on("end", resolve);
      });
      request.on("error", reject);
      request.end();
    });
  }

  it("marks the process as having a trustworthy client address", () => {
    expect(isClientAddressPreloadActive()).toBe(true);
  });

  it("records the socket address", async () => {
    await send();
    expect(seen).toBe("127.0.0.1");
  });

  it("overwrites a client-supplied value", async () => {
    await send({ [clientAddressHeader]: "203.0.113.66" });
    expect(seen).toBe("127.0.0.1");
  });
});
