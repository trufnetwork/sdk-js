import { describe, expect, it } from "vitest";
import {
  capabilitiesAllow,
  capabilitiesPermits,
  capabilitiesSupports,
} from "./capabilities";
import { V1Client } from "./client";
import { NamespaceUnavailableError } from "./errors";
import type { V1Success } from "./types";

/** Tests for client composition, capability gating, and namespace routes. */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const envelope = (data: unknown): unknown => ({
  ok: true,
  data,
  meta_data: { cursor: null, data_version: "1" },
});

interface Captured {
  url: string;
  headers: Headers;
}

function makeClient(
  handler: (url: string) => unknown,
  options: { token?: string } = {},
): { client: V1Client; calls: Captured[] } {
  const calls: Captured[] = [];
  const fetchImpl = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    calls.push({ url: String(input), headers: new Headers(init?.headers) });
    return jsonResponse(handler(String(input)));
  };
  const client = new V1Client({
    baseUrl: "https://api.example.com",
    network: "mainnet",
    fetch: fetchImpl,
    token: options.token,
  });
  return { client, calls };
}

describe("V1Client capabilities", () => {
  it("caches the document and refetches only when forced", async () => {
    const { client, calls } = makeClient(() =>
      envelope({ network: "mainnet", namespaces: ["markets", "streams"] }),
    );

    const first = await client.loadCapabilities();
    const second = await client.loadCapabilities();
    await client.loadCapabilities(true);

    expect(first).toBe(second);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe(
      "https://api.example.com/mainnet/v1/capabilities",
    );
  });

  it("treats every namespace as supported until capabilities are loaded", () => {
    const { client } = makeClient(() => envelope({}));
    expect(client.capabilities).toBeNull();
    expect(client.supportsNamespace("bridge")).toBe(true);
    expect(client.namespace("bridge").name).toBe("bridge");
  });

  it("gates namespaces from the cached document", async () => {
    const { client } = makeClient(() =>
      envelope({ network: "mainnet", namespaces: ["markets", "streams"] }),
    );

    await client.loadCapabilities();

    expect(client.supportsNamespace("markets")).toBe(true);
    expect(client.supportsNamespace("bridge")).toBe(false);
    expect(client.offersNamespace("bridge")).toBe(false);
    expect(() => client.namespace("bridge")).toThrow(NamespaceUnavailableError);
    expect(client.namespace("markets").name).toBe("markets");
  });

  it("distinguishes not-permitted from not-offered", async () => {
    const { client } = makeClient(() =>
      envelope({
        network: "mainnet",
        namespaces: ["markets", "streams"],
        permitted_namespaces: ["streams"],
      }),
    );

    await client.loadCapabilities();

    expect(client.offersNamespace("markets")).toBe(true);
    expect(client.supportsNamespace("markets")).toBe(false);
    expect(client.supportsNamespace("streams")).toBe(true);
    expect(() => client.namespace("markets")).toThrow(
      NamespaceUnavailableError,
    );
  });

  it("passes a pinned data version to the capabilities route", async () => {
    const { client, calls } = makeClient(() =>
      envelope({ network: "mainnet", namespaces: [] }),
    );

    await client.capabilitiesApi.getEnvelope({ dataVersion: "7" });

    expect(calls[0]?.url).toBe(
      "https://api.example.com/mainnet/v1/capabilities?data_version=7",
    );
  });
});

describe("capability helpers", () => {
  const caps = {
    network: "mainnet",
    namespaces: ["markets", "streams"],
    permitted_namespaces: ["streams"],
  };

  it("answers supports, permits and allow independently", () => {
    expect(capabilitiesSupports(caps, "markets")).toBe(true);
    expect(capabilitiesPermits(caps, "markets")).toBe(false);
    expect(capabilitiesAllow(caps, "markets")).toBe(false);
    expect(capabilitiesAllow(caps, "streams")).toBe(true);
  });

  it("treats an absent permitted list as permitting everything offered", () => {
    const open = { network: "mainnet", namespaces: ["markets"] };
    expect(capabilitiesPermits(open, "bridge")).toBe(true);
    expect(capabilitiesAllow(open, "bridge")).toBe(false);
  });
});

