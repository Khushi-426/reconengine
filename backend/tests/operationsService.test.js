import { vi, describe, it, expect, beforeEach } from "vitest";
import {
  getOperationsKpis,
  getQueueStatus,
  getWorkerStatus,
} from "../src/services/operationsService.js";
import * as db from "../src/config/db.js";

vi.mock("../src/config/db.js", () => {
  return {
    query: vi.fn(),
  };
});

describe("operationsService - KPIs and Metrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("computes Operations KPIs accurately, with rounding", async () => {
    // Mock Avg Resolution Time
    vi.mocked(db.query).mockResolvedValueOnce({
      rows: [{ avg_hours: 4.678 }],
      rowCount: 1,
    });
    // Mock SLA Compliance
    vi.mocked(db.query).mockResolvedValueOnce({
      rows: [{ compliance_pct: 95.54 }],
      rowCount: 1,
    });
    // Mock Auto Match Rate
    vi.mocked(db.query).mockResolvedValueOnce({
      rows: [{ match_rate: 88.19 }],
      rowCount: 1,
    });
    // Mock Import Success Rate
    vi.mocked(db.query).mockResolvedValueOnce({
      rows: [{ success_rate: 98.21 }],
      rowCount: 1,
    });
    // Mock Active Queue Size
    vi.mocked(db.query).mockResolvedValueOnce({
      rows: [{ active_count: 14 }],
      rowCount: 1,
    });

    const kpis = await getOperationsKpis();

    expect(kpis.avgResolutionTimeHours).toBe(4.7);
    expect(kpis.slaComplianceRate).toBe(95.5);
    expect(kpis.autoMatchRate).toBe(88.2);
    expect(kpis.importSuccessRate).toBe(98.2);
    expect(kpis.activeQueueSize).toBe(14);
  });

  it("calculates Break distributions by status and category type", async () => {
    // Mock Status Breakdown
    vi.mocked(db.query).mockResolvedValueOnce({
      rows: [
        { status: "UNASSIGNED", count: "10" },
        { status: "IN_PROGRESS", count: "5" },
      ],
      rowCount: 2,
    });
    // Mock Type Breakdown
    vi.mocked(db.query).mockResolvedValueOnce({
      rows: [
        { exception_type: "amount_mismatch", count: "8" },
        { exception_type: "missing_ledger", count: "7" },
      ],
      rowCount: 2,
    });

    const res = await getQueueStatus();

    expect(res.byStatus.UNASSIGNED).toBe(10);
    expect(res.byStatus.IN_PROGRESS).toBe(5);
    expect(res.byType.amount_mismatch).toBe(8);
    expect(res.byType.missing_ledger).toBe(7);
  });

  it("aggregates Background Worker health logs, heartbeats, and scheduler settings", async () => {
    // Mock job state counts
    vi.mocked(db.query).mockResolvedValueOnce({
      rows: [
        { status: "COMPLETED", count: "150" },
        { status: "FAILED", count: "4" },
      ],
      rowCount: 2,
    });
    // Mock active workers
    vi.mocked(db.query).mockResolvedValueOnce({
      rows: [{ count: "2" }],
      rowCount: 1,
    });
    // Mock active schedulers
    vi.mocked(db.query).mockResolvedValueOnce({
      rows: [{ count: "5" }],
      rowCount: 1,
    });
    // Mock DLQ count
    vi.mocked(db.query).mockResolvedValueOnce({
      rows: [{ count: "1" }],
      rowCount: 1,
    });

    const res = await getWorkerStatus();

    expect(res.jobsByStatus.COMPLETED).toBe(150);
    expect(res.jobsByStatus.FAILED).toBe(4);
    expect(res.activeWorkerThreads).toBe(2);
    expect(res.activeSchedulers).toBe(5);
    expect(res.deadLetterQueueSize).toBe(1);
  });
});
