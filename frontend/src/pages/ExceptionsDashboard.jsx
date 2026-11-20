import React, { useEffect, useState, useCallback } from "react";
import { api } from "../api/client.js";
import { useAuth } from "../api/AuthContext.jsx";
import ResolveExceptionModal from "../components/ResolveExceptionModal.jsx";
import ExceptionDetailDrawer from "../components/ExceptionDetailDrawer.jsx";
import { StatusBadge, Button, Alert, EmptyState, LoadingSpinner } from "../components/common.jsx";
import { formatMoney, formatDateTime, formatSlaCountdown } from "../utils/formatters.js";

export default function ExceptionsDashboard() {
  const { user } = useAuth();
  const [data, setData] = useState({ data: [], pagination: { page: 1, totalPages: 1, total: 0 } });
  const [filters, setFilters] = useState({ status: "UNASSIGNED", exceptionType: "", search: "" });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selectedForResolve, setSelectedForResolve] = useState(null);
  const [drawerException, setDrawerException] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [actionLoadingId, setActionLoadingId] = useState(null);

  // Confirmation state for approve/close/claim
  const [confirmModal, setConfirmModal] = useState(null);

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
      setErrorMsg(err.message || "Failed to load exceptions queue.");
    } finally {
      setLoading(false);
    }
  }, [page, filters]);

  useEffect(() => {
    fetchExceptions();
  }, [fetchExceptions]);

  async function handleClaim(exceptionId) {
    setActionLoadingId(exceptionId);
    setErrorMsg(null);
    try {
      await api.patch(`/exceptions/${exceptionId}/assign`, { assignTo: user.userId });
      setSuccessMsg(`Exception #${exceptionId} claimed successfully.`);
      fetchExceptions();
      if (drawerException?.exception_id === exceptionId) setDrawerException(null);
    } catch (err) {
      setErrorMsg(err.message || "Failed to claim exception.");
    } finally {
      setActionLoadingId(null);
      setConfirmModal(null);
    }
  }

  async function handleStartWork(exceptionId) {
    setActionLoadingId(exceptionId);
    setErrorMsg(null);
    try {
      await api.patch(`/exceptions/${exceptionId}/start-work`);
      setSuccessMsg(`Investigation started for Exception #${exceptionId}.`);
      fetchExceptions();
      if (drawerException?.exception_id === exceptionId) setDrawerException(null);
    } catch (err) {
      setErrorMsg(err.message || "Failed to start work on exception.");
    } finally {
      setActionLoadingId(null);
    }
  }

  async function handleApprove(exceptionId, version) {
    setActionLoadingId(exceptionId);
    setErrorMsg(null);
    try {
      await api.patch(`/exceptions/${exceptionId}/approve`, { expectedVersion: version });
      setSuccessMsg(`Exception #${exceptionId} approved successfully.`);
      fetchExceptions();
      if (drawerException?.exception_id === exceptionId) setDrawerException(null);
    } catch (err) {
      if (err.code === "OPTIMISTIC_LOCK_CONFLICT") {
        setErrorMsg("Concurrent modification: Exception was modified by another user. Reloading latest queue data.");
        fetchExceptions();
      } else {
        setErrorMsg(err.message || "Failed to approve exception.");
      }
    } finally {
      setActionLoadingId(null);
      setConfirmModal(null);
    }
  }

  async function handleClose(exceptionId, version) {
    setActionLoadingId(exceptionId);
    setErrorMsg(null);
    try {
      await api.patch(`/exceptions/${exceptionId}/close`, { expectedVersion: version });
      setSuccessMsg(`Exception #${exceptionId} closed.`);
      fetchExceptions();
      if (drawerException?.exception_id === exceptionId) setDrawerException(null);
    } catch (err) {
      if (err.code === "OPTIMISTIC_LOCK_CONFLICT") {
        setErrorMsg("Concurrent modification: Exception was modified by another user. Reloading latest queue data.");
        fetchExceptions();
      } else {
        setErrorMsg(err.message || "Failed to close exception.");
      }
    } finally {
      setActionLoadingId(null);
      setConfirmModal(null);
    }
  }

  function handleDrawerAction(actionType, exception) {
    if (actionType === "claim") {
      setConfirmModal({
        title: `Claim Exception #${exception.exception_id}`,
        message: "Assign this discrepancy break to yourself for investigation?",
        confirmLabel: "Claim",
        onConfirm: () => handleClaim(exception.exception_id),
      });
    } else if (actionType === "start-work") {
      handleStartWork(exception.exception_id);
    } else if (actionType === "resolve") {
      setSelectedForResolve(exception);
    } else if (actionType === "approve") {
      setConfirmModal({
        title: `Approve Resolution #${exception.exception_id}`,
        message: "Confirm formal operational approval for this resolution note?",
        confirmLabel: "Approve Resolution",
        variant: "success",
        onConfirm: () => handleApprove(exception.exception_id, exception.version),
      });
    } else if (actionType === "close") {
      setConfirmModal({
        title: `Close Exception #${exception.exception_id}`,
        message: "Permanently close this approved break?",
        confirmLabel: "Close Exception",
        variant: "primary",
        onConfirm: () => handleClose(exception.exception_id, exception.version),
      });
    }
  }

  const isApproverOrAdmin = user && ["APPROVER", "ADMIN"].includes(user.role);

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
            Exceptions Management Queue
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Audit, assign, investigate, and approve unmatched transaction breaks.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={fetchExceptions} loading={loading}>
            Refresh Queue
          </Button>
        </div>
      </div>

      {/* Messages */}
      {errorMsg && (
        <Alert variant="error" className="flex justify-between items-center">
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="text-xs font-semibold ml-4 hover:underline">&times;</button>
        </Alert>
      )}
      {successMsg && (
        <Alert variant="success" className="flex justify-between items-center">
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg(null)} className="text-xs font-semibold ml-4 hover:underline">&times;</button>
        </Alert>
      )}

      {/* Search & Filter Toolbar */}
      <div className="bg-white dark:bg-slate-900 p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 flex flex-wrap gap-3 items-center">
        <div className="flex-1 min-w-[200px]">
          <input
            id="exceptions-search"
            placeholder="Search by ledger or external reference..."
            value={filters.search}
            onChange={(e) => {
              setPage(1);
              setFilters((f) => ({ ...f, search: e.target.value }));
            }}
            className="w-full border border-slate-300 dark:border-slate-700 rounded px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-slate-900 dark:focus:ring-slate-400 font-mono"
          />
        </div>

        <div className="flex gap-2">
          <select
            aria-label="Filter by exception status"
            value={filters.status}
            onChange={(e) => {
              setPage(1);
              setFilters((f) => ({ ...f, status: e.target.value }));
            }}
            className="border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200"
          >
            <option value="">All Statuses</option>
            <option value="UNASSIGNED">Unassigned</option>
            <option value="ASSIGNED">Assigned</option>
            <option value="IN_PROGRESS">In Progress</option>
            <option value="RESOLVED">Resolved</option>
            <option value="APPROVED">Approved</option>
            <option value="CLOSED">Closed</option>
          </select>

          <select
            aria-label="Filter by exception break type"
            value={filters.exceptionType}
            onChange={(e) => {
              setPage(1);
              setFilters((f) => ({ ...f, exceptionType: e.target.value }));
            }}
            className="border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200"
          >
            <option value="">All Break Types</option>
            <option value="MISSING_EXTERNAL">Missing External</option>
            <option value="MISSING_INTERNAL">Missing Internal</option>
            <option value="AMOUNT_MISMATCH">Amount Mismatch</option>
            <option value="DUPLICATE">Duplicate</option>
            <option value="TIMING">Timing</option>
          </select>
        </div>
      </div>

      {/* Exceptions Grid / Table */}
      <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 dark:bg-slate-950/80 border-b border-slate-200 dark:border-slate-800 text-slate-500 uppercase font-semibold text-[10px] tracking-wider">
              <tr>
                <th className="px-3.5 py-3 font-mono">ID</th>
                <th className="px-3.5 py-3">Break Type</th>
                <th className="px-3.5 py-3 font-mono">Ledger Ref</th>
                <th className="px-3.5 py-3 font-mono">External Ref</th>
                <th className="px-3.5 py-3 text-right">Variance</th>
                <th className="px-3.5 py-3">Status</th>
                <th className="px-3.5 py-3">SLA Window</th>
                <th className="px-3.5 py-3">Assignee</th>
                <th className="px-3.5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading && (
                <tr>
                  <td colSpan={9}>
                    <LoadingSpinner label="Fetching exceptions queue..." />
                  </td>
                </tr>
              )}

              {!loading && data.data.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-6">
                    <EmptyState
                      title="No exceptions found"
                      description="No records match your active status and type filters."
                      action={
                        <Button size="sm" variant="secondary" onClick={() => setFilters({ status: "", exceptionType: "", search: "" })}>
                          Clear Filters
                        </Button>
                      }
                    />
                  </td>
                </tr>
              )}

              {!loading &&
                data.data.map((ex) => {
                  const isAssignedToUser = ex.assigned_to === user?.userId;
                  const isActionLoading = actionLoadingId === ex.exception_id;

                  return (
                    <tr
                      key={ex.exception_id}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition cursor-pointer"
                      onClick={() => setDrawerException(ex)}
                    >
                      <td className="px-3.5 py-3 font-mono font-medium text-slate-500">
                        #{ex.exception_id}
                      </td>
                      <td className="px-3.5 py-3 font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                        {ex.exception_type}
                      </td>
                      <td className="px-3.5 py-3 font-mono text-slate-600 dark:text-slate-400">
                        {ex.ledger_ref || "—"}
                      </td>
                      <td className="px-3.5 py-3 font-mono text-slate-600 dark:text-slate-400">
                        {ex.external_ref || "—"}
                      </td>
                      <td className="px-3.5 py-3 text-right font-mono font-bold text-slate-900 dark:text-white">
                        {ex.amount_diff != null ? formatMoney(ex.amount_diff) : "—"}
                      </td>
                      <td className="px-3.5 py-3 whitespace-nowrap">
                        <StatusBadge status={ex.status} />
                      </td>
                      <td className="px-3.5 py-3 whitespace-nowrap">
                        {ex.is_sla_breached ? (
                          <StatusBadge status="BREACHED" label="BREACHED" />
                        ) : ex.status !== "CLOSED" && ex.status !== "APPROVED" ? (
                          <span className="font-mono text-slate-600 dark:text-slate-400 text-[11px]">
                            {formatSlaCountdown(ex.time_remaining_seconds)}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3.5 py-3 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {ex.assigned_to_name || <span className="text-slate-400 italic">Unassigned</span>}
                      </td>
                      <td
                        className="px-3.5 py-3 text-right whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()} // don't open drawer on direct action click
                      >
                        <div className="flex gap-1.5 justify-end">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setDrawerException(ex)}
                          >
                            Details
                          </Button>

                          {ex.status === "UNASSIGNED" && (
                            <Button
                              variant="primary"
                              size="sm"
                              loading={isActionLoading}
                              onClick={() =>
                                setConfirmModal({
                                  title: `Claim Exception #${ex.exception_id}`,
                                  message: "Assign this discrepancy break to yourself?",
                                  confirmLabel: "Claim",
                                  onConfirm: () => handleClaim(ex.exception_id),
                                })
                              }
                            >
                              Claim
                            </Button>
                          )}

                          {ex.status === "ASSIGNED" && isAssignedToUser && (
                            <Button
                              variant="primary"
                              size="sm"
                              loading={isActionLoading}
                              onClick={() => handleStartWork(ex.exception_id)}
                            >
                              Start
                            </Button>
                          )}

                          {ex.status === "IN_PROGRESS" && isAssignedToUser && (
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() => setSelectedForResolve(ex)}
                            >
                              Resolve
                            </Button>
                          )}

                          {ex.status === "RESOLVED" && isApproverOrAdmin && (
                            <Button
                              variant="success"
                              size="sm"
                              loading={isActionLoading}
                              onClick={() =>
                                setConfirmModal({
                                  title: `Approve Resolution #${ex.exception_id}`,
                                  message: "Approve this resolution note and forward for close?",
                                  confirmLabel: "Approve",
                                  variant: "success",
                                  onConfirm: () => handleApprove(ex.exception_id, ex.version),
                                })
                              }
                            >
                              Approve
                            </Button>
                          )}

                          {ex.status === "APPROVED" && isApproverOrAdmin && (
                            <Button
                              variant="secondary"
                              size="sm"
                              loading={isActionLoading}
                              onClick={() =>
                                setConfirmModal({
                                  title: `Close Exception #${ex.exception_id}`,
                                  message: "Confirm final closure of this resolved break?",
                                  confirmLabel: "Close",
                                  onConfirm: () => handleClose(ex.exception_id, ex.version),
                                })
                              }
                            >
                              Close
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {/* Keyset / Page Navigation Bar */}
        <div className="bg-slate-50 dark:bg-slate-950 px-4 py-3 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row justify-between items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
          <div>
            Showing {data.data.length} of <span className="font-semibold font-mono">{data.pagination.total}</span> exceptions
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <span className="px-2 font-mono">
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

      {/* Resolve Dialog Modal */}
      {selectedForResolve && (
        <ResolveExceptionModal
          exception={selectedForResolve}
          onClose={() => setSelectedForResolve(null)}
          onResolved={() => {
            setSelectedForResolve(null);
            fetchExceptions();
          }}
        />
      )}

      {/* Evidence and Audit Timeline Drawer */}
      {drawerException && (
        <ExceptionDetailDrawer
          exception={drawerException}
          onClose={() => setDrawerException(null)}
          onAction={handleDrawerAction}
          userRole={user?.role}
          currentUserId={user?.userId}
        />
      )}

      {/* Confirmation Modal */}
      {confirmModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow-xl border border-slate-200 dark:border-slate-800 p-5 w-full max-w-sm">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-2">
              {confirmModal.title}
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-300 mb-5">
              {confirmModal.message}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setConfirmModal(null)}>
                Cancel
              </Button>
              <Button
                variant={confirmModal.variant || "primary"}
                size="sm"
                onClick={confirmModal.onConfirm}
              >
                {confirmModal.confirmLabel || "Confirm"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
