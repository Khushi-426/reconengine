import { vi, describe, it, expect, beforeEach } from "vitest";
import bcrypt from "bcrypt";
import { login, refresh, hashPassword } from "../src/services/authService.js";
import { AppError } from "../src/utils/AppError.js";
import * as usersRepo from "../src/repositories/usersRepository.js";
import * as db from "../src/config/db.js";

vi.mock("../src/config/db.js", () => {
  return {
    query: vi.fn(),
    withTransaction: vi.fn(async (fn) => {
      const mockClient = {
        query: vi.fn(),
      };
      return fn(mockClient);
    }),
  };
});

vi.mock("../src/repositories/usersRepository.js", () => {
  return {
    findUserByEmail: vi.fn(),
    incrementFailedAttempts: vi.fn(),
    resetFailedAttempts: vi.fn(),
    createUserSession: vi.fn(),
    findValidSession: vi.fn(),
    rotateUserSession: vi.fn(),
    revokeSessionByHash: vi.fn(),
    revokeAllUserSessions: vi.fn(),
  };
});

describe("authService - Security Enhancements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Password Complexity Policy", () => {
    it("rejects weak passwords missing uppercase", async () => {
      await expect(hashPassword("simple123!")).rejects.toThrow(AppError);
    });

    it("rejects weak passwords missing special character", async () => {
      await expect(hashPassword("Simple1234")).rejects.toThrow(AppError);
    });

    it("rejects weak passwords shorter than 8 characters", async () => {
      await expect(hashPassword("Sim1!")).rejects.toThrow(AppError);
    });

    it("hashes strong passwords complying with policy", async () => {
      const result = await hashPassword("StrongP4ssword!");
      expect(result).toBeDefined();
      expect(typeof result).toBe("string");
    });
  });

  describe("Account Lockout Policy", () => {
    it("refuses authentication if account is locked", async () => {
      const lockedDate = new Date(Date.now() + 10 * 60000); // locked for 10 more minutes
      vi.mocked(usersRepo.findUserByEmail).mockResolvedValueOnce({
        user_id: "u-1",
        email: "test@bank.com",
        locked_until: lockedDate,
      });

      await expect(login("test@bank.com", "Password123!", "127.0.0.1", "agent")).rejects.toThrow(
        /Account temporarily locked/
      );
    });

    it("logs failure and increments failed attempts count on password mismatch", async () => {
      vi.mocked(usersRepo.findUserByEmail).mockResolvedValueOnce({
        user_id: "u-1",
        email: "test@bank.com",
        password_hash: "some-hash",
        is_active: true,
      });

      await expect(login("test@bank.com", "WrongPassword123!", "127.0.0.1", "agent")).rejects.toThrow(
        AppError
      );
      expect(usersRepo.incrementFailedAttempts).toHaveBeenCalledWith("u-1");
    });
  });

  describe("Stateful Sessions & Refresh Token Rotation", () => {
    it("creates user session and resets failed counters on successful login", async () => {
      vi.mocked(usersRepo.findUserByEmail).mockResolvedValueOnce({
        user_id: "u-1",
        email: "test@bank.com",
        password_hash: bcrypt.hashSync("Secret123!", 10),
        is_active: true,
        role_name: "ANALYST",
        full_name: "John Analyst",
      });
      vi.mocked(usersRepo.createUserSession).mockResolvedValueOnce("session-uuid");

      const res = await login("test@bank.com", "Secret123!", "127.0.0.1", "agent");

      expect(usersRepo.resetFailedAttempts).toHaveBeenCalledWith("u-1");
      expect(usersRepo.createUserSession).toHaveBeenCalled();
      expect(res.accessToken).toBeDefined();
      expect(res.refreshToken).toBeDefined();
    });

    it("triggers global session revocation on refresh token replay attack", async () => {
      vi.mocked(usersRepo.findValidSession).mockResolvedValueOnce(null); // invalid / spent token
      // Mock db search finding that this token was once valid in user_sessions history
      vi.mocked(db.query).mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ user_id: "u-1", session_id: "session-uuid" }],
      });

      await expect(refresh("spent-token-abc", "127.0.0.1", "agent")).rejects.toThrow(
        "Invalid or expired refresh token"
      );

      // Verify immediate revocation of all sessions for this user ID
      expect(usersRepo.revokeAllUserSessions).toHaveBeenCalledWith("u-1");
    });
  });
});
