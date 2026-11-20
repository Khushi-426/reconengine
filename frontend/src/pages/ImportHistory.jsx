import React, { useEffect, useState, useCallback } from "react";
import { api } from "../api/client.js";
import { StatusBadge, Button, Alert, EmptyState, LoadingSpinner } from "../components/common.jsx";
import { formatDateTime } from "../utils/formatters.js";

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
      setErrorMsg(err.message || "Failed to load import batch history.");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
            Import Batches & Feeds
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Audit history of ingested statement files, hash deduplication, and row counts.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={fetchHistory} loading={loading}>
          Refresh Batches
        </Button>
      </div>

      {errorMsg && (
        <Alert variant="error" className="flex justify-between items-center">
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="text-xs font-semibold ml-4 hover:underline">&times;</button>
        </Alert>
      )}

      <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 dark:bg-slate-950/80 border-b border-slate-200 dark:border-slate-800 text-slate-500 uppercase font-semibold text-[10px] tracking-wider">
              <tr>
                <th className="px-4 py-3 font-mono">Batch ID</th>
                <th className="px-4 py-3 font-mono">File Name</th>
                <th className="px-4 py-3">Source Channel</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Rows</th>
                <th className="px-4 py-3">Uploaded By</th>
                <th className="px-4 py-3 font-mono">Uploaded At</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading && (
                <tr>
                  <td colSpan={8}>
                    <LoadingSpinner label="Loading ingestion batch history..." />
                  </td>
                </tr>
              )}

              {!loading && data.data.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-6">
                    <EmptyState
                      title="No import batches found"
                      description="No statement files or ledger batches have been ingested into the system yet."
                    />
                  </td>
                </tr>
              )}

              {!loading &&
                data.data.map((batch) => (
                  <tr key={batch.batch_id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition">
                    <td className="px-4 py-3 font-mono font-medium text-slate-500">
                      #{batch.batch_id}
                    </td>
                    <td className="px-4 py-3 font-mono font-semibold text-slate-900 dark:text-white">
                      {batch.file_name}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {batch.source_name}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusBadge status={batch.status} />
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-slate-800 dark:text-slate-200">
                      {batch.row_count?.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                      {batch.uploaded_by_name || "System automated"}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-500 whitespace-nowrap">
                      {formatDateTime(batch.created_at)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {batch.status === "FAILED" && batch.error_message ? (
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => setSelectedError(batch.error_message)}
                        >
                          View Errors
                        </Button>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        <div className="bg-slate-50 dark:bg-slate-950 px-4 py-3 border-t border-slate-200 dark:border-slate-800 flex justify-between items-center text-xs text-slate-600 dark:text-slate-400">
          <span>
            Total <strong className="font-mono">{data.pagination.total}</strong> ingested batches
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

      {/* Errors Modal */}
      {selectedError && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow-xl border border-slate-200 dark:border-slate-800 p-6 w-full max-w-xl">
            <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1">
              Ingestion Failure Breakdown
            </h3>
            <p className="text-xs text-slate-500 mb-4">The following error was recorded by the ingestion pipeline:</p>
            <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-3 max-h-80 overflow-y-auto font-mono text-xs text-rose-600 dark:text-rose-400 whitespace-pre-wrap">
              {selectedError}
            </div>
            <div className="flex justify-end mt-4">
              <Button size="md" variant="secondary" onClick={() => setSelectedError(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
