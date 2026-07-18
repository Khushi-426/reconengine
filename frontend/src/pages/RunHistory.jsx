import React, { useEffect, useState, useCallback } from "react";
import { api } from "../api/client.js";
import { useAuth } from "../api/AuthContext.jsx";

const STATUS_COLORS = {
  COMPLETED: "bg-green-100 text-green-800",
  RUNNING: "bg-blue-100 text-blue-800",
  FAILED: "bg-red-100 text-red-800",
};

export default function RunHistory() {
  const { user } = useAuth();
  const [data, setData] = useState({ data: [], pagination: { page: 1, totalPages: 1, total: 0 } });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [runDate, setRunDate] = useState(new Date().toISOString().slice(0, 10));

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const result = await api.get(`/recon/runs?page=${page}&pageSize=15`);
      setData(result);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  async function handleTriggerRun(e) {
    e.preventDefault();
    setTriggering(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await api.post("/recon/runs", { runDate });
      setSuccessMsg(`Reconciliation run successfully completed! Run ID: #${res.runId}. Matched: ${res.stats.matchedCount}, Exceptions: ${res.stats.exceptionCount}`);
      setPage(1);
      fetchRuns();
    } catch (err) {
      setErrorMsg(err.message || "Failed to trigger reconciliation run.");
    } finally {
      setTriggering(false);
    }
  }

  const isAuthorizedToTrigger = user && ["APPROVER", "ADMIN"].includes(user.role);

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4 mb-6">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Reconciliation Run History</h2>
          <p className="text-sm text-slate-500">View performance metrics and trigger matching runs.</p>
        </div>

        {isAuthorizedToTrigger && (
          <form onSubmit={handleTriggerRun} className="flex gap-2 items-center bg-white p-2 border border-slate-200 rounded-lg shadow-sm">
            <div>
              <input
                type="date"
                required
                value={runDate}
                onChange={(e) => setRunDate(e.target.value)}
                className="border border-slate-300 rounded px-2 py-1 text-sm bg-white focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={triggering}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded px-3 py-1.5 text-sm transition"
            >
              {triggering ? "Running Match..." : "Trigger Run"}
            </button>
          </form>
        )}
      </div>

      {successMsg && (
        <div className="bg-green-50 border border-green-200 text-green-800 text-sm px-4 py-3 rounded-md mb-6">
          {successMsg}
        </div>
      )}

      {errorMsg && (
        <div className="bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-3 rounded-md mb-6">
          {errorMsg}
        </div>
      )}

      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-sm">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
            <tr>
              <th className="px-6 py-3">Run ID</th>
              <th className="px-6 py-3">Run Date</th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3">Internal Rows</th>
              <th className="px-6 py-3">External Rows</th>
              <th className="px-6 py-3">Matched</th>
              <th className="px-6 py-3">Exceptions</th>
              <th className="px-6 py-3">Triggered By</th>
              <th className="px-6 py-3">Started At</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {loading && (
              <tr>
                <td colSpan={9} className="px-6 py-8 text-center text-slate-400">
                  Loading runs...
                </td>
              </tr>
            )}
            {!loading && data.data.length === 0 && (
              <tr>
                <td colSpan={9} className="px-6 py-8 text-center text-slate-400">
                  No reconciliation runs found.
                </td>
              </tr>
            )}
            {!loading &&
              data.data.map((run) => (
                <tr key={run.run_id} className="hover:bg-slate-50/70 transition">
                  <td className="px-6 py-4 font-mono text-xs text-slate-600">#{run.run_id}</td>
                  <td className="px-6 py-4 font-medium text-slate-800">{run.run_date}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[run.status] || "bg-slate-100 text-slate-800"}`}>
                      {run.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-slate-700">{run.total_internal}</td>
                  <td className="px-6 py-4 text-slate-700">{run.total_external}</td>
                  <td className="px-6 py-4 text-green-700 font-medium">{run.matched_count}</td>
                  <td className="px-6 py-4 text-amber-700 font-medium">{run.exception_count}</td>
                  <td className="px-6 py-4 text-slate-600">{run.triggered_by_name || "System"}</td>
                  <td className="px-6 py-4 text-slate-500 text-xs">
                    {new Date(run.started_at).toLocaleString()}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>

        {/* Pagination */}
        <div className="bg-slate-50 px-6 py-4 border-t border-slate-200 flex justify-between items-center text-sm text-slate-600">
          <span>{data.pagination.total} reconciliation runs</span>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="px-3 py-1.5 border border-slate-300 rounded-md disabled:opacity-40 bg-white hover:bg-slate-50 transition"
            >
              Previous
            </button>
            <span className="px-2 py-1.5 font-medium text-slate-800">
              Page {page} of {data.pagination.totalPages || 1}
            </span>
            <button
              disabled={page >= data.pagination.totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1.5 border border-slate-300 rounded-md disabled:opacity-40 bg-white hover:bg-slate-50 transition"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
