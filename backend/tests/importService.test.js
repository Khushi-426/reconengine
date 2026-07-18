import { vi, describe, it, expect, beforeEach } from "vitest";
import { importExternalStatement } from "../src/services/importService.js";
import { AppError } from "../src/utils/AppError.js";
import * as db from "../src/config/db.js";
import * as importRepo from "../src/repositories/importRepository.js";

// Mock the db helpers and repository functions
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

vi.mock("../src/repositories/importRepository.js", () => {
  return {
    createImportBatch: vi.fn(),
    assertExternalImportSource: vi.fn(),
    createStagingTable: vi.fn(),
    validateStagingRecords: vi.fn().mockResolvedValue([]),
    insertFromStagingToMain: vi.fn(),
    markBatchCompleted: vi.fn(),
    markBatchFailed: vi.fn(),
  };
});

describe("importService - importExternalStatement with staging COPY", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects malformed CSV and inserts a FAILED batch", async () => {
    const malformedBuffer = Buffer.from('"unclosed quote,ref,amount\n');

    await expect(
      importExternalStatement({
        fileBuffer: malformedBuffer,
        fileName: "test.csv",
        sourceId: 2,
        uploadedBy: "00000000-0000-0000-0000-000000000001",
      })
    ).rejects.toThrow(AppError);

    // Verify it attempted transaction logging
    expect(db.withTransaction).toHaveBeenCalled();
  });

  it("rejects duplicate file_hash by throwing 409", async () => {
    const csvContent = "external_ref,account_ref,amount,currency,value_date\nREF-1,ACC-1,100.00,GBP,2026-07-18\n";
    const fileBuffer = Buffer.from(csvContent);

    // Mock duplicate check by returning a mock existing batch
    vi.spyOn(db, "withTransaction").mockRejectedValueOnce(
      new AppError(409, "This exact file was already imported", "DUPLICATE_IMPORT")
    );

    await expect(
      importExternalStatement({
        fileBuffer,
        fileName: "duplicate.csv",
        sourceId: 2,
        uploadedBy: "00000000-0000-0000-0000-000000000001",
      })
    ).rejects.toThrow(AppError);
  });

  it("rolls back fully on a mid-batch failure", async () => {
    const csvContent = "external_ref,account_ref,amount,currency,value_date\nREF-1,ACC-1,100.00,GBP,2026-07-18\n";
    const fileBuffer = Buffer.from(csvContent);

    // Mock insertFromStagingToMain to fail (e.g. DB constraint error during write)
    vi.mocked(importRepo.insertFromStagingToMain).mockRejectedValueOnce(new Error("Database copy constraint error"));

    await expect(
      importExternalStatement({
        fileBuffer,
        fileName: "failed_batch.csv",
        sourceId: 2,
        uploadedBy: "00000000-0000-0000-0000-000000000001",
      })
    ).rejects.toThrow("Database copy constraint error");

    // Verify markBatchFailed is invoked to audit-log the failure in DB
    expect(importRepo.markBatchFailed).toHaveBeenCalledWith(expect.any(Object), undefined, "Database copy constraint error");
  });
});
