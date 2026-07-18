import * as exceptionsService from "../services/exceptionsService.js";

export async function listExceptionsHandler(req, res, next) {
  try {
    const { status, assignedTo, exceptionType, search, page, pageSize } = req.query;
    const result = await exceptionsService.listExceptions({
      status,
      assignedTo,
      exceptionType,
      search,
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? Math.min(parseInt(pageSize, 10), 100) : 25, // hard cap to prevent abuse
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function startWorkExceptionHandler(req, res, next) {
  try {
    const { exceptionId } = req.params;
    const result = await exceptionsService.startWorkException({
      exceptionId,
      analystId: req.user.userId,
      userId: req.user.userId,
      userRole: req.user.role,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function resolveExceptionHandler(req, res, next) {
  try {
    const { exceptionId } = req.params;
    const { expectedVersion, resolutionNote } = req.body;
    const result = await exceptionsService.resolveException({
      exceptionId,
      expectedVersion,
      resolvedBy: req.user.userId,
      resolvedByRole: req.user.role,
      resolutionNote,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function approveExceptionHandler(req, res, next) {
  try {
    const { exceptionId } = req.params;
    const { expectedVersion } = req.body;
    const result = await exceptionsService.approveException({
      exceptionId,
      expectedVersion,
      approvedBy: req.user.userId,
      approvedByRole: req.user.role,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function closeExceptionHandler(req, res, next) {
  try {
    const { exceptionId } = req.params;
    const { expectedVersion } = req.body;
    const result = await exceptionsService.closeException({
      exceptionId,
      expectedVersion,
      closedBy: req.user.userId,
      closedByRole: req.user.role,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function assignExceptionHandler(req, res, next) {
  try {
    const { exceptionId } = req.params;
    const { assignTo } = req.body;
    const result = await exceptionsService.assignException({
      exceptionId,
      assignTo,
      assignedBy: req.user.userId,
      assignedByRole: req.user.role,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function trendReportHandler(req, res, next) {
  try {
    const { fromDate, toDate } = req.query;
    const result = await exceptionsService.getTrendReport({ fromDate, toDate });
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}
