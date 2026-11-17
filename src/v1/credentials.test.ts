import { describe, expect, it } from "vitest";
import { CredentialManager, CredentialsApi } from "./credentials";
import type { RedeemInput } from "./types";
import { Transport } from "./transport";

/** Tests for the credential routes and the single-flight refresh helper. */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface Captured {
  url: string;
  body: unknown;
}

function makeTransport(
  handler: (captured: Captured) => Response | Promise<Response>,
): {
  transport: Transport;
  calls: Captured[];
} {
  const calls: Captured[] = [];
  const fetchImpl = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const captured: Captured = {
      url: String(input),
      body:
        init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    };
    calls.push(captured);
    return handler(captured);
  };
  const transport = new Transport({
    baseUrl: "https://api.example.com",
    network: "mainnet",
    fetch: fetchImpl,
  });
  return { transport, calls };
}

const envelope = (data: unknown): unknown => ({
  ok: true,
  data,
  meta_data: { cursor: null, data_version: "1" },
});

describe("CredentialsApi", () => {
  it("mints the public preset with a body", async () => {
    const { transport, calls } = makeTransport(() =>
      jsonResponse(envelope({ credential: "jwt", expires_at: 1000 })),
    );
    const api = new CredentialsApi(transport);

    const minted = await api.mint("public");

    expect(minted).toEqual({ credential: "jwt", expires_at: 1000 });
    expect(calls[0]?.url).toBe(
      "https://api.example.com/mainnet/v1/credentials",
    );
    expect(calls[0]?.body).toEqual({ preset: "public" });
  });

  it("sends an empty body for a body-less mint", async () => {
    const { transport, calls } = makeTransport(() =>
      jsonResponse(envelope({ credential: "jwt", expires_at: 1000 })),
    );

    await new CredentialsApi(transport).mint();

    expect(calls[0]?.body).toEqual({});
  });

  it("rejects an empty preset before any request", async () => {
    const { transport, calls } = makeTransport(() =>
      jsonResponse(envelope({ credential: "jwt", expires_at: 1000 })),
    );
    const api = new CredentialsApi(transport);

    await expect(api.mint("")).rejects.toThrow(/preset/);
    expect(calls).toHaveLength(0);
  });

  it("fetches the JWKS", async () => {
    const keys = [{ kty: "OKP", crv: "Ed25519", kid: "k1", x: "abc" }];
    const { transport, calls } = makeTransport(() =>
      jsonResponse(envelope({ keys })),
    );

    const jwks = await new CredentialsApi(transport).jwks();

    expect(jwks.keys).toEqual(keys);
    expect(calls[0]?.url).toBe(
      "https://api.example.com/mainnet/v1/credentials/jwks",
    );
  });

  it("quotes a preset with the preset and days in the query", async () => {
    const quote = { preset: "pro", days: 30, usd_per_day: "1.00" };
    const { transport, calls } = makeTransport(() =>
      jsonResponse(envelope(quote)),
    );

    const result = await new CredentialsApi(transport).quote("pro", 30);

    expect(result).toEqual(quote);
    expect(calls[0]?.url).toBe(
      "https://api.example.com/mainnet/v1/credentials/quote?preset=pro&days=30",
    );
  });

  it("rejects an invalid quote request before any request", async () => {
    const { transport, calls } = makeTransport(() =>
      jsonResponse(envelope({})),
    );
    const api = new CredentialsApi(transport);

    await expect(api.quote("", 30)).rejects.toThrow(/preset/);
    await expect(api.quote("pro", 0)).rejects.toThrow(/days/);
    expect(calls).toHaveLength(0);
  });

  it("redeems a payment", async () => {
    const input: RedeemInput = {
      tx_hash: "a".repeat(64),
      preset: "pro",
      signature: `0x${"b".repeat(130)}`,
    };
    const { transport, calls } = makeTransport(() =>
      jsonResponse(envelope({ credential: "jwt", expires_at: 2000 })),
    );

    const redeemed = await new CredentialsApi(transport).redeem(input);

    expect(redeemed).toEqual({ credential: "jwt", expires_at: 2000 });
    expect(calls[0]?.url).toBe(
      "https://api.example.com/mainnet/v1/credentials/redemptions",
    );
    expect(calls[0]?.body).toEqual(input);
  });

  it("validates the redemption input", async () => {
    const { transport } = makeTransport(() => jsonResponse(envelope({})));
    const api = new CredentialsApi(transport);

    await expect(
      api.redeem({
        tx_hash: "short",
        preset: "pro",
        signature: "0x" + "b".repeat(130),
      }),
    ).rejects.toThrow(/tx_hash/);
    await expect(
      api.redeem({
        tx_hash: "a".repeat(64),
        preset: "pro",
        signature: "0x1234",
      }),
    ).rejects.toThrow(/signature/);
  });
});

