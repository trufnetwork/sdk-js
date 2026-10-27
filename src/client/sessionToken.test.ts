import http from "http";
import type { AddressInfo } from "net";
import { Wallet } from "ethers";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { BrowserTNClient } from "./browserClient";
import { NodeTNClient } from "./nodeClient";

const CHAIN_ID = "test-chain";

interface Gateway {
  url: string;
  signIns: number;
  // each request: its JSON-RPC method and the Authorization header it carried
  requests: { method: string; authorization?: string }[];
  // tokens the gateway accepts, each for one account
  tokens: Map<string, string>;
  close: () => Promise<void>;
}

// startGateway runs a stand-in gateway over real HTTP. It follows the gateway's
// token rules: sign-in returns a token for the signer's account, and a call
// passes only with a token for its sender. It ignores cookies, as a wallet's
// in-app browser that drops them would leave it.
async function startGateway(): Promise<Gateway> {
  let next = 0;
  const gateway: Gateway = {
    url: "",
    signIns: 0,
    requests: [],
    tokens: new Map<string, string>(),
    close: async () => {},
  };

  const server = http.createServer((req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        res.writeHead(400);
        res.end();
        return;
      }
      const params = body.params || {};
      const authorization = req.headers.authorization;
      gateway.requests.push({ method: body.method, authorization });

      const reply = (payload: object, status = 200) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, ...payload }));
      };

      switch (body.method) {
        case "user.health":
          return reply({ result: { mode: "open" } });
        case "kgw.authn_param":
          return reply({
            result: {
              nonce: "abc123",
              statement: "I agree",
              issue_at: "2026-10-26T00:00:00Z",
              expiration_time: "2026-10-26T00:00:30Z",
              chain_id: CHAIN_ID,
              domain: gateway.url,
              version: "1",
              uri: `${gateway.url}/rpc/v1`,
            },
          });
        case "kgw.authn": {
          gateway.signIns += 1;
          next += 1;
          const token = `token-${next}`;
          gateway.tokens.set(token, String(params.sender).toLowerCase());
          return reply({ result: { result: "ok", token } });
        }
        case "user.query":
          return reply({
            result: {
              column_names: [
                "name",
                "namespace",
                "access_modifiers",
                "parameter_names",
              ],
              column_types: [],
              values: [["get_user_positions", "main", ["PUBLIC", "VIEW"], []]],
            },
          });
        case "user.call": {
          const token = authorization?.startsWith("Bearer ")
            ? authorization.slice("Bearer ".length)
            : undefined;
          if (
            token &&
            gateway.tokens.get(token) === String(params.sender).toLowerCase()
          ) {
            return reply({
              result: {
                query_result: {
                  column_names: [
                    "query_id",
                    "outcome",
                    "price",
                    "amount",
                    "last_updated",
                  ],
                  column_types: [],
                  values: [],
                },
                logs: "",
              },
            });
          }
          return reply(
            {
              error: {
                code: -901,
                message: token ? "invalid token" : "cookie not found",
              },
            },
            401,
          );
        }
        default:
          return reply(
            { error: { code: -32601, message: `no method ${body.method}` } },
            404,
          );
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  gateway.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  gateway.close = () =>
    new Promise<void>((resolve) => server.close(() => resolve()));
  return gateway;
}

const wallet = Wallet.createRandom();
const account = wallet.address.slice(2).toLowerCase();
const options = (url: string) => ({
  endpoint: url,
  signerInfo: { address: wallet.address, signer: wallet },
  chainId: CHAIN_ID,
});
const userCalls = (g: Gateway) =>
  g.requests
    .filter((r) => r.method === "user.call")
    .map((r) => r.authorization);

