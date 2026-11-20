import React, { useState } from "react";
import { api } from "../api/client.js";
import { StatusBadge, Button } from "./common.jsx";

export default function AiInvestigationPanel({ exceptionId }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);
  const [submittingFeedback, setSubmittingFeedback] = useState(false);
  const [feedbackComment, setFeedbackComment] = useState("");

  const runInvestigation = async () => {
    setLoading(true);
    setError(null);
    setFeedbackSubmitted(false);
    try {
      const res = await api.post(`/exceptions/${exceptionId}/investigate`, {});
      setData(res.data);
    } catch (err) {
      setError(err.message || "Failed to conduct investigation");
    } finally {
      setLoading(false);
    }
  };

  const submitFeedback = async (isUseful) => {
    if (!data?.investigationId) return;
    setSubmittingFeedback(true);
    try {
      await api.post(`/exceptions/investigations/${data.investigationId}/feedback`, {
        isUseful,
        comment: feedbackComment.trim() || undefined,
      });
      setFeedbackSubmitted(true);
    } catch (err) {
      console.error("Failed to submit feedback", err);
    } finally {
      setSubmittingFeedback(false);
    }
  };

  return (
    <section className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 uppercase tracking-wider">
            AI Investigation Assistant
          </span>
          {data?.status && (
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-medium ${
                data.status === "SUCCESS_MODEL"
                  ? "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300"
                  : "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300"
              }`}
            >
              {data.status === "SUCCESS_MODEL" ? "AI Model Assisted" : "Deterministic Engine"}
            </span>
          )}
        </div>
        {!data && !loading && (
          <Button variant="secondary" size="sm" onClick={runInvestigation}>
            Investigate Break
          </Button>
        )}
      </div>

      {/* Mandatory Safety Notice / Disclaimer */}
      <div className="text-[11px] p-2.5 rounded bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 text-amber-900 dark:text-amber-200 flex items-start gap-2">
        <span className="font-bold shrink-0">NOTICE:</span>
        <span>
          AI-generated suggestion. Requires analyst judgment. Strictly read-only & non-authoritative; no financial action is taken automatically.
        </span>
      </div>

      {loading && (
        <div className="py-4 text-center text-xs text-slate-500 animate-pulse">
          Analyzing transaction ledger records, statement lines, and settlement rules...
        </div>
      )}

      {error && (
        <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 rounded text-xs text-rose-700 dark:text-rose-300 space-y-2">
          <p className="font-medium">{error}</p>
          <Button variant="secondary" size="sm" onClick={runInvestigation}>
            Retry Analysis
          </Button>
        </div>
      )}

      {data && (
        <div className="space-y-4 text-xs">
          {/* Categorization & Grounding Summary */}
          <div className="p-3 bg-white dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-medium">Suspected Discrepancy:</span>
              <span className="font-bold text-slate-900 dark:text-slate-100 font-mono">
                {data.aiAnalysis?.suspected_category || data.deterministicHints?.category}
              </span>
            </div>
            <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
              {data.aiAnalysis?.summary}
            </p>
          </div>

          {/* Deterministic System Facts vs AI Hypotheses */}
          <div className="space-y-2">
            <h5 className="font-semibold text-slate-700 dark:text-slate-300 text-[11px] uppercase tracking-wider">
              System Verified Observations
            </h5>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="p-2 bg-white dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-800">
                <span className="text-slate-500 block">Identified Value Variance:</span>
                <span className="font-mono font-semibold">
                  {data.deterministicHints?.amountDiffFormatted != null
                    ? `£${data.deterministicHints.amountDiffFormatted}`
                    : "None"}
                </span>
              </div>
              <div className="p-2 bg-white dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-800">
                <span className="text-slate-500 block">Date Lag / Timing Delta:</span>
                <span className="font-mono font-semibold">
                  {data.deterministicHints?.dateDiffDays != null
                    ? `${data.deterministicHints.dateDiffDays} day(s)`
                    : "None"}
                </span>
              </div>
            </div>
          </div>

          {/* Root Cause Hypotheses */}
          {data.aiAnalysis?.possible_explanations?.length > 0 && (
            <div className="space-y-2">
              <h5 className="font-semibold text-slate-700 dark:text-slate-300 text-[11px] uppercase tracking-wider">
                Hypotheses & Grounded Evidence
              </h5>
              <div className="space-y-2">
                {data.aiAnalysis.possible_explanations.map((exp, idx) => (
                  <div
                    key={idx}
                    className="p-2.5 bg-white dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-800 space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        {exp.hypothesis}
                      </span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                          exp.confidence === "HIGH"
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                            : exp.confidence === "MEDIUM"
                            ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                            : "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300"
                        }`}
                      >
                        {exp.confidence} CONFIDENCE
                      </span>
                    </div>
                    {exp.supporting_evidence_ids?.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] text-slate-400">Retrieved Evidence:</span>
                        {exp.supporting_evidence_ids.map((id) => (
                          <span
                            key={id}
                            className="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-1 py-0.5 rounded font-mono"
                          >
                            {id}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recommended Next Checks */}
          {data.aiAnalysis?.recommended_next_checks?.length > 0 && (
            <div className="space-y-1.5">
              <h5 className="font-semibold text-slate-700 dark:text-slate-300 text-[11px] uppercase tracking-wider">
                Recommended Verification Steps
              </h5>
              <ul className="list-disc pl-4 space-y-1 text-slate-600 dark:text-slate-400">
                {data.aiAnalysis.recommended_next_checks.map((check, idx) => (
                  <li key={idx}>{check}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Uncertainty & Missing Evidence Notice */}
          {(data.aiAnalysis?.uncertainty || data.aiAnalysis?.missing_evidence?.length > 0) && (
            <div className="p-2.5 bg-slate-100 dark:bg-slate-900/80 rounded border border-slate-200 dark:border-slate-800 text-[11px] space-y-1 text-slate-600 dark:text-slate-400">
              {data.aiAnalysis?.uncertainty && (
                <p>
                  <strong className="text-slate-700 dark:text-slate-300">Uncertainty:</strong>{" "}
                  {data.aiAnalysis.uncertainty}
                </p>
              )}
              {data.aiAnalysis?.missing_evidence?.length > 0 && (
                <p>
                  <strong className="text-slate-700 dark:text-slate-300">Missing Evidence:</strong>{" "}
                  {data.aiAnalysis.missing_evidence.join(", ")}
                </p>
              )}
            </div>
          )}

          {/* Analyst Feedback Section */}
          <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
            {feedbackSubmitted ? (
              <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                ✓ Thank you. Your investigation feedback has been recorded for model auditing.
              </p>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-500">Was this investigation analysis helpful?</span>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => submitFeedback(true)}
                      disabled={submittingFeedback}
                      className="px-2 py-1 text-xs rounded bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                      title="Helpful"
                    >
                      👍 Yes
                    </button>
                    <button
                      onClick={() => submitFeedback(false)}
                      disabled={submittingFeedback}
                      className="px-2 py-1 text-xs rounded bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                      title="Not helpful"
                    >
                      👎 No
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
