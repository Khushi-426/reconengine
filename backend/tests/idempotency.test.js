import { vi, describe, it, expect, beforeEach } from "vitest";
import { idempotencyKeyGuard } from "../src/middleware/idempotencyMiddleware.js";
import { AppError } from "../src/utils/AppError.js";
import * as db from "../src/config/db.js";

vi.mock("../src/config/db.js", () => {
  return {
    query: vi.fn().mockResolvedValue({ rowCount: 0, rows: [] }),
  };
});

describe("idempotencyKeyGuard", () => {
  let req;
  let res;
  let next;

  beforeEach(() => {
    vi.clearAllMocks();
    req = {
      headers: {},
      method: "POST",
      originalUrl: "/api/test",
      user: { userId: "user-123" },
    };
    res = {
      status: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      statusCode: 200,
    };
    next = vi.fn();
  });

  it("bypasses requests without Idempotency-Key header", async () => {
    await idempotencyKeyGuard(req, res, next);
    expect(next).toHaveBeenCalledWith();
    expect(db.query).not.toHaveBeenCalled();
  });

  it("bypasses non-mutating HTTP methods", async () => {
    req.headers["idempotency-key"] = "key-abc";
    req.method = "GET";
    await idempotencyKeyGuard(req, res, next);
    expect(next).toHaveBeenCalledWith();
    expect(db.query).not.toHaveBeenCalled();
  });

  it("handles initial request by storing it in PROCESSING status", async () => {
    req.headers["idempotency-key"] = "key-abc";
    vi.mocked(db.query).mockResolvedValueOnce({ rowCount: 0, rows: [] }); // key check
    vi.mocked(db.query).mockResolvedValueOnce({ rowCount: 1, rows: [] }); // key insert

    await idempotencyKeyGuard(req, res, next);

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO idempotency_keys"),
      expect.any(Array)
    );
    expect(next).toHaveBeenCalledWith();

    // Verify response interception caches the response
    const mockResponseBody = { success: true };
    res.json(mockResponseBody);

    // Give microtasks time to execute async database writes
    await new Promise((resolve) => setImmediate(resolve));

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE idempotency_keys SET status = 'COMPLETED'"),
      expect.any(Array)
    );
  });

  it("rejects with 409 conflict when request is already in PROGRESS", async () => {
    req.headers["idempotency-key"] = "key-abc";
    vi.mocked(db.query).mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ status: "PROCESSING" }],
    });

    await idempotencyKeyGuard(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    const error = next.mock.calls[0][0];
    expect(error.statusCode).toBe(409);
    expect(error.code).toBe("IDEMPOTENCY_IN_PROGRESS");
  });

  it("returns cached response when request was already COMPLETED", async () => {
    req.headers["idempotency-key"] = "key-abc";
    const cachedBody = { result: "cached" };
    vi.mocked(db.query).mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          status: "COMPLETED",
          response_code: 201,
          response_body: cachedBody,
        },
      ],
    });

    await idempotencyKeyGuard(req, res, next);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.set).toHaveBeenCalledWith("X-Cache-Idempotency", "true");
    expect(res.json).toHaveBeenCalledWith(cachedBody);
    expect(next).not.toHaveBeenCalled();
  });
});
