import { afterEach, describe, expect, it, vi } from "vitest";
import { V1ApiError } from "./errors";
import { Transport } from "./transport";

/** Tests for the kwil-free HTTP transport, using an injected `fetch`. */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain" },
  });
}

interface Captured {
  url: string;
  init: RequestInit | undefined;
}

function fakeFetch(
  handler: (captured: Captured) => Response | Promise<Response>,
): {
  fetchImpl: typeof fetch;
  calls: Captured[];
} {
  const calls: Captured[] = [];
  const fetchImpl = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const captured: Captured = { url: String(input), init };
    calls.push(captured);
    return handler(captured);
  };
  return { fetchImpl, calls };
}

function headersOf(captured: Captured): Headers {
  return new Headers(captured.init?.headers);
}

const success: unknown = {
  ok: true,
  data: { hello: "world" },
  meta_data: { cursor: null, data_version: "1" },
};

describe("Transport", () => {
  it("builds the URL from the base URL, the network, and the query", () => {
    const { fetchImpl } = fakeFetch(() => jsonResponse(success));
    const transport = new Transport({
      baseUrl: "https://api.example.com/",
      network: "mainnet",
      fetch: fetchImpl,
    });

    expect(transport.url("tx/params", { sender: "0xabc", limit: 5 })).toBe(
      "https://api.example.com/mainnet/v1/tx/params?sender=0xabc&limit=5",
    );
    expect(transport.url("")).toBe("https://api.example.com/mainnet/v1");
    expect(transport.url("/tx/prepare")).toBe(
      "https://api.example.com/mainnet/v1/tx/prepare",
    );
  });

  it("expands array query values into repeated parameters and drops null", () => {
    const { fetchImpl } = fakeFetch(() => jsonResponse(success));
    const transport = new Transport({
      baseUrl: "https://api.example.com",
      network: "mainnet",
      fetch: fetchImpl,
    });

    expect(
      transport.url("streams", {
        include: ["a", "b"],
        skip: null,
        keep: undefined,
      }),
    ).toBe("https://api.example.com/mainnet/v1/streams?include=a&include=b");
  });

  it("validates the base URL and the network", () => {
    const { fetchImpl } = fakeFetch(() => jsonResponse(success));
    expect(
      () =>
        new Transport({ baseUrl: "", network: "mainnet", fetch: fetchImpl }),
    ).toThrow(/baseUrl/);
    expect(
      () =>
        new Transport({
          baseUrl: "not a url",
          network: "mainnet",
          fetch: fetchImpl,
        }),
    ).toThrow(/absolute URL/);
    expect(
      () =>
        new Transport({
          baseUrl: "ftp://example.com",
          network: "mainnet",
          fetch: fetchImpl,
        }),
    ).toThrow(/http/);
    expect(
      () =>
        new Transport({
          baseUrl: "https://example.com",
          network: "bad network",
          fetch: fetchImpl,
        }),
    ).toThrow(/network/);
  });

  it("sends the bearer credential and the standard headers", async () => {
    const { fetchImpl, calls } = fakeFetch(() => jsonResponse(success));
    const transport = new Transport({
      baseUrl: "https://api.example.com",
      network: "mainnet",
      fetch: fetchImpl,
      getToken: () => "the-token",
      headers: { "X-Trace": "abc" },
    });

    await transport.get("capabilities");

    expect(calls).toHaveLength(1);
    const headers = headersOf(calls[0]!);
    expect(headers.get("Authorization")).toBe("Bearer the-token");
    expect(headers.get("Accept")).toBe("application/json");
    expect(headers.get("X-Trace")).toBe("abc");
    expect(headers.get("Content-Type")).toBeNull();
    expect(calls[0]!.init?.method).toBe("GET");
    expect(calls[0]!.init?.body).toBeUndefined();
  });

  it("omits the credential when includeAuth is false or the token is empty", async () => {
    const { fetchImpl, calls } = fakeFetch(() => jsonResponse(success));
    const transport = new Transport({
      baseUrl: "https://api.example.com",
      network: "mainnet",
      fetch: fetchImpl,
      getToken: () => "",
    });

    await transport.get("capabilities");
    await transport.get("capabilities", { includeAuth: false });

    expect(headersOf(calls[0]!).get("Authorization")).toBeNull();
    expect(headersOf(calls[1]!).get("Authorization")).toBeNull();
  });

  it("sends a JSON body with Content-Type and serialises bigint as a string", async () => {
    const { fetchImpl, calls } = fakeFetch(() => jsonResponse(success));
    const transport = new Transport({
      baseUrl: "https://api.example.com",
      network: "mainnet",
      fetch: fetchImpl,
    });

    await transport.post("tx/prepare", { body: { nonce: 1n, amount: "10" } });

    const headers = headersOf(calls[0]!);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(calls[0]!.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
      nonce: "1",
      amount: "10",
    });
  });

  it("parses a success envelope", async () => {
    const { fetchImpl } = fakeFetch(() => jsonResponse(success));
    const transport = new Transport({
      baseUrl: "https://api.example.com",
      network: "mainnet",
      fetch: fetchImpl,
    });

    const envelope = await transport.get<{ hello: string }>("capabilities");
    expect(envelope.data.hello).toBe("world");
  });

  describe("calls fetch the way a browser requires", () => {
    // A browser's `fetch` throws "Illegal invocation" unless it is called with
    // no receiver or with the window. Node's `fetch` does not check, so this
    // stand-in does.
    function receiverCheckingFetch(): {
      fetchImpl: typeof fetch;
      receivers: unknown[];
    } {
      const receivers: unknown[] = [];
      const fetchImpl = function (this: unknown): Promise<Response> {
        receivers.push(this);
        if (this !== undefined && this !== globalThis) {
          return Promise.reject(
            new TypeError(
              "Failed to execute 'fetch' on 'Window': Illegal invocation",
            ),
          );
        }
        return Promise.resolve(jsonResponse(success));
      } as unknown as typeof fetch;
      return { fetchImpl, receivers };
    }

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("with the global fetch when none is passed", async () => {
      const { fetchImpl, receivers } = receiverCheckingFetch();
      vi.stubGlobal("fetch", fetchImpl);
      const transport = new Transport({
        baseUrl: "https://api.example.com",
        network: "mainnet",
      });

      const envelope = await transport.get<{ hello: string }>("capabilities");
      expect(envelope.data.hello).toBe("world");
      expect(receivers).toEqual([undefined]);
    });

    it("with a fetch passed in options", async () => {
      const { fetchImpl, receivers } = receiverCheckingFetch();
      const transport = new Transport({
        baseUrl: "https://api.example.com",
        network: "mainnet",
        fetch: fetchImpl,
      });

      const envelope = await transport.get<{ hello: string }>("capabilities");
      expect(envelope.data.hello).toBe("world");
      expect(receivers).toEqual([undefined]);
    });
  });

  it("throws a typed error for a v1 JSON error response", async () => {
    const errorBody = {
      ok: false,
      error: {
        code: "resource_exhausted",
        message: "too many requests",
        details: { lever: "rate" },
      },
    };
    const { fetchImpl } = fakeFetch(() => jsonResponse(errorBody, 429));
    const transport = new Transport({
      baseUrl: "https://api.example.com",
      network: "mainnet",
      fetch: fetchImpl,
    });

    const error = await transport.get("capabilities").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(V1ApiError);
    const apiError = error as V1ApiError;
    expect(apiError.status).toBe(429);
    expect(apiError.is("resource_exhausted")).toBe(true);
    expect(apiError.isLever("rate")).toBe(true);
  });

  it("treats a non-matching v1 error envelope returned with 200 as an error", async () => {
    const errorBody = {
      ok: false,
      error: { code: "not_found", message: "missing" },
    };
    const { fetchImpl } = fakeFetch(() => jsonResponse(errorBody, 200));
    const transport = new Transport({
      baseUrl: "https://api.example.com",
      network: "mainnet",
      fetch: fetchImpl,
    });

    const error = (await transport
      .get("capabilities")
      .catch((e: unknown) => e)) as V1ApiError;
    expect(error.code).toBe("not_found");
  });

  it("surfaces a plain-text 404 as a transport error with the raw body", async () => {
    const { fetchImpl } = fakeFetch(() =>
      textResponse("404 page not found", 404),
    );
    const transport = new Transport({
      baseUrl: "https://api.example.com",
      network: "mainnet",
      fetch: fetchImpl,
    });

    const error = (await transport
      .get("nope")
      .catch((e: unknown) => e)) as V1ApiError;
    expect(error).toBeInstanceOf(V1ApiError);
    expect(error.code).toBe(V1ApiError.TRANSPORT_CODE);
    expect(error.status).toBe(404);
    expect(error.body).toBe("404 page not found");
  });

  it("rejects a non-JSON success body", async () => {
    const { fetchImpl } = fakeFetch(() => textResponse("<html>hello</html>"));
    const transport = new Transport({
      baseUrl: "https://api.example.com",
      network: "mainnet",
      fetch: fetchImpl,
    });

    const error = (await transport
      .get("capabilities")
      .catch((e: unknown) => e)) as V1ApiError;
    expect(error.code).toBe(V1ApiError.TRANSPORT_CODE);
    expect(error.message).toMatch(/not valid JSON/);
  });

  it("rejects a JSON body that is not a v1 success envelope", async () => {
    const { fetchImpl } = fakeFetch(() => jsonResponse({ hello: "world" }));
    const transport = new Transport({
      baseUrl: "https://api.example.com",
      network: "mainnet",
      fetch: fetchImpl,
    });

    const error = (await transport
      .get("capabilities")
      .catch((e: unknown) => e)) as V1ApiError;
    expect(error.code).toBe(V1ApiError.TRANSPORT_CODE);
    expect(error.message).toMatch(/success envelope/);
  });

  it("wraps a network failure as a transport error", async () => {
    const { fetchImpl } = fakeFetch(() => {
      throw new Error("connection refused");
    });
    const transport = new Transport({
      baseUrl: "https://api.example.com",
      network: "mainnet",
      fetch: fetchImpl,
    });

    const error = (await transport
      .get("capabilities")
      .catch((e: unknown) => e)) as V1ApiError;
    expect(error.code).toBe(V1ApiError.TRANSPORT_CODE);
    expect(error.status).toBe(0);
    expect(error.message).toMatch(/network request failed/);
  });

  it("times out a request that never settles", async () => {
    const fetchImpl = async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      });
    const transport = new Transport({
      baseUrl: "https://api.example.com",
      network: "mainnet",
      fetch: fetchImpl,
      timeoutMs: 5,
    });

    const error = (await transport
      .get("capabilities")
      .catch((e: unknown) => e)) as V1ApiError;
    expect(error.code).toBe(V1ApiError.TRANSPORT_CODE);
    expect(error.message).toMatch(/timed out/);
  });

  it("times out a body that never finishes after its headers", async () => {
    // The response headers resolve immediately, but the body stalls. The timer
    // must still cover the body read, not just the header round trip.
    const fetchImpl = async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> =>
      ({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: () =>
          new Promise<string>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new Error("aborted")),
            );
          }),
      }) as unknown as Response;
    const transport = new Transport({
      baseUrl: "https://api.example.com",
      network: "mainnet",
      fetch: fetchImpl,
      timeoutMs: 5,
    });

    const error = (await transport
      .get("capabilities")
      .catch((e: unknown) => e)) as V1ApiError;
    expect(error.code).toBe(V1ApiError.TRANSPORT_CODE);
    expect(error.message).toMatch(/timed out/);
  });

  it("keeps the status of an error response whose body fails to arrive", async () => {
    const fetchImpl = async (): Promise<Response> =>
      ({
        ok: false,
        status: 401,
        headers: new Headers(),
        text: () => Promise.reject(new TypeError("connection reset")),
      }) as unknown as Response;
    const transport = new Transport({
      baseUrl: "https://api.example.com",
      network: "mainnet",
      fetch: fetchImpl,
    });

    const error = (await transport
      .get("capabilities")
      .catch((e: unknown) => e)) as V1ApiError;
    expect(error.code).toBe(V1ApiError.TRANSPORT_CODE);
    expect(error.status).toBe(401);
    expect(error.message).toMatch(/HTTP 401 response could not be read/);
  });

  it("stops waiting for a stalled credential when the caller aborts", async () => {
    const { fetchImpl, calls } = fakeFetch(() => jsonResponse(success));
    const transport = new Transport({
      baseUrl: "https://api.example.com",
      network: "mainnet",
      fetch: fetchImpl,
      getToken: () => new Promise<string>(() => undefined),
    });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5);

    const error = (await transport
      .get("capabilities", { signal: controller.signal })
      .catch((e: unknown) => e)) as V1ApiError;

    expect(error).toBeInstanceOf(V1ApiError);
    expect(error.message).toMatch(/request aborted/);
    expect(calls).toHaveLength(0);
  });

  it("labels a caller abort as aborted, not as a timeout", async () => {
    const fetchImpl = async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> =>
      new Promise<Response>((_resolve, reject) => {
        if (init?.signal?.aborted === true) {
          reject(new Error("aborted"));
          return;
        }
        init?.signal?.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      });
    const transport = new Transport({
      baseUrl: "https://api.example.com",
      network: "mainnet",
      fetch: fetchImpl,
      timeoutMs: 60_000,
    });
    const controller = new AbortController();

    const pending = transport
      .get("capabilities", { signal: controller.signal })
      .catch((e: unknown) => e);
    controller.abort();

    const error = (await pending) as V1ApiError;
    expect(error.code).toBe(V1ApiError.TRANSPORT_CODE);
    expect(error.message).toMatch(/request aborted/);
    expect(error.message).not.toMatch(/timed out/);
  });
});
