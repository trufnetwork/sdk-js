import { hexlify } from "ethers";
import { describe, it, expect } from "vitest";
import { MAAAddress } from "./MAAAddress";

// Golden vectors for the Modular Agent Address (MAA) derivation. They are frozen network-wide and are
// asserted byte-for-byte by the node precompiles and every SDK — a mismatch here means this SDK would
// derive a different agent-wallet address than the chain, sending funds to the wrong wallet. Keep these
// in lockstep with node extensions/tn_utils/maa_test.go and the spec.

const hx = (b: string, n: number) => "0x" + b.repeat(n);

describe("MAAAddress golden vectors", () => {
  it("computeRulesHash — vector A (bps, two actions, one body-pinned)", () => {
    // Input order place,cancel proves the canonical sort (cancel < place) is applied regardless of order.
    const rh = MAAAddress.computeRulesHash(
      "bps",
      250,
      "0",
      ["main", "main"],
      ["ob_place_order", "ob_cancel_order"],
      [hx("cc", 32), null],
    );
    expect(hexlify(rh)).toBe("0xdf0555d336647bec5e9fe1f6f613086bddf53548b67c52393aef6db4cbef062d");
  });

  it("computeRulesHash — vector B (flat 1e18, empty allow-list)", () => {
    const rh = MAAAddress.computeRulesHash("flat", 0, "1000000000000000000", [], [], []);
    expect(hexlify(rh)).toBe("0x0b1edb0ad70fb94287e50c7b3deaea7bba4e500c4ae6a764ed9021faf091274a");
  });

  it("deriveRuleId — vector A (32-byte salt) and B (empty salt)", () => {
    const restricted = hx("11", 20);
    const idA = MAAAddress.deriveRuleId(
      restricted,
      "0xdf0555d336647bec5e9fe1f6f613086bddf53548b67c52393aef6db4cbef062d",
      hx("ab", 32),
    );
    expect(hexlify(idA)).toBe("0xa0b517da759b794e2484dc8b9dba8f5211a53dcdf26448f19c7c68699ff7bcf1");
    expect(idA.length).toBe(32); // untruncated identifier

    const idB = MAAAddress.deriveRuleId(
      restricted,
      "0x0b1edb0ad70fb94287e50c7b3deaea7bba4e500c4ae6a764ed9021faf091274a",
      null,
    );
    expect(hexlify(idB)).toBe("0x21f40fbf0fd537f85d283cf7b5f2fe8602c1f4b910aad96ad2dad9f6e82b1ca5");
  });

  it("deriveMAAAddress — vectors A and B (20-byte address)", () => {
    const unrestricted = hx("22", 20);
    const restricted = hx("11", 20);

    const addrA = MAAAddress.deriveMAAAddress(
      unrestricted,
      restricted,
      "0xa0b517da759b794e2484dc8b9dba8f5211a53dcdf26448f19c7c68699ff7bcf1",
    );
    expect(hexlify(addrA)).toBe("0x84da4dbca14d429c719d65a0bb76bd7fa3c5c349");
    expect(addrA.length).toBe(20);

    const addrB = MAAAddress.deriveMAAAddress(
      unrestricted,
      restricted,
      "0x21f40fbf0fd537f85d283cf7b5f2fe8602c1f4b910aad96ad2dad9f6e82b1ca5",
    );
    expect(hexlify(addrB)).toBe("0xcb009e348c3ad795aa6d7d81177f0daee4583128");
  });

  it("end-to-end — raw inputs through to the wallet a funder would fund", () => {
    const restricted = hx("11", 20);
    const unrestricted = hx("22", 20);
    const rh = MAAAddress.computeRulesHash(
      "bps",
      250,
      "0",
      ["main", "main"],
      ["ob_place_order", "ob_cancel_order"],
      [hx("cc", 32), null],
    );
    const id = MAAAddress.deriveRuleId(restricted, rh, hx("ab", 32));
    expect(MAAAddress.deriveMAAAddressHex(unrestricted, restricted, id)).toBe(
      "0x84da4dbca14d429c719d65a0bb76bd7fa3c5c349",
    );
  });
});

describe("MAAAddress canonicalization", () => {
  const base = () =>
    MAAAddress.computeRulesHash(
      "bps",
      250,
      "0",
      ["main", "main"],
      ["ob_place_order", "ob_cancel_order"],
      [hx("cc", 32), null],
    );

  it("is order-independent (canonical sort)", () => {
    const reordered = MAAAddress.computeRulesHash(
      "bps",
      250,
      "0",
      ["main", "main"],
      ["ob_cancel_order", "ob_place_order"],
      [null, hx("cc", 32)],
    );
    expect(hexlify(reordered)).toBe(hexlify(base()));
  });

  it("dedup key does not conflate distinct (namespace, action) pairs (NUL separator, not space)", () => {
    // ("a b","c") and ("a","b c") are DISTINCT pairs. A space dedup separator would collide them to
    // "a b c"; the NUL separator (matching node/sdk-go) keeps both. If they collided, `both` would
    // collapse to the last entry ("a","b c") and equal `onlySecond`.
    const both = MAAAddress.computeRulesHash("bps", 0, "0", ["a b", "a"], ["c", "b c"]);
    const onlySecond = MAAAddress.computeRulesHash("bps", 0, "0", ["a"], ["b c"]);
    expect(hexlify(both)).not.toBe(hexlify(onlySecond));
  });

  it("deduplicates (namespace, action) with last-write-wins on body_hash", () => {
    const lastWins = MAAAddress.computeRulesHash(
      "bps",
      250,
      "0",
      ["main", "main", "main"],
      ["ob_place_order", "ob_cancel_order", "ob_place_order"],
      [hx("dd", 32), null, hx("cc", 32)],
    );
    expect(hexlify(lastWins)).toBe(hexlify(base()));
  });
});

describe("MAAAddress validation", () => {
  it("rejects a bad fee_mode", () => {
    expect(() => MAAAddress.computeRulesHash("bogus" as any, 0, "0")).toThrow();
  });
  it("rejects a negative fee_flat", () => {
    expect(() => MAAAddress.computeRulesHash("bps", 0, "-1")).toThrow();
  });
  it("rejects a 31-byte body_hash", () => {
    expect(() => MAAAddress.computeRulesHash("bps", 0, "0", ["main"], ["a"], [hx("00", 31)])).toThrow();
  });
  it("rejects mismatched parallel-slice lengths", () => {
    expect(() => MAAAddress.computeRulesHash("bps", 0, "0", ["main"], ["a", "b"], [null])).toThrow();
  });
  it("rejects a non-20-byte restricted in deriveRuleId", () => {
    expect(() => MAAAddress.deriveRuleId(hx("11", 19), hx("33", 32), null)).toThrow();
  });
  it("rejects a non-32-byte rule_id in deriveMAAAddress", () => {
    expect(() => MAAAddress.deriveMAAAddress(hx("22", 20), hx("11", 20), hx("33", 31))).toThrow();
  });
});
