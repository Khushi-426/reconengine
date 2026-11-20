import { describe, it, expect } from "vitest";
import {
  calculateToleranceConfidence,
  chooseBatchSettlementSubset,
} from "../src/services/matchingService.js";

describe("matchingService helper logic", () => {
  // =========================================================================
  // calculateToleranceConfidence
  // =========================================================================

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

  it("returns 100 when toleranceAmount is 0 (no tolerance rule — exact match)", () => {
    const conf = calculateToleranceConfidence({ amountDiff: 0, toleranceAmount: 0 });
    expect(conf).toBe(100);
  });

  it("returns 100 when toleranceAmount is negative (guard branch)", () => {
    const conf = calculateToleranceConfidence({ amountDiff: 0.5, toleranceAmount: -1 });
    expect(conf).toBe(100);
  });

  // =========================================================================
  // chooseBatchSettlementSubset — precision & correctness
  // =========================================================================

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

  it("handles decimal amounts precisely — no floating-point drift", () => {
    // 0.1 + 0.2 === 0.30000000000000004 in IEEE 754; cent arithmetic must give 0.30 exactly
    const subset = chooseBatchSettlementSubset(
      [
        { ledgerTxnId: 1, amount: 0.1 },
        { ledgerTxnId: 2, amount: 0.2 },
      ],
      0.3
    );
    expect(subset).toEqual([1, 2]);
  });

  it("matches a single-item subset when it equals the batch total exactly", () => {
    const subset = chooseBatchSettlementSubset(
      [{ ledgerTxnId: 1, amount: 100.0 }],
      100.0
    );
    expect(subset).toEqual([1]);
  });

  it("returns [] when no prefix sum equals batchTotal", () => {
    const subset = chooseBatchSettlementSubset(
      [
        { ledgerTxnId: 1, amount: 10 },
        { ledgerTxnId: 2, amount: 15 },
      ],
      18
    );
    expect(subset).toEqual([]);
  });

  it("returns [] for empty candidate list", () => {
    expect(chooseBatchSettlementSubset([], 100)).toEqual([]);
  });

  it("returns [] when candidate count exceeds safety cap", () => {
    // Build 51 candidates — cap is 50
    const bigList = Array.from({ length: 51 }, (_, i) => ({ ledgerTxnId: i + 1, amount: 1.0 }));
    expect(chooseBatchSettlementSubset(bigList, 51)).toEqual([]);
  });

  it("tie-breaks deterministically by ledgerTxnId when amounts are equal", () => {
    // Both have amount 50; lower id (5) should come first in sorted order
    const subset = chooseBatchSettlementSubset(
      [
        { ledgerTxnId: 10, amount: 50 },
        { ledgerTxnId: 5, amount: 50 },
      ],
      50
    );
    // Only the first item (id=5) in sorted order is included; running sum hits batchTotal after first element
    expect(subset).toEqual([5]);
  });

  it("handles high-precision amounts within NUMERIC(18,2) range", () => {
    // 999999999999.99 + 0.01 = 1000000000000.00
    const subset = chooseBatchSettlementSubset(
      [
        { ledgerTxnId: 1, amount: 999999999999.99 },
        { ledgerTxnId: 2, amount: 0.01 },
      ],
      1000000000000.0
    );
    expect(subset).toEqual([2, 1]); // sorted ascending: 0.01 first, then 999999999999.99
  });
});
