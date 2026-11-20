import React from "react";
import { StatusBadge, Button } from "./common.jsx";
import { formatMoney, formatDateTime, formatDate, formatSlaCountdown } from "../utils/formatters.js";
import InvestigationPanel from "./InvestigationPanel.jsx";

export default function ExceptionDetailDrawer({ exception, onClose, onAction, userRole, currentUserId }) {
  if (!exception) return null;

  const isAssignedToUser = exception.assigned_to === currentUserId;
  const isApproverOrAdmin = ["APPROVER", "ADMIN"].includes(userRole);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/40 backdrop-blur-xs transition-opacity">
      <div className="w-full max-w-xl bg-white dark:bg-slate-900 h-full shadow-2xl border-l border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex justify-between items-start bg-slate-50 dark:bg-slate-950">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-mono font-bold text-slate-500">#{exception.exception_id}</span>
              <StatusBadge status={exception.status} />
              {exception.is_sla_breached && (
                <StatusBadge status="BREACHED" label="SLA BREACHED" />
              )}
            </div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">
              {exception.exception_type?.replace(/_/g, " ")}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded hover:bg-slate-200/50 dark:hover:bg-slate-800 transition text-lg leading-none"
            aria-label="Close details drawer"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6 text-sm">
          {/* Financial Discrepancy Summary */}
          <section className="bg-slate-50 dark:bg-slate-950/60 p-4 rounded-lg border border-slate-200 dark:border-slate-800">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">
              Financial Breakdown
            </h4>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="p-2 bg-white dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-800">
                <span className="text-[11px] text-slate-500 block">Ledger Amount</span>
                <span className="font-mono font-semibold text-slate-800 dark:text-slate-100">
                  {formatMoney(exception.ledger_amount)}
                </span>
              </div>
              <div className="p-2 bg-white dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-800">
                <span className="text-[11px] text-slate-500 block">External Amount</span>
                <span className="font-mono font-semibold text-slate-800 dark:text-slate-100">
                  {formatMoney(exception.external_amount)}
                </span>
              </div>
              <div className="p-2 bg-white dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-800">
                <span className="text-[11px] text-slate-500 block">Discrepancy (Delta)</span>
                <span className="font-mono font-bold text-rose-600 dark:text-rose-400">
                  {exception.amount_diff != null ? formatMoney(exception.amount_diff) : "—"}
                </span>
              </div>
            </div>
          </section>

          {/* Evidence Details */}
          <section className="space-y-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Audit Evidence Details
            </h4>

            {/* Internal Ledger Row */}
            <div className="p-3.5 border border-slate-200 dark:border-slate-800 rounded-md">
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100 dark:border-slate-800">
                <span className="font-semibold text-xs text-slate-700 dark:text-slate-300">Internal Ledger Transaction</span>
                <span className="text-[11px] font-mono text-slate-500">Value Date: {formatDate(exception.ledger_value_date)}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-slate-500 block">Transaction Reference:</span>
                  <span className="font-mono font-medium">{exception.ledger_ref || "None / Unmatched"}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Recon Run ID:</span>
                  <span className="font-mono font-medium">#{exception.run_id}</span>
                </div>
              </div>
            </div>

            {/* External Settlement Line */}
            <div className="p-3.5 border border-slate-200 dark:border-slate-800 rounded-md">
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100 dark:border-slate-800">
                <span className="font-semibold text-xs text-slate-700 dark:text-slate-300">External Settlement Line</span>
                <span className="text-[11px] font-mono text-slate-500">Value Date: {formatDate(exception.external_value_date)}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-slate-500 block">External Statement Ref:</span>
                  <span className="font-mono font-medium">{exception.external_ref || "None / Unmatched"}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Record Version:</span>
                  <span className="font-mono font-medium">v{exception.version}</span>
                </div>
              </div>
            </div>
          </section>

          {/* SLA Tracking */}
          <section className="p-3.5 bg-slate-50 dark:bg-slate-950/60 rounded-md border border-slate-200 dark:border-slate-800">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
              SLA Compliance Status
            </h4>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-slate-500 block">SLA Deadline:</span>
                <span className="font-mono font-medium">{formatDateTime(exception.sla_deadline)}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Time Remaining:</span>
                <span className={`font-mono font-semibold ${exception.is_sla_breached ? "text-rose-600" : "text-slate-700 dark:text-slate-200"}`}>
                  {formatSlaCountdown(exception.time_remaining_seconds)}
                </span>
              </div>
            </div>
          </section>

          {/* Workflow & Audit Lifecycle Timeline */}
          <section>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">
              Workflow State Timeline
            </h4>
            <ol className="relative border-l border-slate-200 dark:border-slate-800 ml-3 space-y-4 text-xs">
              <li className="pl-4 relative">
                <div className="absolute -left-1.5 top-1.5 w-3 h-3 rounded-full border-2 border-white dark:border-slate-900 bg-slate-400"></div>
                <p className="font-semibold text-slate-800 dark:text-slate-200">Created / Break Flagged</p>
                <p className="text-slate-500 font-mono text-[11px]">{formatDateTime(exception.created_at)}</p>
              </li>

              <li className="pl-4 relative">
                <div className={`absolute -left-1.5 top-1.5 w-3 h-3 rounded-full border-2 border-white dark:border-slate-900 ${exception.assigned_at ? "bg-amber-500" : "bg-slate-300 dark:bg-slate-700"}`}></div>
                <p className="font-semibold text-slate-800 dark:text-slate-200">
                  {exception.assigned_to_name ? `Assigned to ${exception.assigned_to_name}` : "Assigned"}
                </p>
                <p className="text-slate-500 font-mono text-[11px]">{formatDateTime(exception.assigned_at)}</p>
              </li>

              <li className="pl-4 relative">
                <div className={`absolute -left-1.5 top-1.5 w-3 h-3 rounded-full border-2 border-white dark:border-slate-900 ${exception.in_progress_at ? "bg-blue-500" : "bg-slate-300 dark:bg-slate-700"}`}></div>
                <p className="font-semibold text-slate-800 dark:text-slate-200">Investigation Started</p>
                <p className="text-slate-500 font-mono text-[11px]">{formatDateTime(exception.in_progress_at)}</p>
              </li>

              <li className="pl-4 relative">
                <div className={`absolute -left-1.5 top-1.5 w-3 h-3 rounded-full border-2 border-white dark:border-slate-900 ${exception.resolved_at ? "bg-indigo-500" : "bg-slate-300 dark:bg-slate-700"}`}></div>
                <p className="font-semibold text-slate-800 dark:text-slate-200">Resolved</p>
                <p className="text-slate-500 font-mono text-[11px]">{formatDateTime(exception.resolved_at)}</p>
                {exception.resolution_note && (
                  <p className="mt-1 p-2 bg-slate-50 dark:bg-slate-950 rounded text-slate-600 dark:text-slate-400 italic">
                    "{exception.resolution_note}"
                  </p>
                )}
              </li>

              <li className="pl-4 relative">
                <div className={`absolute -left-1.5 top-1.5 w-3 h-3 rounded-full border-2 border-white dark:border-slate-900 ${exception.approved_at ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-700"}`}></div>
                <p className="font-semibold text-slate-800 dark:text-slate-200">Approved</p>
                <p className="text-slate-500 font-mono text-[11px]">{formatDateTime(exception.approved_at)}</p>
              </li>

              <li className="pl-4 relative">
                <div className={`absolute -left-1.5 top-1.5 w-3 h-3 rounded-full border-2 border-white dark:border-slate-900 ${exception.closed_at ? "bg-slate-700" : "bg-slate-300 dark:bg-slate-700"}`}></div>
                <p className="font-semibold text-slate-800 dark:text-slate-200">Closed</p>
                <p className="text-slate-500 font-mono text-[11px]">{formatDateTime(exception.closed_at)}</p>
              </li>
            </ol>
          </section>

          {/* Deterministic Investigation Panel */}
          <InvestigationPanel exceptionId={exception.exception_id} />
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex justify-between items-center">
          <Button variant="secondary" size="md" onClick={onClose}>
            Close Drawer
          </Button>

          <div className="flex gap-2">
            {exception.status === "UNASSIGNED" && (
              <Button
                variant="primary"
                size="md"
                onClick={() => onAction("claim", exception)}
                title="Claim assignment of this break"
              >
                Claim Exception
              </Button>
            )}

            {exception.status === "ASSIGNED" && isAssignedToUser && (
              <Button
                variant="primary"
                size="md"
                onClick={() => onAction("start-work", exception)}
              >
                Start Investigation
              </Button>
            )}

            {exception.status === "IN_PROGRESS" && isAssignedToUser && (
              <Button
                variant="primary"
                size="md"
                onClick={() => onAction("resolve", exception)}
              >
                Resolve Break
              </Button>
            )}

            {exception.status === "RESOLVED" && isApproverOrAdmin && (
              <Button
                variant="success"
                size="md"
                onClick={() => onAction("approve", exception)}
              >
                Approve Resolution
              </Button>
            )}

            {exception.status === "APPROVED" && isApproverOrAdmin && (
              <Button
                variant="secondary"
                size="md"
                onClick={() => onAction("close", exception)}
              >
                Close Break
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
