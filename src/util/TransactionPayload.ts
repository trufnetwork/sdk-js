/**
 * Decoding for `execute` transaction payloads.
 *
 * A stream deploy or record insert is an `execute` (action call) transaction. Its meaningful
 * content — the action name and its arguments (the deployed stream IDs, the inserted records) —
 * arrives from `kwil.txInfo(hash)` as `tx.body.payload`, a length-prefixed binary blob. This module
 * turns that blob back into a readable `{ namespace, action, arguments }`.
 *
 * The actual wire decoding is delegated to kwil-js's canonical `Utils.decodeActionExecution` /
 * `Utils.decodeValue` (the inverse of the encoders it ships), so there is a single source of truth
 * for the ActionExecution layout. This module is a thin adapter that maps kwil-js's structural output
 * (`{ dbid, action, arguments: EncodedValue[][] }`) into native JavaScript values.
 */

import { Utils } from '@trufnetwork/kwil-js';

/**
 * A decoded `execute` transaction payload.
 */
export interface DecodedTransactionPayload {
  /** The action's namespace (kwil-db's `Namespace`, usually `"main"`). */
  namespace: string;
  /** The action name, e.g. `"create_streams"` or `"insert_records"`. */
  action: string;
  /**
   * The batched calls, each an array of arguments decoded to native JavaScript values (text→string,
   * integer→bigint, bool, bytea→Uint8Array, uuid→string, numeric→string, null). A single-call
   * transaction has one inner array.
   */
  arguments: unknown[][];
}

/**
 * Decodes an `execute` transaction payload into its action name and batched arguments, each argument
 * decoded to a native JavaScript value.
 *
 * @param payload - The raw payload bytes (e.g. `txInfo(hash).data.tx.body.payload`).
 * @returns The decoded namespace, action, and native arguments.
 * @throws If the payload is truncated or uses an unsupported version (surfaced from kwil-js).
 */
export function decodeTransactionPayload(payload: Uint8Array): DecodedTransactionPayload {
  const decoded = Utils.decodeActionExecution(payload);

  return {
    namespace: decoded.dbid,
    action: decoded.action,
    arguments: decoded.arguments.map((call) => call.map((ev) => Utils.decodeValue(ev))),
  };
}
