import { describe, expect, it } from "vitest";

import nextConfig from "../../../next.config";

describe("direct comparison response policy", () => {
  it("prevents caching, indexing, and referrer leakage for tokenized pages", async () => {
    const configured = await nextConfig.headers!();
    const compareHeaders = configured.find((entry) => entry.source === "/compare/:path*")?.headers;

    expect(compareHeaders).toEqual(expect.arrayContaining([
      { key: "Cache-Control", value: "private, no-store, max-age=0" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
    ]));
  });
});
