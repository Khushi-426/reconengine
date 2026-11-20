import React from "react";

/**
 * Status Badge Component
 * Semantic colors:
 * - Success: emerald
 * - Warning: amber
 * - Danger/Failure: rose/red
 * - Neutral/Closed: slate
 * - In Progress/Active: blue
 * - Info/Resolved: indigo/purple
 */

const BADGE_VARIANTS = {
  // Exception Statuses
  UNASSIGNED: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-900/50",
  ASSIGNED: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900/50",
  IN_PROGRESS: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-900/50",
  RESOLVED: "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-400 dark:border-indigo-900/50",
  APPROVED: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900/50",
  CLOSED: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700",

  // Run & Job Statuses
  COMPLETED: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900/50",
  RUNNING: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-900/50",
  PENDING: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900/50",
  RETRYING: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-400 dark:border-purple-900/50",
  FAILED: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-900/50",
  DEAD_LETTER: "bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-900/60 dark:text-rose-200 dark:border-rose-800",

  // SLA
  BREACHED: "bg-rose-600 text-white border-transparent font-bold tracking-wide",
  WARNING: "bg-amber-500 text-white border-transparent font-medium",
  HEALTHY: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900/50",
};

export function StatusBadge({ status, label, className = "" }) {
  const variant = BADGE_VARIANTS[status] || "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700";
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border font-mono ${variant} ${className}`}
    >
      {label || status?.replace(/_/g, " ")}
    </span>
  );
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  disabled = false,
  loading = false,
  type = "button",
  onClick,
  className = "",
  title,
}) {
  const base =
    "inline-flex items-center justify-center font-medium rounded transition focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed select-none";

  const sizes = {
    sm: "px-2.5 py-1 text-xs",
    md: "px-3.5 py-1.5 text-sm",
    lg: "px-4 py-2 text-base",
  };

  const variants = {
    primary:
      "bg-slate-900 text-white hover:bg-slate-800 focus:ring-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white dark:focus:ring-slate-100",
    secondary:
      "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 focus:ring-slate-500 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-700",
    success:
      "bg-emerald-700 text-white hover:bg-emerald-800 focus:ring-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500",
    danger:
      "bg-rose-700 text-white hover:bg-rose-800 focus:ring-rose-700 dark:bg-rose-600 dark:hover:bg-rose-500",
    ghost:
      "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200",
  };

  return (
    <button
      type={type}
      disabled={disabled || loading}
      onClick={onClick}
      title={title}
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
    >
      {loading && (
        <svg
          className="animate-spin -ml-1 mr-2 h-3.5 w-3.5 text-current"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          ></path>
        </svg>
      )}
      {children}
    </button>
  );
}

export function Alert({ variant = "info", title, children, className = "" }) {
  const styles = {
    info: "bg-blue-50 border-blue-200 text-blue-900 dark:bg-blue-950/40 dark:border-blue-900 dark:text-blue-300",
    success: "bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950/40 dark:border-emerald-900 dark:text-emerald-300",
    warning: "bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950/40 dark:border-amber-900 dark:text-amber-300",
    error: "bg-rose-50 border-rose-200 text-rose-900 dark:bg-rose-950/40 dark:border-rose-900 dark:text-rose-300",
  };

  return (
    <div className={`p-3.5 border rounded-md text-sm ${styles[variant]} ${className}`} role="alert">
      {title && <h5 className="font-semibold mb-1">{title}</h5>}
      <div>{children}</div>
    </div>
  );
}

export function EmptyState({ title, description, action }) {
  return (
    <div className="text-center py-12 px-4 border border-dashed border-slate-300 dark:border-slate-800 rounded-lg">
      <div className="mx-auto w-10 h-10 text-slate-400 dark:text-slate-600 mb-3 flex items-center justify-center">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      </div>
      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">{title}</h3>
      {description && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function LoadingSpinner({ label = "Loading data..." }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-slate-500 dark:text-slate-400">
      <div className="animate-spin rounded-full h-7 w-7 border-2 border-slate-300 dark:border-slate-700 border-t-slate-900 dark:border-t-white mb-2" />
      <span className="text-xs font-mono">{label}</span>
    </div>
  );
}
