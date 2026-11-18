import { describe, expect, it } from "vitest";
import {
  classifyIncludes,
  includeQueryValue,
  includesAllSatisfied,
  normalizeIncludes,
} from "./includes";
import type { V1MetaData } from "./types";

/** Tests for the `include` set (the issue's "join sets") and its outcomes. */

const self = { source: "core", at: 1_700_000_000, unit: "unix" };

describe("normalizeIncludes", () => {
  it("splits a comma-separated string and sorts it", () => {
    expect(normalizeIncludes("prices,metadata")).toEqual([
      "metadata",
      "prices",
    ]);
  });

  it("trims, drops empties, and deduplicates across repeated values", () => {
    expect(normalizeIncludes([" prices ", "metadata", "metadata", ""])).toEqual(
      ["metadata", "prices"],
    );
  });

  it("treats an empty or absent value as the empty set", () => {
    expect(normalizeIncludes(undefined)).toEqual([]);
    expect(normalizeIncludes(null)).toEqual([]);
    expect(normalizeIncludes("")).toEqual([]);
    expect(normalizeIncludes(["", " , "])).toEqual([]);
  });
});

describe("includeQueryValue", () => {
  it("returns the normalised, comma-joined set", () => {
    expect(includeQueryValue(["depth", "metadata", "depth"])).toBe(
      "depth,metadata",
    );
  });

  it("returns undefined for an empty set", () => {
    expect(includeQueryValue([])).toBeUndefined();
    expect(includeQueryValue(undefined)).toBeUndefined();
  });
});

describe("classifyIncludes", () => {
  it("reports satisfied, unavailable, and uncollected per token", () => {
    const meta: V1MetaData = {
      cursor: null,
      data_version: "1",
      includes: { metadata: "satisfied", prices: "unavailable" },
      parts: {
        self,
        metadata: { source: "api", at: 1_700_000_100, unit: "unix" },
        prices: { status: "unavailable", reason: "namespace_unavailable" },
      },
    };

    const states = classifyIncludes(["metadata", "prices", "depth"], meta);

    // `classifyIncludes` normalises first, so the order is the sorted token set.
    expect(states).toEqual([
      { token: "depth", outcome: "uncollected", part: undefined },
      {
        token: "metadata",
        outcome: "satisfied",
        part: { source: "api", at: 1_700_000_100, unit: "unix" },
      },
      {
        token: "prices",
        outcome: "unavailable",
        part: { status: "unavailable", reason: "namespace_unavailable" },
        reason: "namespace_unavailable",
      },
    ]);
  });

  it("infers satisfied from a part with a source and unavailable from a status", () => {
    const meta: V1MetaData = {
      cursor: null,
      data_version: "1",
      parts: {
        self,
        chain: { source: "node", at: 10, unit: "height" },
        depth: { status: "unavailable", reason: "uncollected" },
      },
    };

    const states = classifyIncludes(["chain", "depth"], meta);

    expect(states.map((s) => s.outcome)).toEqual(["satisfied", "unavailable"]);
    expect(states[1]?.reason).toBe("uncollected");
  });

  it("treats a missing part as uncollected", () => {
    const meta: V1MetaData = { cursor: null, data_version: "1" };
    expect(classifyIncludes(["metadata"], meta)).toEqual([
      { token: "metadata", outcome: "uncollected", part: undefined },
    ]);
  });
});

describe("includesAllSatisfied", () => {
  it("is true only when every requested include was satisfied", () => {
    expect(includesAllSatisfied([])).toBe(true);
    expect(
      includesAllSatisfied([{ token: "metadata", outcome: "satisfied" }]),
    ).toBe(true);
    expect(
      includesAllSatisfied([
        { token: "metadata", outcome: "satisfied" },
        { token: "prices", outcome: "uncollected" },
      ]),
    ).toBe(false);
  });
});
