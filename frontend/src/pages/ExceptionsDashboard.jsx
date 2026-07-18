import React, { useEffect, useState, useCallback } from "react";
import { api } from "../api/client.js";
import { useAuth } from "../api/AuthContext.jsx";
import ResolveExceptionModal from "../components/ResolveExceptionModal.jsx";

const STATUS_COLORS = {
  UNASSIGNED: "bg-red-100 text-red-800 border border-red-200",
  ASSIGNED: "bg-amber-100 text-amber-800 border border-amber-200",
  IN_PROGRESS: "bg-blue-100 text-blue-800 border border-blue-200",
  RESOLVED: "bg-purple-100 text-purple-800 border border-purple-200",
  APPROVED: "bg-teal-100 text-teal-800 border border-teal-200",
  CLOSED: "bg-slate-100 text-slate-800 border border-slate-200",
};

export default function ExceptionsDashboard() {
  const { user } = useAuth();
  const [data, setData] = useState({ data: [], pagination: { page: 1, totalPages: 1, total: 0 } });
  const [filters, setFilters] = useState({ status: "UNASSIGNED", exceptionType: "", search: "" });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  const fetchExceptions = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "20" });
      if (filters.status) params.set("status", filters.status);
      if (filters.exceptionType) params.set("exceptionType", filters.exceptionType);
      if (filters.search) params.set("search", filters.search);
      const result = await api.get(`/exceptions?${params.toString()}`);
      setData(result);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, filters]);

  useEffect(() => {
    fetchExceptions();
  }, [fetchExceptions]);

  async function handleClaim(exceptionId) {
    setErrorMsg(null);
    try {
      await api.patch(`/exceptions/${exceptionId}/assign`, { assignTo: user.userId });
      fetchExceptions();
    } catch (err) {
      setErrorMsg(err.message || "Failed to claim exception.");
    }
  }

  async function handleStartWork(exceptionId) {
    setErrorMsg(null);
    try {
      await api.patch(`/exceptions/${exceptionId}/start-work`);
      fetchExceptions();
    } catch (err) {
      setErrorMsg(err.message || "Failed to start work.");
    }
  }

  async function handleApprove(exceptionId, version) {
    setErrorMsg(null);
    try {
      await api.patch(`/exceptions/${exceptionId}/approve`, { expectedVersion: version });
      fetchExceptions();
    } catch (err) {
      setErrorMsg(err.message || "Failed to approve exception.");
    }
  }

  async function handleClose(exceptionId, version) {
    setErrorMsg(null);
    try {
      await api.patch(`/exceptions/${exceptionId}/close`, { expectedVersion: version });
      fetchExceptions();
    } catch (err) {
      setErrorMsg(err.message || "Failed to close exception.");
    }
  }

  function formatTimeRemaining(seconds) {
    if (seconds == null) return "—";
    if (seconds < 0) return "Breached";
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  const isApproverOrAdmin = user && ["APPROVER", "ADMIN"].includes(user.role);

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-slate-800">Reconciliation Exceptions Queue</h2>
        <p className="text-sm text-slate-500">Investigate, assign, and resolve outstanding transaction discrepancies.</p>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <select
          value={filters.status}
          onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, status: e.target.value })); }}
          className="border border-slate-300 rounded-md px-3 py-2 text-sm bg-white"
        >
          <option value="">All statuses</option>
          <option value="UNASSIGNED">Unassigned</option>
          <option value="ASSIGNED">Assigned</option>
          <option value="IN_PROGRESS">In Progress</option>
          <option value="RESOLVED">Resolved</option>
          <option value="APPROVED">Approved</option>
          <option value="CLOSED">Closed</option>
        </select>

        <select
          value={filters.exceptionType}
          onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, exceptionType: e.target.value })); }}
          className="border border-slate-300 rounded-md px-3 py-2 text-sm bg-white"
        >
          <option value="">All types</option>
          <option value="MISSING_EXTERNAL">Missing external</option>
          <option value="MISSING_INTERNAL">Missing internal</option>
          <option value="AMOUNT_MISMATCH">Amount mismatch</option>
          <option value="DUPLICATE">Duplicate</option>
          <option value="TIMING">Timing</option>
        </select>

        <input
          placeholder="Search reference…"
          value={filters.search}
          onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, search: e.target.value })); }}
          className="border border-slate-300 rounded-md px-3 py-2 text-sm flex-1 bg-white"
        />
      </div>

      {errorMsg && <div className="bg-red-50 text-red-700 text-sm px-4 py-2 rounded-md mb-4">{errorMsg}</div>}

      {/* Table */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-sm">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
            <tr>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Ledger Ref</th>
              <th className="px-4 py-3">External Ref</th>
              <th className="px-4 py-3">Amount Diff</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">SLA Status</th>
              <th className="px-4 py-3">Assigned To</th>
              <th className="px-4 py-3">Created At</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center text-slate-400">Loading exceptions...</td>
              </tr>
            )}
            {!loading && data.data.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center text-slate-400">No exceptions match these filters.</td>
              </tr>
            )}
            {!loading && data.data.map((ex) => (
              <tr key={ex.exception_id} className="hover:bg-slate-50/70 transition">
                <td className="px-4 py-4 font-semibold text-slate-700">{ex.exception_type}</td>
                <td className="px-4 py-4 font-mono text-xs text-slate-600">{ex.ledger_ref || "—"}</td>
                <td className="px-4 py-4 font-mono text-xs text-slate-600">{ex.external_ref || "—"}</td>
                <td className="px-4 py-4 font-medium text-slate-800">{ex.amount_diff != null ? `£${ex.amount_diff}` : "—"}</td>
                <td className="px-4 py-4">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLORS[ex.status]}`}>
                    {ex.status}
                  </span>
                </td>
                <td className="px-4 py-4">
                  {ex.is_sla_breached ? (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-800 border border-red-200 animate-pulse">
                      BREACHED
                    </span>
                  ) : ex.status !== "CLOSED" && ex.status !== "APPROVED" ? (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600 border border-slate-200">
                      {formatTimeRemaining(ex.time_remaining_seconds)}
                    </span>
                  ) : (
                    <span className="text-slate-400 text-xs">—</span>
                  )}
                </td>
                <td className="px-4 py-4 text-slate-600">{ex.assigned_to_name || "Unassigned"}</td>
                <td className="px-4 py-4 text-xs text-slate-500">{new Date(ex.created_at).toLocaleDateString()}</td>
                <td className="px-4 py-4 text-right">
                  <div className="flex gap-2 justify-end">
                    {ex.status === "UNASSIGNED" && (
                      <button
                        onClick={() => handleClaim(ex.exception_id)}
                        className="text-blue-600 hover:text-blue-800 text-xs font-semibold hover:underline"
                      >
                        Claim
                      </button>
                    )}
                    {ex.status === "ASSIGNED" && ex.assigned_to === user?.userId && (
                      <button
                        onClick={() => handleStartWork(ex.exception_id)}
                        className="text-blue-600 hover:text-blue-800 text-xs font-semibold hover:underline"
                      >
                        Start Work
                      </button>
                    )}
                    {ex.status === "IN_PROGRESS" && ex.assigned_to === user?.userId && (
                      <button
                        onClick={() => setSelected(ex)}
                        className="text-amber-600 hover:text-amber-800 text-xs font-semibold hover:underline"
                      >
                        Resolve
                      </button>
                    )}
                    {ex.status === "RESOLVED" && isApproverOrAdmin && (
                      <button
                        onClick={() => handleApprove(ex.exception_id, ex.version)}
                        className="text-green-600 hover:text-green-800 text-xs font-semibold hover:underline"
                      >
                        Approve
                      </button>
                    )}
                    {ex.status === "APPROVED" && isApproverOrAdmin && (
                      <button
                        onClick={() => handleClose(ex.exception_id, ex.version)}
                        className="text-slate-600 hover:text-slate-800 text-xs font-semibold hover:underline"
                      >
                        Close
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex justify-between items-center mt-4 text-sm text-slate-600">
        <span>{data.pagination.total} total exceptions</span>
        <div className="flex gap-2">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="px-3 py-1 border border-slate-300 rounded-md disabled:opacity-40 bg-white hover:bg-slate-50 transition"
          >
            Previous
          </button>
          <span className="px-2 py-1">Page {page} of {data.pagination.totalPages || 1}</span>
          <button
            disabled={page >= data.pagination.totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1 border border-slate-300 rounded-md disabled:opacity-40 bg-white hover:bg-slate-50 transition"
          >
            Next
          </button>
        </div>
      </div>

      {selected && (
        <ResolveExceptionModal
          exception={selected}
          onClose={() => setSelected(null)}
          onResolved={() => { setSelected(null); fetchExceptions(); }}
        />
      )}
    </div>
  );
}