describe("gateway session tokens", () => {
  describe("in a wallet's in-app browser", () => {
    let gateway: Gateway;

    beforeAll(() => {
      // kwil-js takes the browser path when a window exists
      vi.stubGlobal("window", {});
    });
    afterAll(() => {
      vi.unstubAllGlobals();
    });
    afterEach(async () => {
      await gateway?.close();
    });

    it("reads the signer's positions by holding the session in a header", async () => {
      gateway = await startGateway();
      const onSessionToken = vi.fn();
      const client = new BrowserTNClient({
        ...options(gateway.url),
        onSessionToken,
      });

      const positions = await client.loadOrderbookAction().getUserPositions();

      expect(positions).toEqual([]);
      expect(gateway.signIns).toBe(1);
      expect(userCalls(gateway)).toStrictEqual([undefined, "Bearer token-1"]);
      expect(onSessionToken.mock.calls).toStrictEqual([[account, "token-1"]]);
      expect(client.getSessionToken()).toBe("token-1");

      // later reads reuse the session without asking the wallet again
      await client.loadOrderbookAction().getUserPositions();
      expect(gateway.signIns).toBe(1);
      expect(userCalls(gateway)).toStrictEqual([
        undefined,
        "Bearer token-1",
        "Bearer token-1",
      ]);
    });

    it("signs in again when the gateway refuses a saved token", async () => {
      gateway = await startGateway();
      // a token the gateway issued to another account
      gateway.tokens.set("other", "00".repeat(20));
      const onSessionToken = vi.fn();
      const client = new BrowserTNClient({
        ...options(gateway.url),
        sessionTokens: { [wallet.address]: "other" },
        onSessionToken,
      });

      await client.loadOrderbookAction().getUserPositions();
      expect(gateway.signIns).toBe(1);
      expect(userCalls(gateway)).toStrictEqual([
        "Bearer other",
        "Bearer token-1",
      ]);
      expect(onSessionToken.mock.calls).toStrictEqual([
        [account, undefined],
        [account, "token-1"],
      ]);
      expect(client.getSessionToken()).toBe("token-1");
    });

    it("starts from a saved token without asking the wallet", async () => {
      gateway = await startGateway();
      gateway.tokens.set("saved", account);
      const client = new BrowserTNClient({
        ...options(gateway.url),
        sessionTokens: { [wallet.address]: "saved" },
      });

      await client.loadOrderbookAction().getUserPositions();
      expect(gateway.signIns).toBe(0);
      expect(userCalls(gateway)).toStrictEqual(["Bearer saved"]);
    });

    it("shares one sign-in between reads that fail together", async () => {
      gateway = await startGateway();
      // a token the gateway issued to another account
      gateway.tokens.set("other", "00".repeat(20));
      const client = new BrowserTNClient({
        ...options(gateway.url),
        sessionTokens: { [wallet.address]: "other" },
      });

      const positions = await Promise.all([
        client.loadOrderbookAction().getUserPositions(),
        client.loadOrderbookAction().getUserPositions(),
      ]);

      expect(positions).toEqual([[], []]);
      expect(gateway.signIns).toBe(1);
      expect(client.getSessionToken()).toBe("token-1");
      const calls = userCalls(gateway);
      expect(calls.filter((a) => a === "Bearer other")).toHaveLength(2);
      expect(calls.filter((a) => a === "Bearer token-1")).toHaveLength(2);
    });

    it("can be handed a token after it is built", async () => {
      gateway = await startGateway();
      gateway.tokens.set("restored", account);
      const onSessionToken = vi.fn();
      const client = new BrowserTNClient({
        ...options(gateway.url),
        onSessionToken,
      });
      client.setSessionToken("restored");

      await client.loadOrderbookAction().getUserPositions();
      expect(gateway.signIns).toBe(0);
      expect(userCalls(gateway)).toStrictEqual(["Bearer restored"]);
      expect(onSessionToken).not.toHaveBeenCalled();
    });
  });

  it("both clients pass saved tokens through to the kwil client", () => {
    for (const client of [
      new NodeTNClient({
        ...options("http://127.0.0.1:1"),
        sessionTokens: { [wallet.address]: "saved" },
      }),
      new BrowserTNClient({
        ...options("http://127.0.0.1:1"),
        sessionTokens: { [wallet.address]: "saved" },
      }),
    ]) {
      expect(client.getSessionToken()).toBe("saved");
    }
  });

  it("getSessionToken and setSessionToken act on the client's own signer", () => {
    for (const client of [
      new NodeTNClient(options("http://127.0.0.1:1")),
      new BrowserTNClient(options("http://127.0.0.1:1")),
    ]) {
      expect(client.getSessionToken()).toBeUndefined();
      client.setSessionToken("x");
      expect(client.getSessionToken()).toBe("x");
      expect(client.getKwilClient().getSessionToken(wallet.address)).toBe("x");
      client.setSessionToken(undefined);
      expect(client.getSessionToken()).toBeUndefined();
    }
  });
});
