import * as matchingService from "../services/matchingService.js";

export async function triggerRunHandler(req, res, next) {
  try {
    const { runDate } = req.body;
    const result = await matchingService.runReconciliation({
      runDate: runDate || new Date().toISOString().slice(0, 10),
      triggeredBy: req.user.userId,
    });
    res.status(201).json(result);
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
