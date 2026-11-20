import React, { useState } from "react";
import { api } from "../api/client.js";
import { Button, Alert } from "./common.jsx";
import { formatMoney, formatDate } from "../utils/formatters.js";

export default function ResolveExceptionModal({ exception, onClose, onResolved }) {
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [conflict, setConflict] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [confirmed, setConfirmed] = useState(false);

  const isNoteValid = note.trim().length >= 5;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!isNoteValid) {
      setErrorMsg("A resolution audit note of at least 5 characters is required.");
      return;
    }
    if (!confirmed) {
      setConfirmed(true);
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);
    setConflict(null);
    try {
      await api.patch(`/exceptions/${exception.exception_id}/resolve`, {
        expectedVersion: exception.version,
        resolutionNote: note.trim(),
      });
      onResolved();
    } catch (err) {
      if (err.code === "OPTIMISTIC_LOCK_CONFLICT") {
        setConflict(err.details || { currentStatus: "UPDATED" });
      } else {
        setErrorMsg(err.message || "Failed to resolve exception");
      }
      setConfirmed(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow-2xl border border-slate-200 dark:border-slate-800 p-6 w-full max-w-lg">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Resolve Exception #{exception.exception_id}
            </h2>
            <p className="text-xs text-slate-500 font-mono mt-0.5">
              Type: {exception.exception_type} | Version: {exception.version}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-lg leading-none p-1"
            aria-label="Close dialog"
          >
            &times;
          </button>
        </div>

        {/* Evidence Snapshot */}
        <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded border border-slate-200 dark:border-slate-800 text-xs mb-4 grid grid-cols-2 gap-2">
          <div>
            <span className="text-slate-500 block">Ledger Ref:</span>
            <span className="font-mono font-medium text-slate-800 dark:text-slate-200">
              {exception.ledger_ref || "—"}
            </span>
            <span className="text-slate-500 block mt-1">Amount:</span>
            <span className="font-mono text-slate-800 dark:text-slate-200">
              {formatMoney(exception.ledger_amount)}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block">External Ref:</span>
            <span className="font-mono font-medium text-slate-800 dark:text-slate-200">
              {exception.external_ref || "—"}
            </span>
            <span className="text-slate-500 block mt-1">Amount:</span>
            <span className="font-mono text-slate-800 dark:text-slate-200">
              {formatMoney(exception.external_amount)}
            </span>
          </div>
        </div>

        {conflict && (
          <Alert variant="warning" className="mb-4">
            <p className="font-semibold">Concurrent Modification Detected</p>
            <p className="mt-1 text-xs">
              This record was updated by another user (Current Status:{" "}
              <strong>{conflict.currentStatus || "UPDATED"}</strong>, Version:{" "}
              <strong>{conflict.currentVersion || "N/A"}</strong>). Reload to obtain the latest record.
            </p>
            <div className="mt-2">
              <Button size="sm" variant="secondary" onClick={onResolved}>
                Reload Exception Queue
              </Button>
            </div>
          </Alert>
        )}

        {errorMsg && <Alert variant="error" className="mb-4">{errorMsg}</Alert>}

        <form onSubmit={handleSubmit}>
          <label htmlFor="resolution-note" className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
            Resolution Audit Note <span className="text-rose-500">*</span>
          </label>
          <textarea
            id="resolution-note"
            required
            minLength={5}
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              setConfirmed(false);
            }}
            rows={3}
            className="w-full border border-slate-300 dark:border-slate-700 rounded-md p-2.5 text-sm bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-400 mb-1"
            placeholder="e.g. Verified transaction against counterpart statement line; variance confirmed as wire processing fee."
            disabled={submitting || !!conflict}
          />
          <div className="flex justify-between items-center text-[11px] text-slate-500 mb-4">
            <span>Minimum 5 characters required for compliance audit</span>
            <span className={note.trim().length >= 5 ? "text-emerald-600 font-mono" : "text-amber-600 font-mono"}>
              {note.trim().length} chars
            </span>
          </div>

          {confirmed && (
            <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded mb-4 text-xs text-amber-900 dark:text-amber-300">
              <strong>Confirm Resolution:</strong> Are you sure you want to mark Exception #{exception.exception_id} as RESOLVED? This will advance it for Approver review.
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <Button variant="secondary" size="md" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant={confirmed ? "success" : "primary"}
              size="md"
              loading={submitting}
              disabled={submitting || !isNoteValid || !!conflict}
            >
              {confirmed ? "Confirm Resolution" : "Resolve Exception"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
