import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { config } from "../config/env.js";
import { AppError } from "../utils/AppError.js";
import {
  findUserByEmail,
  createRefreshToken,
  findValidRefreshToken,
  revokeRefreshToken,
} from "../repositories/usersRepository.js";

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function issueAccessToken(user) {
  return jwt.sign(
    { sub: user.user_id, role: user.role_name, email: user.email },
    config.jwt.accessSecret,
    { expiresIn: config.jwt.accessExpiresIn }
  );
}

async function issueRefreshToken(user) {
  const raw = crypto.randomBytes(48).toString("hex");
  const tokenHash = hashToken(raw);
  const expiresAt = new Date(Date.now() + config.jwt.refreshExpiresInDays * 24 * 60 * 60 * 1000);
  await createRefreshToken({ userId: user.user_id, tokenHash, expiresAt });
  return raw;
}

export async function login(email, password) {
  // Deliberately generic error message + constant-ish work on failure to
  // reduce user-enumeration risk via response-time/content differences.
  const user = await findUserByEmail(email);
  const dummyHash = "$2b$10$CwTycUXWue0Thq9StjUM0uJ8h6PGZm4Q0Ib3Rv3.p9v2rQ6f6Yz3S";
  const passwordMatches = await bcrypt.compare(password, user?.password_hash || dummyHash);

  if (!user || !user.is_active || !passwordMatches) {
    throw new AppError(401, "Invalid email or password");
  }

  const accessToken = issueAccessToken(user);
  const refreshToken = await issueRefreshToken(user);

  return {
    accessToken,
    refreshToken,
    user: { id: user.user_id, email: user.email, fullName: user.full_name, role: user.role_name },
  };
}

export async function refresh(rawRefreshToken) {
  const tokenHash = hashToken(rawRefreshToken);
  const record = await findValidRefreshToken(tokenHash);
  if (!record) throw new AppError(401, "Invalid or expired refresh token");

  // rotate: revoke the old one, issue a new pair (prevents replay of stolen tokens)
  await revokeRefreshToken(tokenHash);
  const user = { user_id: record.user_id, email: record.email, role_name: record.role_name };
  const accessToken = issueAccessToken(user);
  const newRefreshToken = await issueRefreshToken(user);

  return { accessToken, refreshToken: newRefreshToken };
}

export async function logout(rawRefreshToken) {
  await revokeRefreshToken(hashToken(rawRefreshToken));
}

export async function hashPassword(plain) {
  return bcrypt.hash(plain, 12);
}
