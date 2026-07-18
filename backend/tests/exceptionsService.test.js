import { vi, describe, it, expect, beforeEach } from "vitest";
import {
  resolveException,
  startWorkException,
  approveException,
  closeException,
} from "../src/services/exceptionsService.js";
import { AppError } from "../src/utils/AppError.js";
import * as exceptionsRepo from "../src/repositories/exceptionsRepository.js";

vi.mock("../src/config/db.js", () => {
  return {
    withTransaction: vi.fn(async (fn) => {
      const mockClient = {
        query: vi.fn().mockResolvedValue({ rowCount: 0, rows: [] }),
      };
      return fn(mockClient);
    }),
  };
});

vi.mock("../src/repositories/exceptionsRepository.js", () => {
  return {
    resolveExceptionWithLock: vi.fn(),
    startWorkOnException: vi.fn(),
    approveExceptionWithLock: vi.fn(),
    closeExceptionWithLock: vi.fn(),
  };
});

describe("exceptionsService - state machine workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("startWorkException", () => {
    it("permits analyst starting work on their own assignment", async () => {
      vi.mocked(exceptionsRepo.startWorkOnException).mockResolvedValueOnce({
        exception_id: 1,
        status: "IN_PROGRESS",
      });

      const result = await startWorkException({
        exceptionId: 1,
        analystId: "user-1",
        userId: "user-1",
        userRole: "ANALYST",
      });
      expect(result.status).toBe("IN_PROGRESS");
    });

    it("rejects analyst starting work on someone else's assignment", async () => {
      await expect(
        startWorkException({
          exceptionId: 1,
          analystId: "user-2",
          userId: "user-1",
          userRole: "ANALYST",
        })
      ).rejects.toThrow(AppError);
    });
  });

  describe("resolveException", () => {
    it("rejects resolutionNote shorter than 5 characters", async () => {
      await expect(
        resolveException({
          exceptionId: 1,
          expectedVersion: 1,
          resolvedBy: "user-1",
          resolvedByRole: "ANALYST",
          resolutionNote: "Ok",
        })
      ).rejects.toThrow(AppError);
    });

    it("resolves successfully with a valid note", async () => {
      vi.mocked(exceptionsRepo.resolveExceptionWithLock).mockResolvedValueOnce({
        exception_id: 1,
        status: "RESOLVED",
      });

      const result = await resolveException({
        exceptionId: 1,
        expectedVersion: 1,
        resolvedBy: "user-1",
        resolvedByRole: "ANALYST",
        resolutionNote: "This matches perfectly, fee delta checked",
      });
      expect(result.status).toBe("RESOLVED");
    });
  });

  describe("approveException", () => {
    it("rejects approval from ANALYST role", async () => {
      await expect(
        approveException({
          exceptionId: 1,
          expectedVersion: 1,
          approvedBy: "user-1",
          approvedByRole: "ANALYST",
        })
      ).rejects.toThrow(AppError);
    });

    it("permits approval from APPROVER role", async () => {
      vi.mocked(exceptionsRepo.approveExceptionWithLock).mockResolvedValueOnce({
        exception_id: 1,
        status: "APPROVED",
      });

      const result = await approveException({
        exceptionId: 1,
        expectedVersion: 1,
        approvedBy: "user-2",
        approvedByRole: "APPROVER",
      });
      expect(result.status).toBe("APPROVED");
    });
  });

  describe("closeException", () => {
    it("rejects close action from ANALYST role", async () => {
      await expect(
        closeException({
          exceptionId: 1,
          expectedVersion: 1,
          closedBy: "user-1",
          closedByRole: "ANALYST",
        })
      ).rejects.toThrow(AppError);
    });

    it("permits close action from ADMIN role", async () => {
      vi.mocked(exceptionsRepo.closeExceptionWithLock).mockResolvedValueOnce({
        exception_id: 1,
        status: "CLOSED",
      });

      const result = await closeException({
        exceptionId: 1,
        expectedVersion: 1,
        closedBy: "user-3",
        closedByRole: "ADMIN",
      });
      expect(result.status).toBe("CLOSED");
    });
  });
});
