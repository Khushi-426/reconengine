import * as operationsService from "../services/operationsService.js";

export async function getOperationsKpisHandler(req, res, next) {
  try {
    const kpis = await operationsService.getOperationsKpis();
    res.json(kpis);
  } catch (err) {
    next(err);
  }
}

export async function getQueueStatusHandler(req, res, next) {
  try {
    const status = await operationsService.getQueueStatus();
    res.json(status);
  } catch (err) {
    next(err);
  }
}

export async function getWorkerStatusHandler(req, res, next) {
  try {
    const worker = await operationsService.getWorkerStatus();
    res.json(worker);
  } catch (err) {
    next(err);
  }
}