describe("V1Client transport wiring", () => {
  it("sends the static token as a bearer credential", async () => {
    const { client, calls } = makeClient(
      () => envelope({ network: "mainnet", namespaces: [] }),
      { token: "the-token" },
    );

    await client.capabilitiesApi.get();

    expect(calls[0]?.headers.get("Authorization")).toBe("Bearer the-token");
  });

  it("reports the client's network", () => {
    const { client } = makeClient(() => envelope({}));
    expect(client.network).toBe("mainnet");
  });
});

describe("namespace readers", () => {
  it("builds market and stream routes", async () => {
    const { client, calls } = makeClient(() => envelope({}));

    await client.markets.market("m1");
    await client.markets.sub("m1", "orderbook");
    await client.streams.stream({ provider: "0xabc", id: "st1" });
    await client.streams.records({ provider: "0xabc", id: "st1" });

    expect(calls.map((c) => c.url)).toEqual([
      "https://api.example.com/mainnet/v1/markets/m1",
      "https://api.example.com/mainnet/v1/markets/m1/orderbook",
      "https://api.example.com/mainnet/v1/streams/0xabc/st1",
      "https://api.example.com/mainnet/v1/streams/0xabc/st1/records",
    ]);
  });

  it("sends height on chain block reads and validates it", async () => {
    const { client, calls } = makeClient(() => envelope({}));

    await client.chain.block({ height: 42 });

    expect(calls[0]?.url).toBe(
      "https://api.example.com/mainnet/v1/chain/block?height=42",
    );
    expect(() => client.chain.block({ height: -1 })).toThrow(/height/);
  });

  it("walks a list with the cursor and a stable limit", async () => {
    const { client, calls } = makeClient(() => envelope([]));
    let page = 0;
    const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
      calls.push({ url: String(input), headers: new Headers() });
      page += 1;
      const body: V1Success<unknown[]> = {
        ok: true,
        data: [{ id: page }],
        meta_data: { cursor: page === 1 ? "next" : null, data_version: "1" },
      };
      return jsonResponse(body);
    };
    const client2 = new V1Client({
      baseUrl: "https://api.example.com",
      network: "mainnet",
      fetch: fetchImpl,
    });

    const items = await client2.markets.collect("", { limit: 10 });

    expect(items).toEqual([{ id: 1 }, { id: 2 }]);
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.example.com/mainnet/v1/markets?limit=10",
      "https://api.example.com/mainnet/v1/markets?limit=10&cursor=next",
    ]);
    expect(() => client.markets.markets({ limit: 0 })).toThrow(/limit/);
  });
});

describe("V1Client credential strategy", () => {
  it("mints once for a gated read instead of recursing through getToken", async () => {
    const calls: { url: string; headers: Headers }[] = [];
    const fetchImpl = async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const url = String(input);
      calls.push({ url, headers: new Headers(init?.headers) });
      if (url.endsWith("/v1/credentials")) {
        return jsonResponse(
          envelope({
            credential: "minted-token",
            expires_at: Math.floor(Date.now() / 1000) + 3600,
          }),
        );
      }
      return jsonResponse(envelope([]));
    };
    const client = new V1Client({
      baseUrl: "https://api.example.com",
      network: "mainnet",
      fetch: fetchImpl,
      credentialStrategy: { kind: "public" },
    });

    const page = await client.markets.list("", { query: { limit: 1 } });

    expect(page.ok).toBe(true);
    const mints = calls.filter((c) => c.url.endsWith("/v1/credentials"));
    expect(mints).toHaveLength(1);
    // The mint is ungated: asking for a token to send it would re-enter the
    // manager and recurse until the stack overflows.
    expect(mints[0]?.headers.get("Authorization")).toBeNull();
    const reads = calls.filter((c) => c.url.includes("/v1/markets"));
    expect(reads[0]?.headers.get("Authorization")).toBe("Bearer minted-token");
  });
});
