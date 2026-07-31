import { describe, expect, it } from "vitest";

import nextConfig from "../../../next.config";

describe("public share response policy", () => {
  it("prevents caching, indexing, and referrer leakage for tokenized pages", async () => {
    const configured = await nextConfig.headers!();
    const shareHeaders = configured.find((entry) => entry.source === "/share/:path*")?.headers;

    expect(shareHeaders).toEqual(expect.arrayContaining([
      { key: "Cache-Control", value: "private, no-store, max-age=0" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
    ]));
  });
});