describe("CredentialManager", () => {
  it("shares one acquisition among concurrent callers", async () => {
    let mints = 0;
    const { transport } = makeTransport(async () => {
      mints += 1;
      // Yield so both callers see the in-flight acquisition.
      await Promise.resolve();
      return jsonResponse(
        envelope({ credential: `jwt-${mints}`, expires_at: 2000 }),
      );
    });
    const manager = new CredentialManager(
      new CredentialsApi(transport),
      { kind: "public", preset: "public" },
      { now: () => 0 },
    );

    const [a, b] = await Promise.all([manager.getToken(), manager.getToken()]);

    expect(a).toBe("jwt-1");
    expect(b).toBe("jwt-1");
    expect(mints).toBe(1);
  });

  it("re-mints when the credential is within the skew of expiry", async () => {
    let nowMs = 0;
    let mints = 0;
    const { transport } = makeTransport(() => {
      mints += 1;
      return jsonResponse(
        envelope({ credential: `jwt-${mints}`, expires_at: 1000 }),
      );
    });
    const manager = new CredentialManager(
      new CredentialsApi(transport),
      { kind: "public" },
      { now: () => nowMs, skewSeconds: 30 },
    );

    expect(await manager.getToken()).toBe("jwt-1");
    expect(await manager.getToken()).toBe("jwt-1");
    expect(mints).toBe(1);

    // 980s: 20s from expiry, inside the 30s skew, so a re-mint happens.
    nowMs = 980_000;
    expect(await manager.getToken()).toBe("jwt-2");
    expect(mints).toBe(2);
  });

  it("resets the in-flight request after a failed acquisition", async () => {
    let fail = true;
    let mints = 0;
    const { transport } = makeTransport(() => {
      mints += 1;
      if (fail) {
        return jsonResponse(
          { ok: false, error: { code: "unavailable", message: "try later" } },
          503,
        );
      }
      return jsonResponse(envelope({ credential: "jwt-ok", expires_at: 2000 }));
    });
    const manager = new CredentialManager(
      new CredentialsApi(transport),
      { kind: "public" },
      { now: () => 0 },
    );

    await expect(manager.getToken()).rejects.toThrow(/try later/);

    fail = false;
    await expect(manager.getToken()).resolves.toBe("jwt-ok");
    expect(mints).toBe(2);
  });

  it("redeems on demand for a paid strategy", async () => {
    const payment: RedeemInput = {
      tx_hash: "a".repeat(64),
      preset: "pro",
      signature: "b".repeat(130),
    };
    const { transport, calls } = makeTransport(() =>
      jsonResponse(envelope({ credential: "paid-jwt", expires_at: 2000 })),
    );
    const manager = new CredentialManager(
      new CredentialsApi(transport),
      { kind: "redeem", payment: async () => payment },
      { now: () => 0 },
    );

    expect(await manager.getToken()).toBe("paid-jwt");
    expect(calls[0]?.url).toBe(
      "https://api.example.com/mainnet/v1/credentials/redemptions",
    );
    expect(calls[0]?.body).toEqual(payment);
  });

  it("exposes and clears the current credential", async () => {
    const { transport } = makeTransport(() =>
      jsonResponse(envelope({ credential: "jwt", expires_at: 2000 })),
    );
    const manager = new CredentialManager(
      new CredentialsApi(transport),
      { kind: "public" },
      { now: () => 0 },
    );

    expect(manager.peek()).toBeNull();
    await manager.getToken();
    expect(manager.peek()).toEqual({ credential: "jwt", expiresAt: 2000 });
    manager.clear();
    expect(manager.peek()).toBeNull();
  });

  it("rejects a malformed mint response", async () => {
    const { transport } = makeTransport(() =>
      jsonResponse(envelope({ credential: "", expires_at: 2000 })),
    );
    const manager = new CredentialManager(new CredentialsApi(transport), {
      kind: "public",
    });

    await expect(manager.getToken()).rejects.toThrow(/missing a credential/);
  });
});
