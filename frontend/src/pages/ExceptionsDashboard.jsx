import React, { useEffect, useState, useCallback } from "react";
import { api } from "../api/client.js";
import { useAuth } from "../api/AuthContext.jsx";
import ResolveExceptionModal from "../components/ResolveExceptionModal.jsx";

const STATUS_COLORS = {
  OPEN: "bg-amber-100 text-amber-800",
  IN_REVIEW: "bg-blue-100 text-blue-800",
  RESOLVED: "bg-green-100 text-green-800",
  WRITTEN_OFF: "bg-slate-200 text-slate-700",
};

export default function ExceptionsDashboard() {
  const { user, logout } = useAuth();
  const [data, setData] = useState({ data: [], pagination: { page: 1, totalPages: 1, total: 0 } });
  const [filters, setFilters] = useState({ status: "OPEN", exceptionType: "", search: "" });
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
            <option value="OPEN">Open</option>
            <option value="IN_REVIEW">In review</option>
            <option value="RESOLVED">Resolved</option>
            <option value="WRITTEN_OFF">Written off</option>
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
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-slate-600 text-left">
              <tr>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2">Ledger ref</th>
                <th className="px-4 py-2">External ref</th>
                <th className="px-4 py-2">Amount diff</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Assigned to</th>
                <th className="px-4 py-2">Created</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={8} className="px-4 py-6 text-center text-slate-400">Loading…</td></tr>
              )}
              {!loading && data.data.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-6 text-center text-slate-400">No exceptions match these filters.</td></tr>
              )}
              {data.data.map((ex) => (
                <tr key={ex.exception_id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2">{ex.exception_type}</td>
                  <td className="px-4 py-2 font-mono text-xs">{ex.ledger_ref || "—"}</td>
                  <td className="px-4 py-2 font-mono text-xs">{ex.external_ref || "—"}</td>
                  <td className="px-4 py-2">{ex.amount_diff != null ? `£${ex.amount_diff}` : "—"}</td>
                  <td className="px-4 py-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[ex.status]}`}>
                      {ex.status}
                    </span>
                  </td>
                  <td className="px-4 py-2">{ex.assigned_to_name || "Unassigned"}</td>
                  <td className="px-4 py-2 text-xs text-slate-500">{new Date(ex.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-2">
                    {(ex.status === "OPEN" || ex.status === "IN_REVIEW") && (
                      <button
                        onClick={() => setSelected(ex)}
                        className="text-blue-600 hover:underline text-xs font-medium"
                      >
                        Resolve
                      </button>
                    )}
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
              className="px-3 py-1 border border-slate-300 rounded-md disabled:opacity-40 bg-white"
            >
              Previous
            </button>
            <span className="px-2 py-1">Page {page} of {data.pagination.totalPages || 1}</span>
            <button
              disabled={page >= data.pagination.totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1 border border-slate-300 rounded-md disabled:opacity-40 bg-white"
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
