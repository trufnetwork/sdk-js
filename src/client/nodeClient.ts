import { AdminClient, EnvironmentType, NodeKwil, Types } from "@trufnetwork/kwil-js";
import { BaseTNClient, TNClientOptions } from "../internal";
import { LocalActions, LocalActionsOptions } from "../contracts-api/localActions";

export class NodeTNClient extends BaseTNClient<EnvironmentType.NODE> {
  constructor(options: TNClientOptions) {
    super(options);
    const { endpoint, signerInfo, ...kwilOptions } = options;
    this.kwilClient = new NodeKwil({
      ...kwilOptions,
      timeout: options.timeout ?? 30000,
      kwilProvider: endpoint,
    });
  }

  /**
   * Loads the local stream actions API, which talks to the kwil-db admin
   * JSON-RPC server (default port 8485) instead of the gateway (8484).
   *
   * Local streams live off-chain on a single node and are owned by the
   * node operator (the data_provider is derived server-side from the
   * node's secp256k1 key — clients never supply it).
   *
   * When the node has [extensions.tn_local] require_signature = true,
   * pass the operator key via `options.signer`. The SDK attaches a
   * server-recoverable `_auth` envelope to every call; the server
   * rejects requests signed by any other key. Leave it unset to talk to
   * nodes with the flag off.
   *
   * Admin operations are Node.js only; this method does not exist on
   * BrowserTNClient.
   *
   * @param adminConfig - URL + optional auth/TLS for the admin server.
   *                      Pass an existing AdminClient instance to reuse one.
   * @param options - Optional LocalActionsOptions (e.g. `signer` for
   *                  operator-key auth).
   * @returns A LocalActions instance bound to the given admin transport.
   *
   * @example Unsigned (flag-off node)
   * ```typescript
   * const local = client.loadLocalActions({
   *   adminProvider: "http://127.0.0.1:8485",
   * });
   * await local.createStream({ streamId, streamType: StreamType.Primitive });
   * ```
   *
   * @example Signed (flag-on node)
   * ```typescript
   * const local = client.loadLocalActions(
   *   { adminProvider: "http://127.0.0.1:8485" },
   *   { signer: process.env.OPERATOR_KEY },
   * );
   * ```
   */
  loadLocalActions(
    adminConfig: Types.AdminClientConfig | AdminClient,
    options?: LocalActionsOptions,
  ): LocalActions {
    // Duck-type instead of `instanceof AdminClient`: if the dependency
    // tree contains more than one copy of @trufnetwork/kwil-js (npm
    // hoisting, peer-dep mismatch, ESM/CJS interop), instanceof returns
    // false for an AdminClient that came from a different module copy,
    // and we'd then call `new AdminClient(existingInstance)` which
    // misbehaves. Anything exposing `callMethod()` is the AdminClient
    // surface we actually consume.
    const isAdminClient =
      adminConfig != null &&
      typeof (adminConfig as { callMethod?: unknown }).callMethod === "function";
    const admin = isAdminClient
      ? (adminConfig as AdminClient)
      : new AdminClient(adminConfig as Types.AdminClientConfig);
    return new LocalActions(admin, options);
  }
}

export default NodeTNClient;
