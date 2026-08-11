import { describe, it, expect } from "vitest";
import {
  calculateToleranceConfidence,
  chooseBatchSettlementSubset,
} from "../src/services/matchingService.js";

describe("matchingService helper logic", () => {
  it("assigns higher confidence to smaller tolerance deltas", () => {
    const nearPerfect = calculateToleranceConfidence({
      amountDiff: 0.1,
      toleranceAmount: 1,
      dayDiff: 0,
    });

    const boundary = calculateToleranceConfidence({
      amountDiff: 1,
      toleranceAmount: 1,
      dayDiff: 3,
    });

    expect(nearPerfect).toBeGreaterThan(boundary);
    expect(boundary).toBeGreaterThanOrEqual(70);
  });

  it("returns an empty subset when the greedy batch matcher overshoots", () => {
    const subset = chooseBatchSettlementSubset(
      [
        { ledgerTxnId: 1, amount: 10 },
        { ledgerTxnId: 2, amount: 20 },
        { ledgerTxnId: 3, amount: 40 },
      ],
      45
    );

    expect(subset).toEqual([]);
  });

  it("returns a deterministic subset when the ordered running sum matches exactly", () => {
    const subset = chooseBatchSettlementSubset(
      [
        { ledgerTxnId: 3, amount: 30 },
        { ledgerTxnId: 1, amount: 10 },
        { ledgerTxnId: 2, amount: 20 },
      ],
      60
    );

    expect(subset).toEqual([1, 2, 3]);
  });
});
