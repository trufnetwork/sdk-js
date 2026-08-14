// Reflecting a consolidated book into the opposite outcome.
//
// The property that matters is the last test: the reflection has to agree with
// consolidating the other outcome directly, because that is the chain read it
// replaces.

import { describe, expect, test } from "vitest";
import type { ConsolidatedOrderBook } from "../types/orderbook";
import {
  consolidateSide,
  reflectConsolidatedBook,
} from "./consolidatedBook";

function level(price: number, native: number, inverse: number) {
  return { price, total: native + inverse, native, inverse };
}

describe("reflectConsolidatedBook", () => {
  test("swaps the sides and the native/inverse split", () => {
    // A YES ask at 60 holding 10 YES sells and 4 NO buys (resting at 40) is, in
    // the NO frame, a NO bid at 40 holding those 4 NO buys natively and the 10
    // YES sells as its inverse.
    const yes: ConsolidatedOrderBook = {
      queryId: 419,
      outcome: true,
      asks: [level(60, 10, 4)],
      bids: [level(30, 20, 0)],
      isCrossed: false,
    };

    const no = reflectConsolidatedBook(yes);

    expect(no.queryId).toBe(419);
    expect(no.outcome).toBe(false);
    expect(no.bids).toEqual([{ price: 40, total: 14, native: 4, inverse: 10 }]);
    expect(no.asks).toEqual([{ price: 70, total: 20, native: 0, inverse: 20 }]);
  });

  test("round-trips back to itself", () => {
    const yes: ConsolidatedOrderBook = {
      queryId: 419,
      outcome: true,
      asks: [level(16, 320, 29), level(19, 289, 53)],
      bids: [level(4, 1049, 33), level(1, 4283, 56)],
      isCrossed: false,
    };

    expect(reflectConsolidatedBook(reflectConsolidatedBook(yes))).toEqual(yes);
  });

  test("matches consolidating the other outcome directly", () => {
    const yesBids = [{ price: 40, size: 20 }];
    const yesAsks = [{ price: 60, size: 10 }];
    const noBids = [{ price: 30, size: 7 }];
    const noAsks = [{ price: 55, size: 3 }];

    const yesB = consolidateSide(yesBids, noAsks, "bid");
    const yesA = consolidateSide(yesAsks, noBids, "ask");
    const yes: ConsolidatedOrderBook = {
      queryId: 419,
      outcome: true,
      bids: yesB,
      asks: yesA,
      isCrossed: yesB[0].price >= yesA[0].price,
    };

    const noB = consolidateSide(noBids, yesAsks, "bid");
    const noA = consolidateSide(noAsks, yesBids, "ask");

    const reflected = reflectConsolidatedBook(yes);
    expect(reflected.bids).toEqual(noB);
    expect(reflected.asks).toEqual(noA);
    expect(reflected.isCrossed).toBe(noB[0].price >= noA[0].price);
  });
});
