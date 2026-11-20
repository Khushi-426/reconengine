import React, { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { Button } from "./common.jsx";

const stages = [
  ["EVIDENCE_RETRIEVAL", "Evidence retrieval"],
  ["FINANCIAL_ANALYSIS", "Financial analysis"],
  ["INVESTIGATION", "Root cause investigation"],
  ["VERIFICATION_REPORTING", "Verification and report"],
];
const label = (value) => String(value || "—").replaceAll("_", " ");

export default function InvestigationPanel({ exceptionId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [feedbackDone, setFeedbackDone] = useState(false);

  useEffect(() => {
    if (!data?.investigation_id || !["QUEUED", "RUNNING"].includes(data.status)) return undefined;
    let active = true;
    const poll = async () => {
      try {
        const latest = await api.get(`/exceptions/investigations/${data.investigation_id}`);
        if (active) setData(latest);
      } catch (e) { if (active) setError(e.message); }
    };
    const timer = setInterval(poll, 1500);
    return () => { active = false; clearInterval(timer); };
  }, [data?.investigation_id, data?.status]);

  const start = async () => {
    setLoading(true); setError(""); setFeedbackDone(false);
    try {
      const queued = await api.post(`/exceptions/${exceptionId}/investigate`, {});
      const result = await api.get(`/exceptions/investigations/${queued.investigationId}`);
      setData(result);
    } catch (e) { setError(e.message || "Could not queue investigation"); }
    finally { setLoading(false); }
  };

  const submitFeedback = async (isUseful) => {
    await api.post(`/exceptions/investigations/${data.investigation_id}/feedback`, { isUseful });
    setFeedbackDone(true);
  };

  const stagesByName = new Map((data?.stages || []).map((stage) => [stage.agentName, stage]));
  const result = data?.result;
  return <section className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-4 space-y-4">
    <div className="flex items-center justify-between gap-3">
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-200">Deterministic investigation</h4>
        {data && <p className="mt-1 text-[11px] text-slate-500">Investigation #{data.investigation_id} · {label(data.status)}</p>}
      </div>
      {!data && <Button variant="secondary" size="sm" onClick={start} disabled={loading}>{loading ? "Queueing…" : "Investigate"}</Button>}
      {data?.status === "FAILED" && <Button variant="secondary" size="sm" onClick={start}>Retry investigation</Button>}
    </div>
    <p className="text-[11px] text-slate-600 dark:text-slate-400">Rule-based analysis from source records. Findings are read-only recommendations; analysts make all decisions.</p>
    {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
    {data && <ol className="grid gap-2 sm:grid-cols-2">{stages.map(([name, title]) => {
      const stage = stagesByName.get(name);
      const status = stage?.status || (data.status === "QUEUED" ? "PENDING" : "WAITING");
      return <li key={name} className="rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
        <div className="flex justify-between gap-2"><span className="font-medium text-xs">{title}</span><span className="text-[10px] uppercase text-slate-500">{label(status)}</span></div>
        {stage?.error && <p className="mt-2 text-xs text-rose-600">{stage.error}</p>}
        {stage?.output && <details className="mt-2"><summary className="cursor-pointer text-[11px] text-indigo-600">Inspect stage output</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-[10px] text-slate-600 dark:text-slate-300">{JSON.stringify(stage.output, null, 2)}</pre></details>}
      </li>;
    })}</ol>}
    {result && <div className="space-y-3 text-xs">
      <div className="rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
        <div className="flex justify-between"><b>Classification</b><b className="font-mono">{label(result.discrepancyCategory)}</b></div>
        <p className="mt-1">Verification: {label(result.verification?.status)}</p>
        <p className="mt-1 text-slate-500">Amount difference: {result.analysis?.calculations?.amountDifference ?? "—"} {result.analysis?.calculations?.currency ?? ""}; date difference: {result.analysis?.calculations?.dateDifferenceDays ?? "—"} day(s)</p>
      </div>
      <section><h5 className="mb-1 font-semibold">Root cause hypotheses</h5>{result.investigation?.hypotheses?.length ? result.investigation.hypotheses.map((h) => <div key={h.rule} className="mb-1 rounded bg-white dark:bg-slate-900 p-2"><b>{label(h.cause)}</b><span className="ml-2 text-amber-700 dark:text-amber-300">Possible</span><p className="mt-1 text-slate-600 dark:text-slate-300">{h.explanation}</p></div>) : <p className="text-slate-500">No root cause hypothesis met the configured rules.</p>}</section>
      <section><h5 className="mb-1 font-semibold">Recommended next steps</h5><ul className="list-disc pl-4">{result.investigation?.nextSteps?.map((step) => <li key={step}>{step}</li>)}</ul></section>
      {!!result.evidence?.missingEvidence?.length && <p className="text-amber-700 dark:text-amber-300">Missing evidence: {result.evidence.missingEvidence.join("; ")}</p>}
      <details><summary className="cursor-pointer font-semibold">Final report and evidence references</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-[10px]">{JSON.stringify(result.report, null, 2)}</pre></details>
      {!feedbackDone && <div className="flex gap-2 border-t border-slate-200 dark:border-slate-800 pt-3"><span className="mr-auto text-slate-500">Was this useful?</span><button onClick={() => submitFeedback(true)} className="rounded border px-2 py-1">Yes</button><button onClick={() => submitFeedback(false)} className="rounded border px-2 py-1">No</button></div>}
      {feedbackDone && <p className="text-emerald-700">Feedback recorded.</p>}
    </div>}
  </section>;
}
