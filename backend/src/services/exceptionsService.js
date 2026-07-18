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

export async function startWorkException({ exceptionId, analystId, userId, userRole }) {
  if (userRole === "ANALYST" && analystId !== userId) {
    throw new AppError(403, "You can only start work on exceptions assigned to yourself");
  }
  return withTransaction(
    (client) => import("../repositories/exceptionsRepository.js").then((r) => r.startWorkOnException(client, { exceptionId, analystId })),
    { userId, userRole }
  );
}

export async function resolveException({ exceptionId, expectedVersion, resolvedBy, resolvedByRole, resolutionNote }) {
  if (!resolutionNote || resolutionNote.trim().length < 5) {
    throw new AppError(422, "A resolution note of at least 5 characters is required for audit purposes");
  }

  return withTransaction(
    async (client) => {
      const result = await resolveExceptionWithLock(client, {
        exceptionId,
        expectedVersion,
        resolvedBy,
        resolutionNote,
      });

      // Notify all approvers and administrators
      const approversRes = await client.query("SELECT user_id FROM users WHERE role_id IN (1, 2) AND deleted_at IS NULL");
      await import("../repositories/notificationsRepository.js").then(async (repo) => {
        for (const row of approversRes.rows) {
          if (row.user_id === resolvedBy) continue; // Avoid notifying self
          await repo.createNotification(client, {
            userId: row.user_id,
            title: "Exception Pending Approval",
            message: `Exception #${exceptionId} has been resolved and is waiting for your review.`,
            link: `/exceptions?status=RESOLVED`,
          });
        }
      });

      return result;
    },
    { userId: resolvedBy, userRole: resolvedByRole }
  );
}

export async function approveException({ exceptionId, expectedVersion, approvedBy, approvedByRole }) {
  if (!["APPROVER", "ADMIN"].includes(approvedByRole)) {
    throw new AppError(403, "Only an APPROVER or ADMIN can approve exception resolutions");
  }

  return withTransaction(
    async (client) => {
      const result = await import("../repositories/exceptionsRepository.js").then((r) => r.approveExceptionWithLock(client, { exceptionId, expectedVersion, approvedBy }));

      // Notify the assigned analyst
      const exRes = await client.query("SELECT assigned_to FROM reconciliation_exceptions WHERE exception_id = $1", [exceptionId]);
      const assignedTo = exRes.rows[0]?.assigned_to;
      if (assignedTo) {
        await import("../repositories/notificationsRepository.js").then(async (repo) => {
          await repo.createNotification(client, {
            userId: assignedTo,
            title: "Exception Resolution Approved",
            message: `Your resolution for Exception #${exceptionId} has been approved.`,
            link: `/exceptions?status=APPROVED`,
          });
        });
      }
      return result;
    },
    { userId: approvedBy, userRole: approvedByRole }
  );
}

export async function closeException({ exceptionId, expectedVersion, closedBy, closedByRole }) {
  if (!["APPROVER", "ADMIN"].includes(closedByRole)) {
    throw new AppError(403, "Only an APPROVER or ADMIN can close exceptions");
  }

  return withTransaction(
    async (client) => {
      const result = await import("../repositories/exceptionsRepository.js").then((r) => r.closeExceptionWithLock(client, { exceptionId, expectedVersion, closedBy }));

      // Notify the assigned analyst
      const exRes = await client.query("SELECT assigned_to FROM reconciliation_exceptions WHERE exception_id = $1", [exceptionId]);
      const assignedTo = exRes.rows[0]?.assigned_to;
      if (assignedTo) {
        await import("../repositories/notificationsRepository.js").then(async (repo) => {
          await repo.createNotification(client, {
            userId: assignedTo,
            title: "Exception Closed",
            message: `Exception #${exceptionId} has been closed.`,
            link: `/exceptions?status=CLOSED`,
          });
        });
      }
      return result;
    },
    { userId: closedBy, userRole: closedByRole }
  );
}

export async function assignException({ exceptionId, assignTo, assignedBy, assignedByRole }) {
  if (!["APPROVER", "ADMIN"].includes(assignedByRole)) {
    throw new AppError(403, "Only an APPROVER or ADMIN can assign exceptions");
  }

  return withTransaction(
    async (client) => {
      const updated = await assignExceptionPessimistic(client, { exceptionId, assignTo });
      await import("../repositories/notificationsRepository.js").then(async (repo) => {
        await repo.createNotification(client, {
          userId: assignTo,
          title: "Exception Assigned",
          message: `Exception #${exceptionId} (${updated.exception_type}) has been assigned to you.`,
          link: `/exceptions?status=ASSIGNED`,
        });
      });
      return updated;
    },
    { userId: assignedBy, userRole: assignedByRole }
  );
}

export async function getTrendReport({ fromDate, toDate }) {
  return getExceptionTrendReport({ fromDate, toDate });
}
