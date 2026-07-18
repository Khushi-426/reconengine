import * as matchingService from "../services/matchingService.js";
import * as jobsService from "../services/jobsService.js";

export async function triggerRunHandler(req, res, next) {
  try {
    const { runDate } = req.body;
    const targetDate = runDate || new Date().toISOString().slice(0, 10);
    // Validate before queueing so callers get an actionable response instead
    // of a background-job retry/DLQ cycle when no statement has been imported.
    const batch = await matchingService.getAvailableExternalSettlementBatch();
    const job = await jobsService.queueJob({
      jobType: "RECONCILIATION_RUN",
      payload: { runDate: targetDate, batchId: batch.batch_id, triggeredBy: req.user.userId },
      priority: 20,
      userId: req.user.userId,
      userRole: req.user.role,
    });
    res.status(202).json({
      message: "Reconciliation run queued successfully.",
      jobId: job.job_id,
      status: job.status,
    });
  } catch (err) {
    next(err);
  }
}

export async function getJobStatusHandler(req, res, next) {
  try {
    const { jobId } = req.params;
    const job = await jobsService.getJobStatus(parseInt(jobId, 10));
    res.json(job);
  } catch (err) {
    next(err);
  }
}

export async function listRunsHandler(req, res, next) {
  try {
    const { page, pageSize } = req.query;
    const result = await matchingService.listReconciliationRuns({
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? Math.min(parseInt(pageSize, 10), 100) : 25,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}
