import { vi, describe, it, expect, beforeEach } from "vitest";
import { idempotencyKeyGuard } from "../src/middleware/idempotencyMiddleware.js";
import { AppError } from "../src/utils/AppError.js";
import * as repo from "../src/repositories/idempotencyRepository.js";

vi.mock("../src/repositories/idempotencyRepository.js", () => {
  return {
    claimIdempotencyKey: vi.fn(),
    completeIdempotencyKey: vi.fn().mockResolvedValue(undefined),
    releaseIdempotencyKey: vi.fn().mockResolvedValue(undefined),
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
      body: { amount: 100, currency: "GBP" },
      query: {},
      user: { userId: "00000000-0000-0000-0000-000000000123" },
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
    expect(repo.claimIdempotencyKey).not.toHaveBeenCalled();
  });

  it("stores a new request in PROCESSING and completes it on success", async () => {
    req.headers["idempotency-key"] = "key-abc";
    vi.mocked(repo.claimIdempotencyKey).mockResolvedValueOnce({
      inserted: true,
      record: { status: "PROCESSING" },
    });

    await idempotencyKeyGuard(req, res, next);

    expect(repo.claimIdempotencyKey).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();

    res.json({ success: true });
    await new Promise((resolve) => setImmediate(resolve));

    expect(repo.completeIdempotencyKey).toHaveBeenCalledWith(
      expect.objectContaining({
        responseCode: 200,
        responseBody: { success: true },
      })
    );
  });

  it("rejects a duplicate in-progress request", async () => {
    req.headers["idempotency-key"] = "key-abc";
    vi.mocked(repo.claimIdempotencyKey).mockImplementationOnce(async ({ requestFingerprint }) => ({
      inserted: false,
      record: {
        status: "PROCESSING",
        request_fingerprint: requestFingerprint,
      },
    }));

    await idempotencyKeyGuard(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    const error = next.mock.calls[0][0];
    expect(error.code).toBe("IDEMPOTENCY_IN_PROGRESS");
  });

  it("rejects when the same key is reused with a different payload", async () => {
    req.headers["idempotency-key"] = "key-abc";
    vi.mocked(repo.claimIdempotencyKey).mockResolvedValueOnce({
      inserted: false,
      record: {
        status: "PROCESSING",
        request_fingerprint: "different-fingerprint",
      },
    });

    await idempotencyKeyGuard(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    const error = next.mock.calls[0][0];
    expect(error.code).toBe("IDEMPOTENCY_PAYLOAD_MISMATCH");
  });

  it("replays a cached response for a completed identical request", async () => {
    req.headers["idempotency-key"] = "key-abc";
    const cachedBody = { result: "cached" };
    vi.mocked(repo.claimIdempotencyKey).mockImplementationOnce(async ({ requestFingerprint }) => ({
      inserted: false,
      record: {
        status: "COMPLETED",
        response_code: 201,
        response_body: cachedBody,
        request_fingerprint: requestFingerprint,
      },
    }));

    await idempotencyKeyGuard(req, res, next);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.set).toHaveBeenCalledWith("X-Cache-Idempotency", "true");
    expect(res.json).toHaveBeenCalledWith(cachedBody);
    expect(next).not.toHaveBeenCalled();
  });
});
