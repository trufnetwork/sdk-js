/**
 * The `include` parameter — the issue's “join sets”.
 *
 * The contract defines exactly one join parameter: `include`. Its value is a set
 * of tokens (`metadata`, `prices`, `depth`, `chain`), order-insensitive, with
 * duplicates ignored, and the outcome is reported per token in
 * `meta_data.includes` / `meta_data.parts`. An unavailable include is data, not
 * a failed request, so this module keeps the three outcomes distinct.
 */

import type { IncludeState, V1MetaData, V1StreamPart } from "./types";

function addTokens(out: Set<string>, value: string): void {
  for (const piece of value.split(",")) {
    const token = piece.trim();
    if (token !== "") out.add(token);
  }
}

/**
 * Normalise an `include` input (a comma-separated string, a repeated-value
 * array, or both) into a deduplicated, sorted set. Order-insensitive, empty
 * values dropped, so two spellings of the same set produce the same array.
 */
export function normalizeIncludes(
  input?: string | readonly string[] | null,
): string[] {
  const out = new Set<string>();
  if (typeof input === "string") {
    addTokens(out, input);
  } else if (Array.isArray(input)) {
    for (const value of input) addTokens(out, value);
  }
  return Array.from(out).sort();
}

/** The `include` query value for a token set, or `undefined` when the set is empty. */
export function includeQueryValue(
  input?: string | readonly string[] | null,
): string | undefined {
  const tokens = normalizeIncludes(input);
  return tokens.length === 0 ? undefined : tokens.join(",");
}

/**
 * Classify each requested token against the response's `meta_data`:
 * - `satisfied`: the part was joined (`includes[token] === "satisfied"`, or a
 *   `parts[token]` with a `source`).
 * - `unavailable`: the include named a namespace the network does not offer
 *   (`includes[token] === "unavailable"`, or `parts[token].status` is
 *   `"unavailable"`).
 * - `uncollected`: the part is not collected yet (no flag and no part).
 */
export function classifyIncludes(
  requested: readonly string[],
  meta: V1MetaData,
): IncludeState[] {
  const tokens = normalizeIncludes(requested);
  return tokens.map((token) => {
    const flag = meta.includes?.[token];
    const part = meta.parts?.[token] as V1StreamPart | undefined;
    if (flag === "satisfied") {
      return { token, outcome: "satisfied", part };
    }
    if (flag === "unavailable") {
      return { token, outcome: "unavailable", part, reason: part?.reason };
    }
    if (part !== undefined && part.source !== undefined) {
      return { token, outcome: "satisfied", part };
    }
    if (part !== undefined && part.status === "unavailable") {
      return { token, outcome: "unavailable", part, reason: part.reason };
    }
    return { token, outcome: "uncollected", part };
  });
}

/** True when every requested include was satisfied. */
export function includesAllSatisfied(states: readonly IncludeState[]): boolean {
  return states.every((state) => state.outcome === "satisfied");
}
