/**
 * Capability discovery (`GET /{network}/v1/capabilities`).
 *
 * Capabilities is the degradation switch: the contract says a client reads the
 * offered namespace set and degrades from it rather than hard-coding which
 * namespaces exist. The `permitted_*` lists appear only when a credential was
 * presented; they tell "not offered" apart from "not permitted".
 */

import type { Transport } from "./transport";
import type { CapabilitiesData, V1Success } from "./types";

/** Options for {@link CapabilitiesApi.get}. */
export interface CapabilitiesOptions {
  /** Pin the document; any value other than the current one is a `412`. */
  dataVersion?: string;
  signal?: AbortSignal;
}

/** Typed access to the capabilities document. */
export class CapabilitiesApi {
  constructor(private readonly transport: Transport) {}

  /** Fetch the document's `data` (the namespace matrix). */
  async get(options?: CapabilitiesOptions): Promise<CapabilitiesData> {
    const envelope = await this.getEnvelope(options);
    return envelope.data;
  }

  /** Fetch the full success envelope, including `meta_data.data_version`. */
  getEnvelope(
    options?: CapabilitiesOptions,
  ): Promise<V1Success<CapabilitiesData>> {
    const query =
      options?.dataVersion === undefined
        ? undefined
        : { data_version: options.dataVersion };
    return this.transport.get<CapabilitiesData>("capabilities", {
      query,
      signal: options?.signal,
    });
  }
}

/** True when the network offers `namespace`. */
export function capabilitiesSupports(
  caps: CapabilitiesData,
  namespace: string,
): boolean {
  return caps.namespaces.includes(namespace);
}

/**
 * True when the credential permits `namespace`. When the `permitted_namespaces`
 * list is absent (no credential was presented) every offered namespace is
 * treated as permitted.
 */
export function capabilitiesPermits(
  caps: CapabilitiesData,
  namespace: string,
): boolean {
  if (caps.permitted_namespaces === undefined) return true;
  return caps.permitted_namespaces.includes(namespace);
}

/** True when `namespace` is both offered and permitted. */
export function capabilitiesAllow(
  caps: CapabilitiesData,
  namespace: string,
): boolean {
  return (
    capabilitiesSupports(caps, namespace) &&
    capabilitiesPermits(caps, namespace)
  );
}
