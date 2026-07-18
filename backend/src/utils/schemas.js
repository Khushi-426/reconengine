import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const listExceptionsQuerySchema = z.object({
  status: z.enum(["OPEN", "IN_REVIEW", "RESOLVED", "WRITTEN_OFF"]).optional(),
  assignedTo: z.string().uuid().optional(),
  exceptionType: z.enum(["MISSING_EXTERNAL", "MISSING_INTERNAL", "AMOUNT_MISMATCH", "DUPLICATE", "TIMING"]).optional(),
  search: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

export const resolveExceptionSchema = z.object({
  expectedVersion: z.number().int().min(1),
  resolutionNote: z.string().min(5).max(2000),
  decision: z.enum(["RESOLVED", "WRITTEN_OFF"]),
});

export const assignExceptionSchema = z.object({
  assignTo: z.string().uuid(),
});

export const exceptionIdParamSchema = z.object({
  exceptionId: z.coerce.number().int().positive(),
});

export const triggerRunSchema = z.object({
  runDate: z.string().date().optional(),
});
