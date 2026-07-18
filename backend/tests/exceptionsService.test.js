import { vi, describe, it, expect, beforeEach } from "vitest";
import { resolveException } from "../src/services/exceptionsService.js";
import { AppError } from "../src/utils/AppError.js";
import * as db from "../src/config/db.js";
import * as exceptionsRepo from "../src/repositories/exceptionsRepository.js";

vi.mock("../src/config/db.js", () => {
  return {
    withTransaction: vi.fn(async (fn) => {
      const mockClient = {};
      return fn(mockClient);
    }),
  };
});

vi.mock("../src/repositories/exceptionsRepository.js", () => {
  return {
    resolveExceptionWithLock: vi.fn(),
  };
});

describe("exceptionsService - resolveException", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("checks role permission and rejects write off for ANALYST", async () => {
    await expect(
      resolveException({
        exceptionId: 1,
        expectedVersion: 1,
        resolvedBy: "00000000-0000-0000-0000-000000000001",
        resolvedByRole: "ANALYST",
        resolutionNote: "This matches perfectly",
        decision: "WRITTEN_OFF",
      })
    ).rejects.toThrow(AppError);
  });

  it("permits write off for APPROVER/ADMIN", async () => {
    vi.mocked(exceptionsRepo.resolveExceptionWithLock).mockResolvedValueOnce({
      exception_id: 1,
      version: 2,
      status: "WRITTEN_OFF",
    });

    const result = await resolveException({
      exceptionId: 1,
      expectedVersion: 1,
      resolvedBy: "00000000-0000-0000-0000-000000000001",
      resolvedByRole: "APPROVER",
      resolutionNote: "This is a legitimate charge difference",
      decision: "WRITTEN_OFF",
    });

    expect(result.status).toBe("WRITTEN_OFF");
  });

  it("rejects resolutionNote shorter than 5 characters", async () => {
    await expect(
      resolveException({
        exceptionId: 1,
        expectedVersion: 1,
        resolvedBy: "00000000-0000-0000-0000-000000000001",
        resolvedByRole: "ANALYST",
        resolutionNote: "Ok",
        decision: "RESOLVED",
      })
    ).rejects.toThrow(AppError);
  });

  it("handles optimistic locking conflict", async () => {
    vi.mocked(exceptionsRepo.resolveExceptionWithLock).mockRejectedValueOnce(
      new AppError(409, "This exception was modified by another user", "OPTIMISTIC_LOCK_CONFLICT")
    );

    await expect(
      resolveException({
        exceptionId: 1,
        expectedVersion: 1,
        resolvedBy: "00000000-0000-0000-0000-000000000001",
        resolvedByRole: "ANALYST",
        resolutionNote: "Legit resolution note here",
        decision: "RESOLVED",
      })
    ).rejects.toThrow(AppError);
  });
});
