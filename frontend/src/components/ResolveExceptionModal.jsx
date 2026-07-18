import React, { useState } from "react";
import { api } from "../api/client.js";

export default function ResolveExceptionModal({ exception, onClose, onResolved }) {
  const [note, setNote] = useState("");
  const [decision, setDecision] = useState("RESOLVED");
  const [submitting, setSubmitting] = useState(false);
  const [conflict, setConflict] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    setConflict(null);
    try {
      await api.patch(`/exceptions/${exception.exception_id}/resolve`, {
        expectedVersion: exception.version,
        resolutionNote: note,
        decision,
      });
      onResolved();
    } catch (err) {
      if (err.code === "OPTIMISTIC_LOCK_CONFLICT") {
        // This is the concurrency scenario in action: another analyst
        // resolved this exact exception between page load and submit.
        setConflict(err.details);
      } else {
        setErrorMsg(err.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
        <h2 className="text-lg font-semibold text-slate-800 mb-1">Resolve Exception #{exception.exception_id}</h2>
        <p className="text-sm text-slate-500 mb-4">{exception.exception_type}</p>

        {conflict && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-md px-3 py-2 mb-4">
            This exception was already updated by someone else (now status:{" "}
            <strong>{conflict.currentStatus}</strong>). Please close this dialog and refresh to see the latest state.
          </div>
        )}
        {errorMsg && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-md mb-4">{errorMsg}</div>}

        <form onSubmit={handleSubmit}>
          <label className="block text-sm font-medium text-slate-700 mb-1">Decision</label>
          <select
            value={decision}
            onChange={(e) => setDecision(e.target.value)}
            className="w-full border border-slate-300 rounded-md px-3 py-2 mb-4 text-sm"
          >
            <option value="RESOLVED">Resolved (matched manually)</option>
            <option value="WRITTEN_OFF">Written off (requires approver role)</option>
          </select>

          <label className="block text-sm font-medium text-slate-700 mb-1">Resolution note</label>
          <textarea
            required
            minLength={5}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="w-full border border-slate-300 rounded-md px-3 py-2 mb-4 text-sm"
            placeholder="e.g. Confirmed manually against SWIFT MT940 line ref XYZ123, fee delta due to correspondent bank charge."
          />

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !!conflict}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-md"
            >
              {submitting ? "Submitting…" : "Submit"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
