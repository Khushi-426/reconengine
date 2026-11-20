import React, { useEffect, useState, useCallback } from "react";
import { api } from "../api/client.js";
import { StatusBadge, Button, Alert, EmptyState, LoadingSpinner } from "../components/common.jsx";
import { formatDateTime } from "../utils/formatters.js";

export default function Analytics() {
  const [activeTab, setActiveTab] = useState("operations"); // default to live operations
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  // Time range defaults
  const todayStr = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgoStr = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [fromDate, setFromDate] = useState(thirtyDaysAgoStr);
  const [toDate, setToDate] = useState(todayStr);

  // Operations metrics state
  const [kpis, setKpis] = useState(null);
  const [queueStatus, setQueueStatus] = useState(null);
  const [workerStatus, setWorkerStatus] = useState(null);
  const [opsLoading, setOpsLoading] = useState(false);

  const fetchTrend = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const result = await api.get(`/exceptions/reports/trend?fromDate=${fromDate}&toDate=${toDate}`);
      setData(result.data || []);
    } catch (err) {
      setErrorMsg(err.message || "Failed to load exception trends report.");
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  const fetchOperationsData = useCallback(async () => {
    setOpsLoading(true);
    setErrorMsg(null);
    try {
      const [kpiRes, queueRes, workerRes] = await Promise.all([
        api.get("/operations/kpis"),
        api.get("/operations/queue-status"),
        api.get("/operations/worker-status"),
      ]);
      setKpis(kpiRes);
      setQueueStatus(queueRes);
      setWorkerStatus(workerRes);
    } catch (err) {
      setErrorMsg("Failed to retrieve operations metrics: " + (err.message || "Network error"));
    } finally {
      setOpsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "trends") {
      fetchTrend();
    } else {
      fetchOperationsData();
    }
  }, [activeTab, fetchTrend, fetchOperationsData]);

  // Aggregate exception counts by day for the chart
  const dailyDataMap = {};
  data.forEach((row) => {
    const dateStr = new Date(row.day).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    dailyDataMap[dateStr] = (dailyDataMap[dateStr] || 0) + parseInt(row.cnt, 10);
  });

  const chartPoints = Object.entries(dailyDataMap)
    .map(([date, val]) => ({ date, val }))
    .reverse();

  // SVG Chart Dimensions
  const width = 600;
  const height = 180;
  const paddingX = 40;
  const paddingY = 20;

  const maxVal = chartPoints.length > 0 ? Math.max(...chartPoints.map((p) => p.val)) : 10;
  const chartWidth = width - paddingX * 2;
  const chartHeight = height - paddingY * 2;

  const coordinates = chartPoints.map((p, idx) => {
    const x = paddingX + (idx / (chartPoints.length - 1 || 1)) * chartWidth;
    const y = paddingY + chartHeight - (p.val / maxVal) * chartHeight;
    return { x, y, date: p.date, val: p.val };
  });

  const linePath = coordinates.length > 0
    ? `M ${coordinates[0].x} ${coordinates[0].y} ` +
      coordinates.slice(1).map((c) => `L ${c.x} ${c.y}`).join(" ")
    : "";

  const areaPath = coordinates.length > 0
    ? `${linePath} L ${coordinates[coordinates.length - 1].x} ${paddingY + chartHeight} L ${coordinates[0].x} ${paddingY + chartHeight} Z`
    : "";

  // Helper for displaying rates safely without misleading 0/100
  function renderRate(val) {
    if (val == null || Number.isNaN(Number(val))) {
      return <span className="text-xs text-slate-400 font-normal">No data</span>;
    }
    return `${val}%`;
  }

  return (
    <div className="space-y-6">
      {/* Title block */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
            Operations & Break Intelligence
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Operational dashboard, live worker queue monitoring, and SLA compliance metrics.
          </p>
        </div>

        <Button
          variant="secondary"
          size="sm"
          onClick={activeTab === "operations" ? fetchOperationsData : fetchTrend}
          loading={opsLoading || loading}
        >
          Refresh Data
        </Button>
      </div>

      {/* Tabs navigation */}
      <div className="flex gap-2 border-b border-slate-200 dark:border-slate-800">
        <button
          onClick={() => setActiveTab("operations")}
          className={`pb-2.5 px-3 text-xs font-semibold border-b-2 transition select-none ${
            activeTab === "operations"
              ? "border-slate-900 text-slate-900 dark:border-white dark:text-white"
              : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
          }`}
        >
          Executive Operations & Queues
        </button>
        <button
          onClick={() => setActiveTab("trends")}
          className={`pb-2.5 px-3 text-xs font-semibold border-b-2 transition select-none ${
            activeTab === "trends"
              ? "border-slate-900 text-slate-900 dark:border-white dark:text-white"
              : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
          }`}
        >
          Break Volume Trends & Audit
        </button>
      </div>

      {errorMsg && (
        <Alert variant="error" className="flex justify-between items-center">
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="text-xs font-semibold ml-4 hover:underline">&times;</button>
        </Alert>
      )}

      {activeTab === "operations" ? (
        <div>
          {opsLoading && !kpis ? (
            <LoadingSpinner label="Loading operational KPIs and queue health..." />
          ) : (
            <div className="space-y-6">
              {/* Executive KPIs Grid */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Live Operational Metrics
                  </h3>
                  <span className="text-[11px] text-slate-400">All metrics computed from PostgreSQL transaction log</span>
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5">
                  <div className="bg-white dark:bg-slate-900 p-4 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xs">
                    <p className="text-[11px] font-medium text-slate-500">Auto Match Rate</p>
                    <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1 font-mono">
                      {renderRate(kpis?.autoMatchRate)}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-1">Matched rows / total rows</p>
                  </div>

                  <div className="bg-white dark:bg-slate-900 p-4 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xs">
                    <p className="text-[11px] font-medium text-slate-500">SLA Compliance</p>
                    <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1 font-mono">
                      {renderRate(kpis?.slaComplianceRate)}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-1">Resolved within SLA deadline</p>
                  </div>

                  <div className="bg-white dark:bg-slate-900 p-4 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xs">
                    <p className="text-[11px] font-medium text-slate-500">Avg Resolution Time</p>
                    <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1 font-mono">
                      {kpis?.avgResolutionTimeHours != null ? `${kpis.avgResolutionTimeHours}h` : "—"}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-1">Creation to sign-off</p>
                  </div>

                  <div className="bg-white dark:bg-slate-900 p-4 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xs">
                    <p className="text-[11px] font-medium text-slate-500">Statement Ingestion</p>
                    <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1 font-mono">
                      {renderRate(kpis?.importSuccessRate)}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-1">Completed batches / total</p>
                  </div>

                  <div className="bg-white dark:bg-slate-900 p-4 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xs col-span-2 lg:col-span-1">
                    <p className="text-[11px] font-medium text-slate-500">Active Break Queue</p>
                    <p className="text-2xl font-bold text-rose-600 dark:text-rose-400 mt-1 font-mono">
                      {kpis?.activeQueueSize != null ? kpis.activeQueueSize.toLocaleString() : "—"}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-1">Unassigned + Assigned</p>
                  </div>
                </div>
              </div>

              {/* Status and Worker Queue Sections */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Exception Distribution */}
                <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-4">
                  <div className="border-b border-slate-100 dark:border-slate-800 pb-2">
                    <h3 className="font-semibold text-xs text-slate-900 dark:text-white uppercase tracking-wider">
                      Exception Queue Distribution
                    </h3>
                    <p className="text-[11px] text-slate-400">Live breakdown of breaks across operational lifecycle</p>
                  </div>

                  <div>
                    <h4 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">By Status</h4>
                    <div className="space-y-1.5 font-mono text-xs">
                      {queueStatus?.byStatus && Object.keys(queueStatus.byStatus).length > 0 ? (
                        Object.entries(queueStatus.byStatus).map(([status, count]) => (
                          <div key={status} className="flex justify-between items-center py-1.5 px-2.5 bg-slate-50 dark:bg-slate-950 rounded">
                            <StatusBadge status={status} />
                            <span className="font-bold text-slate-800 dark:text-slate-200">{count}</span>
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-slate-400">No active breaks in queue.</p>
                      )}
                    </div>
                  </div>

                  <div>
                    <h4 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">By Discrepancy Type</h4>
                    <div className="space-y-1.5 font-mono text-xs">
                      {queueStatus?.byType && Object.keys(queueStatus.byType).length > 0 ? (
                        Object.entries(queueStatus.byType).map(([type, count]) => (
                          <div key={type} className="flex justify-between items-center py-1.5 px-2.5 bg-slate-50 dark:bg-slate-950 rounded">
                            <span className="text-slate-700 dark:text-slate-300 font-sans">{type.replace(/_/g, " ")}</span>
                            <span className="font-bold text-slate-800 dark:text-slate-200">{count}</span>
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-slate-400">No types categorized.</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Worker Queue Engine Status */}
                <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-4">
                  <div className="border-b border-slate-100 dark:border-slate-800 pb-2">
                    <h3 className="font-semibold text-xs text-slate-900 dark:text-white uppercase tracking-wider">
                      Background Job Queue & Workers
                    </h3>
                    <p className="text-[11px] text-slate-400">PostgreSQL queue worker heartbeats and Dead Letter Queue (DLQ)</p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 bg-slate-50 dark:bg-slate-950 rounded-lg border border-slate-200 dark:border-slate-800">
                      <span className="text-[11px] text-slate-500 block">Active Worker Instances</span>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`w-2.5 h-2.5 rounded-full ${workerStatus?.activeWorkerThreads > 0 ? "bg-emerald-500" : "bg-slate-300"}`} />
                        <span className="font-mono font-bold text-lg text-slate-900 dark:text-white">
                          {workerStatus?.activeWorkerThreads || 0}
                        </span>
                      </div>
                    </div>

                    <div className="p-3 bg-slate-50 dark:bg-slate-950 rounded-lg border border-slate-200 dark:border-slate-800">
                      <span className="text-[11px] text-slate-500 block">Dead Letter Jobs (DLQ)</span>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`font-mono font-bold text-lg ${workerStatus?.deadLetterQueueSize > 0 ? "text-rose-600" : "text-slate-900 dark:text-white"}`}>
                          {workerStatus?.deadLetterQueueSize || 0}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
                      Job Queue Execution Breakdown
                    </h4>
                    <div className="space-y-1.5 font-mono text-xs">
                      {["PENDING", "RUNNING", "RETRYING", "FAILED", "COMPLETED"].map((st) => (
                        <div key={st} className="flex justify-between items-center py-1.5 px-2.5 bg-slate-50 dark:bg-slate-950 rounded">
                          <StatusBadge status={st} />
                          <span className="font-bold text-slate-800 dark:text-slate-200">
                            {workerStatus?.jobsByStatus?.[st] || 0}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Note on direct database mutations */}
                  <div className="p-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded text-[11px] text-slate-500">
                    <strong>Operational Invariant:</strong> Background workers communicate solely via backend API endpoints. Direct browser access to Postgres or job queue mutation is disallowed.
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Trends & Daily Breakdown Tab */
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                Break Volume History
              </h3>
              <p className="text-[11px] text-slate-400">Daily exception volumes recorded across reconciliation runs</p>
            </div>
            <div className="flex gap-2 items-center bg-white dark:bg-slate-900 p-1.5 border border-slate-200 dark:border-slate-800 rounded">
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="border border-slate-300 dark:border-slate-700 rounded px-2 py-0.5 text-xs bg-white dark:bg-slate-950 font-mono"
              />
              <span className="text-xs text-slate-400">to</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="border border-slate-300 dark:border-slate-700 rounded px-2 py-0.5 text-xs bg-white dark:bg-slate-950 font-mono"
              />
            </div>
          </div>

          {/* SVG Trend Chart */}
          <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-5 shadow-xs">
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
              Daily Exception Influx
            </h4>

            {loading && <LoadingSpinner label="Compiling exception trend chart..." />}

            {!loading && chartPoints.length === 0 && (
              <EmptyState title="No data recorded" description="No break exceptions recorded in this date range." />
            )}

            {!loading && chartPoints.length > 0 && (
              <div className="relative w-full">
                <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto overflow-visible">
                  <defs>
                    <linearGradient id="trendAreaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#475569" stopOpacity="0.2" />
                      <stop offset="100%" stopColor="#475569" stopOpacity="0.0" />
                    </linearGradient>
                  </defs>

                  {[0, 0.33, 0.66, 1].map((ratio, i) => {
                    const y = paddingY + chartHeight * ratio;
                    const gridVal = Math.round(maxVal * (1 - ratio));
                    return (
                      <g key={i}>
                        <line x1={paddingX} y1={y} x2={width - paddingX} y2={y} stroke="#e2e8f0" strokeDasharray="2 2" strokeWidth={1} />
                        <text x={paddingX - 8} y={y + 3} fill="#94a3b8" fontSize="8" textAnchor="end" className="font-mono">
                          {gridVal}
                        </text>
                      </g>
                    );
                  })}

                  <path d={areaPath} fill="url(#trendAreaGrad)" />
                  <path d={linePath} fill="none" stroke="#334155" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

                  {coordinates.map((c, i) => (
                    <g key={i}>
                      <circle cx={c.x} cy={c.y} r={3} fill="#0f172a" />
                      <title>{`${c.date}: ${c.val} breaks`}</title>
                    </g>
                  ))}

                  {coordinates.map((c, i) => {
                    if (coordinates.length > 8 && i % Math.ceil(coordinates.length / 8) !== 0) return null;
                    return (
                      <text key={i} x={c.x} y={paddingY + chartHeight + 14} fill="#64748b" fontSize="8" textAnchor="middle" className="font-mono">
                        {c.date}
                      </text>
                    );
                  })}
                </svg>
              </div>
            )}
          </div>

          {/* Details Table */}
          <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 dark:bg-slate-950/80 border-b border-slate-200 dark:border-slate-800 text-slate-500 uppercase font-semibold text-[10px] tracking-wider">
                <tr>
                  <th className="px-4 py-3 font-mono">Date</th>
                  <th className="px-4 py-3">Exception Type</th>
                  <th className="px-4 py-3 text-right">Volume</th>
                  <th className="px-4 py-3 text-right">Day Delta</th>
                  <th className="px-4 py-3 text-right font-mono">Day Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.map((row, idx) => {
                  const delta = parseInt(row.delta_vs_prev_day, 10);
                  const deltaColor = delta > 0 ? "text-rose-600" : delta < 0 ? "text-emerald-600" : "text-slate-400";
                  const deltaSign = delta > 0 ? `+${delta}` : `${delta}`;

                  return (
                    <tr key={idx} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition">
                      <td className="px-4 py-3 font-mono font-medium text-slate-800 dark:text-slate-200">
                        {new Date(row.day).toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "2-digit" })}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-700 dark:text-slate-300">
                        {row.exception_type}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-slate-900 dark:text-white">
                        {row.cnt}
                      </td>
                      <td className={`px-4 py-3 text-right font-mono font-medium ${deltaColor}`}>
                        {row.prev_day_cnt != null ? deltaSign : "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-slate-500">
                        {row.pct_of_day}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
