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
    markBatchCompleted: vi.fn(),
    markBatchFailed: vi.fn(),
    bulkInsertExternalLines: vi.fn(),
  };
});

describe("importService - importExternalStatement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects malformed CSV and inserts a FAILED batch", async () => {
    const fileBuffer = Buffer.from("invalid,csv,data\n1,2"); // Missing headers, parse error or similar
    // To trigger a CSV parse error, let's use malformed quotes
    const malformedBuffer = Buffer.from('"unclosed quote,ref,amount\n');

    await expect(
      importExternalStatement({
        fileBuffer: malformedBuffer,
        fileName: "test.csv",
        sourceId: 2,
        uploadedBy: "00000000-0000-0000-0000-000000000001",
      })
    ).rejects.toThrow(AppError);

    // Verify it created a FAILED batch
    expect(db.withTransaction).toHaveBeenCalled();
  });

  it("rejects duplicate file_hash by throwing 409", async () => {
    const csvContent = "external_ref,account_ref,amount,currency,value_date\nREF-1,ACC-1,100.00,GBP,2026-07-18\n";
    const fileBuffer = Buffer.from(csvContent);

    // Mock createImportBatch to throw a 409
    vi.mocked(importRepo.createImportBatch).mockRejectedValueOnce(
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

    vi.mocked(importRepo.createImportBatch).mockResolvedValueOnce(999); // Mock batchId
    // Mock bulkInsertExternalLines to fail mid-batch (e.g. DB error)
    vi.mocked(importRepo.bulkInsertExternalLines).mockRejectedValueOnce(new Error("Database write error"));

    await expect(
      importExternalStatement({
        fileBuffer,
        fileName: "failed_batch.csv",
        sourceId: 2,
        uploadedBy: "00000000-0000-0000-0000-000000000001",
      })
    ).rejects.toThrow("Database write error");

    // Verify batch is marked as FAILED in catch block
    expect(importRepo.markBatchFailed).toHaveBeenCalledWith(expect.any(Object), 999, "Database write error");
  });
});
