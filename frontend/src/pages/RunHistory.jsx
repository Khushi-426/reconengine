import React, { useEffect, useState, useCallback } from "react";
import { api } from "../api/client.js";
import { useAuth } from "../api/AuthContext.jsx";
import { StatusBadge, Button, Alert, EmptyState, LoadingSpinner } from "../components/common.jsx";
import { formatDateTime, formatDate } from "../utils/formatters.js";

export default function RunHistory() {
  const { user } = useAuth();
  const [data, setData] = useState({ data: [], pagination: { page: 1, totalPages: 1, total: 0 } });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [runDate, setRunDate] = useState(new Date().toISOString().slice(0, 10));
  const [selectedRun, setSelectedRun] = useState(null);

  // Explicit confirmation state before triggering reconciliation run
  const [showConfirmTrigger, setShowConfirmTrigger] = useState(false);

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const result = await api.get(`/recon/runs?page=${page}&pageSize=15`);
      setData(result);
    } catch (err) {
      setErrorMsg(err.message || "Failed to load reconciliation runs.");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  async function executeTriggerRun() {
    setShowConfirmTrigger(false);
    setTriggering(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await api.post("/recon/runs", { runDate });
      const jobId = res.jobId;
      setSuccessMsg(`Reconciliation run queued successfully (Job #${jobId}). Monitoring progress...`);

      let finished = false;
      let checkAttempts = 0;
      while (!finished && checkAttempts < 60) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const job = await api.get(`/recon/jobs/${jobId}`);
        if (job.status === "COMPLETED") {
          finished = true;
          setSuccessMsg(`Reconciliation run #${jobId} completed successfully.`);
          setPage(1);
          fetchRuns();
        } else if (job.status === "FAILED" || job.status === "DEAD_LETTER") {
          finished = true;
          throw new Error(job.error_message || "Reconciliation job failed execution in worker.");
        } else {
          setSuccessMsg(`Reconciliation run #${jobId} is currently ${job.status}...`);
        }
        checkAttempts++;
      }

      if (!finished) {
        setSuccessMsg(`Job #${jobId} is continuing in the background. Refresh table below for final status.`);
      }
    } catch (err) {
      if (err.code === "RECONCILIATION_ALREADY_EXISTS") {
        setErrorMsg(`A reconciliation run already exists or is actively in progress for ${runDate}. Duplicate runs are prevented.`);
      } else if (err.code === "NO_EXTERNAL_SETTLEMENT_BATCH") {
        setErrorMsg("No external settlement batch is available to match against. Please import a settlement statement first.");
      } else {
        setErrorMsg(err.message || "Failed to trigger reconciliation run.");
      }
      setSuccessMsg(null);
    } finally {
      setTriggering(false);
    }
  }

  const isAuthorizedToTrigger = user && ["APPROVER", "ADMIN"].includes(user.role);

  return (
    <div className="space-y-6">
      {/* Page Header and Trigger Action */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
            Reconciliation Workspace
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Audit automated ledger-to-settlement match runs and trigger new batch passes.
          </p>
        </div>

        {isAuthorizedToTrigger ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setShowConfirmTrigger(true);
            }}
            className="flex items-center gap-2 bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-200 dark:border-slate-800 shadow-xs"
          >
            <label htmlFor="recon-date-picker" className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Run Date:
            </label>
            <input
              id="recon-date-picker"
              type="date"
              required
              value={runDate}
              onChange={(e) => setRunDate(e.target.value)}
              className="border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1 text-xs bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-mono"
            />
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={triggering}
              loading={triggering}
            >
              {triggering ? "Processing Match..." : "Trigger Run"}
            </Button>
          </form>
        ) : (
          <div className="text-xs text-slate-500 italic bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded">
            Only Approver & Admin roles can trigger runs.
          </div>
        )}
      </div>

      {/* Status Messages */}
      {successMsg && (
        <Alert variant="success" className="flex justify-between items-center">
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg(null)} className="text-xs font-semibold ml-4 hover:underline">&times;</button>
        </Alert>
      )}

      {errorMsg && (
        <Alert variant="error" className="flex justify-between items-center">
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="text-xs font-semibold ml-4 hover:underline">&times;</button>
        </Alert>
      )}

      {/* Runs Table */}
      <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 dark:bg-slate-950/80 border-b border-slate-200 dark:border-slate-800 text-slate-500 uppercase font-semibold text-[10px] tracking-wider">
              <tr>
                <th className="px-4 py-3 font-mono">Run ID</th>
                <th className="px-4 py-3 font-mono">Run Date</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Internal Rows</th>
                <th className="px-4 py-3 text-right">External Rows</th>
                <th className="px-4 py-3 text-right">Matched Groups</th>
                <th className="px-4 py-3 text-right">Exceptions</th>
                <th className="px-4 py-3">Triggered By</th>
                <th className="px-4 py-3 font-mono">Started At</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading && (
                <tr>
                  <td colSpan={10}>
                    <LoadingSpinner label="Loading reconciliation run history..." />
                  </td>
                </tr>
              )}

              {!loading && data.data.length === 0 && (
                <tr>
                  <td colSpan={10} className="p-6">
                    <EmptyState
                      title="No reconciliation runs recorded"
                      description="Import settlement files and execute a matching pass above to start reconciliation."
                    />
                  </td>
                </tr>
              )}

              {!loading &&
                data.data.map((run) => (
                  <tr
                    key={run.run_id}
                    className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition cursor-pointer"
                    onClick={() => setSelectedRun(run)}
                  >
                    <td className="px-4 py-3 font-mono font-medium text-slate-600 dark:text-slate-400">
                      #{run.run_id}
                    </td>
                    <td className="px-4 py-3 font-mono font-bold text-slate-900 dark:text-white">
                      {formatDate(run.run_date)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusBadge status={run.status} />
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-700 dark:text-slate-300">
                      {run.total_internal?.toLocaleString() || 0}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-700 dark:text-slate-300">
                      {run.total_external?.toLocaleString() || 0}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                      {run.matched_count?.toLocaleString() || 0}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-amber-600 dark:text-amber-400">
                      {run.exception_count?.toLocaleString() || 0}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {run.triggered_by_name || "Automated Schedule"}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-500 whitespace-nowrap">
                      {formatDateTime(run.started_at)}
                    </td>
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <Button size="sm" variant="secondary" onClick={() => setSelectedRun(run)}>
                        Breakdown
                      </Button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        <div className="bg-slate-50 dark:bg-slate-950 px-4 py-3 border-t border-slate-200 dark:border-slate-800 flex justify-between items-center text-xs text-slate-600 dark:text-slate-400">
          <span>
            Total <strong className="font-mono">{data.pagination.total}</strong> reconciliation runs
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <span className="font-mono px-2">
              Page {page} of {data.pagination.totalPages || 1}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= data.pagination.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </div>

      {/* Run Detail Modal */}
      {selectedRun && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow-xl border border-slate-200 dark:border-slate-800 p-6 w-full max-w-lg">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Reconciliation Run #{selectedRun.run_id} Breakdown
                </h3>
                <p className="text-xs text-slate-500 font-mono mt-0.5">
                  Run Date: {formatDate(selectedRun.run_date)} | Source Batch: #{selectedRun.source_batch_id}
                </p>
              </div>
              <button
                onClick={() => setSelectedRun(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-lg leading-none p-1"
              >
                &times;
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 dark:bg-slate-950 rounded border border-slate-200 dark:border-slate-800 font-mono">
                <div>
                  <span className="text-slate-500 block">Status:</span>
                  <StatusBadge status={selectedRun.status} />
                </div>
                <div>
                  <span className="text-slate-500 block">Completed At:</span>
                  <span className="text-slate-800 dark:text-slate-200">
                    {formatDateTime(selectedRun.completed_at) || "In Progress"}
                  </span>
                </div>
              </div>

              <div className="border border-slate-200 dark:border-slate-800 rounded-md overflow-hidden">
                <div className="px-3.5 py-2 bg-slate-50 dark:bg-slate-950 font-semibold text-slate-700 dark:text-slate-300">
                  Execution Volume Metrics
                </div>
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  <div className="px-3.5 py-2 flex justify-between">
                    <span className="text-slate-600 dark:text-slate-400">Total Internal Ledger Rows:</span>
                    <span className="font-mono font-bold">{selectedRun.total_internal}</span>
                  </div>
                  <div className="px-3.5 py-2 flex justify-between">
                    <span className="text-slate-600 dark:text-slate-400">Total External Statement Lines:</span>
                    <span className="font-mono font-bold">{selectedRun.total_external}</span>
                  </div>
                  <div className="px-3.5 py-2 flex justify-between text-emerald-700 dark:text-emerald-400">
                    <span>Matched Groups Formed:</span>
                    <span className="font-mono font-bold">{selectedRun.matched_count}</span>
                  </div>
                  <div className="px-3.5 py-2 flex justify-between text-amber-700 dark:text-amber-400">
                    <span>Break Exceptions Generated:</span>
                    <span className="font-mono font-bold">{selectedRun.exception_count}</span>
                  </div>
                </div>
              </div>

              <div className="p-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 text-blue-900 dark:text-blue-300 rounded text-[11px]">
                <strong>Multi-Pass Engine Integrity:</strong> Exact match pass, tolerance pass, and greedy batch pass executed inside an atomic transaction. All unmatched rows were routed directly to the Exceptions Queue.
              </div>
            </div>

            <div className="flex justify-end mt-5 pt-3 border-t border-slate-100 dark:border-slate-800">
              <Button size="md" variant="secondary" onClick={() => setSelectedRun(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Explicit Trigger Confirmation Dialog */}
      {showConfirmTrigger && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow-xl border border-slate-200 dark:border-slate-800 p-5 w-full max-w-sm">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-2">
              Confirm Reconciliation Execution
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-300 mb-4">
              Trigger automated reconciliation matching for value date{" "}
              <strong className="font-mono text-slate-900 dark:text-white">{runDate}</strong>?
            </p>
            <p className="text-[11px] text-slate-500 mb-5">
              This initiates an asynchronous matching background job. Any duplicate runs for this date and batch will be strictly rejected.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setShowConfirmTrigger(false)}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={executeTriggerRun}>
                Confirm & Run
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
