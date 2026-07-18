import React, { useEffect, useState, useCallback } from "react";
import { api } from "../api/client.js";

const STATUS_COLORS = {
  COMPLETED: "bg-green-100 text-green-800",
  PROCESSING: "bg-blue-100 text-blue-800",
  FAILED: "bg-red-100 text-red-800",
  PENDING: "bg-amber-100 text-amber-800",
};

export default function ImportHistory() {
  const [data, setData] = useState({ data: [], pagination: { page: 1, totalPages: 1, total: 0 } });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [selectedError, setSelectedError] = useState(null);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const result = await api.get(`/imports/batches?page=${page}&pageSize=15`);
      setData(result);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Import History</h2>
          <p className="text-sm text-slate-500">Track and inspect all statement feed ingestion batches.</p>
        </div>
      </div>

      {errorMsg && (
        <div className="bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-3 rounded-md mb-6">
          {errorMsg}
        </div>
      )}

      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-sm">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
            <tr>
              <th className="px-6 py-3">Batch ID</th>
              <th className="px-6 py-3">File Name</th>
              <th className="px-6 py-3">Source</th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3">Row Count</th>
              <th className="px-6 py-3">Uploaded By</th>
              <th className="px-6 py-3">Uploaded At</th>
              <th className="px-6 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {loading && (
              <tr>
                <td colSpan={8} className="px-6 py-8 text-center text-slate-400">
                  Loading history...
                </td>
              </tr>
            )}
            {!loading && data.data.length === 0 && (
              <tr>
                <td colSpan={8} className="px-6 py-8 text-center text-slate-400">
                  No import batches found.
                </td>
              </tr>
            )}
            {!loading &&
              data.data.map((batch) => (
                <tr key={batch.batch_id} className="hover:bg-slate-50/70 transition">
                  <td className="px-6 py-4 font-mono text-xs text-slate-600">#{batch.batch_id}</td>
                  <td className="px-6 py-4 font-medium text-slate-800">{batch.file_name}</td>
                  <td className="px-6 py-4 text-slate-600">{batch.source_name}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[batch.status] || "bg-slate-100 text-slate-800"}`}>
                      {batch.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-slate-700">{batch.row_count}</td>
                  <td className="px-6 py-4 text-slate-600">{batch.uploaded_by_name || "System"}</td>
                  <td className="px-6 py-4 text-slate-500 text-xs">
                    {new Date(batch.created_at).toLocaleString()}
                  </td>
                  <td className="px-6 py-4 text-right">
                    {batch.status === "FAILED" && batch.error_message && (
                      <button
                        onClick={() => setSelectedError(batch.error_message)}
                        className="text-red-600 hover:text-red-800 font-medium text-xs underline"
                      >
                        View Errors
                      </button>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>

        {/* Pagination */}
        <div className="bg-slate-50 px-6 py-4 border-t border-slate-200 flex justify-between items-center text-sm text-slate-600">
          <span>{data.pagination.total} batches uploaded</span>
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

      {/* Errors Modal */}
      {selectedError && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-xl">
            <h3 className="text-lg font-semibold text-slate-800 mb-2">Ingestion Failure Details</h3>
            <p className="text-sm text-slate-500 mb-4">The following error occurred during statement file ingestion:</p>
            <div className="bg-slate-50 border border-slate-200 rounded p-4 max-h-80 overflow-y-auto font-mono text-xs text-red-700 whitespace-pre-wrap">
              {selectedError}
            </div>
            <div className="flex justify-end mt-4">
              <button
                onClick={() => setSelectedError(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white text-sm font-medium rounded-md transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
