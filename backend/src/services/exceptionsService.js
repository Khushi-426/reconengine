import { withTransaction } from "../config/db.js";
import {
  findExceptions,
  resolveExceptionWithLock,
  assignExceptionPessimistic,
  getExceptionTrendReport,
} from "../repositories/exceptionsRepository.js";
import { AppError } from "../utils/AppError.js";

export async function listExceptions(filters) {
  return findExceptions(filters);
}

export async function resolveException({ exceptionId, expectedVersion, resolvedBy, resolvedByRole, resolutionNote, decision }) {
  if (!["RESOLVED", "WRITTEN_OFF"].includes(decision)) {
    throw new AppError(422, "decision must be RESOLVED or WRITTEN_OFF");
  }
  // Only APPROVER/ADMIN can write off (business rule: analysts can resolve
  // matches they found, but writing off a discrepancy needs sign-off).
  if (decision === "WRITTEN_OFF" && !["APPROVER", "ADMIN"].includes(resolvedByRole)) {
    throw new AppError(403, "Only an APPROVER or ADMIN may write off an exception");
  }
  if (!resolutionNote || resolutionNote.trim().length < 5) {
    throw new AppError(422, "A resolution note of at least 5 characters is required for audit purposes");
  }

  return withTransaction(
    (client) =>
      resolveExceptionWithLock(client, {
        exceptionId,
        expectedVersion,
        resolvedBy,
        resolutionNote,
        status: decision,
      }),
    { userId: resolvedBy, userRole: resolvedByRole }
  );
}

export async function assignException({ exceptionId, assignTo, assignedBy, assignedByRole }) {
  return withTransaction(
    (client) => assignExceptionPessimistic(client, { exceptionId, assignTo }),
    { userId: assignedBy, userRole: assignedByRole }
  );
}

export async function getTrendReport({ fromDate, toDate }) {
  return getExceptionTrendReport({ fromDate, toDate });
}
