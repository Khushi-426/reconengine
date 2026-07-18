import React, { useEffect, useState, useCallback } from "react";
import { api } from "../api/client.js";

export default function Analytics() {
  const [activeTab, setActiveTab] = useState("trends"); // "trends" or "operations"
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  // Default to last 30 days
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
      setErrorMsg(err.message);
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
      setErrorMsg("Failed to retrieve system operations metrics: " + err.message);
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
  const height = 200;
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

  return (
    <div className="max-w-6xl mx-auto p-6">
      {/* Title block */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-800">Operations & Break Analytics</h2>
        <p className="text-sm text-slate-500">Monitor systems operations, background processing, and break resolution performance.</p>
      </div>

      {/* Tabs list */}
      <div className="flex gap-4 border-b border-slate-200 mb-6">
        <button
          onClick={() => setActiveTab("trends")}
          className={`pb-3 text-sm font-semibold border-b-2 transition ${
            activeTab === "trends"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          Break Volume Trends
        </button>
        <button
          onClick={() => setActiveTab("operations")}
          className={`pb-3 text-sm font-semibold border-b-2 transition ${
            activeTab === "operations"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          System Ops & Workers
        </button>
      </div>

      {errorMsg && (
        <div className="bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-3 rounded-md mb-6">
          {errorMsg}
        </div>
      )}

      {activeTab === "trends" ? (
        <div>
          {/* Trend tab header */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
            <h3 className="text-md font-semibold text-slate-700">Volume Analysis</h3>
            <div className="flex gap-2 items-center bg-white p-2 border border-slate-200 rounded-lg shadow-sm">
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="border border-slate-300 rounded px-2 py-1 text-sm bg-white focus:outline-none"
              />
              <span className="text-xs text-slate-400">to</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="border border-slate-300 rounded px-2 py-1 text-sm bg-white focus:outline-none"
              />
            </div>
          </div>

          {/* Visual Chart */}
          <div className="bg-white rounded-lg border border-slate-200 p-6 shadow-sm mb-8">
            <h4 className="text-sm font-semibold text-slate-700 mb-4">Daily Exception Volume Trend</h4>
            
            {loading && (
              <div className="h-48 flex items-center justify-center text-slate-400 text-sm">
                Loading chart data...
              </div>
            )}

            {!loading && chartPoints.length === 0 && (
              <div className="h-48 flex items-center justify-center text-slate-400 text-sm">
                No exceptions recorded in this date range.
              </div>
            )}

            {!loading && chartPoints.length > 0 && (
              <div className="relative w-full">
                <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto overflow-visible">
                  <defs>
                    <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.25" />
                      <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.0" />
                    </linearGradient>
                  </defs>

                  {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => {
                    const y = paddingY + chartHeight * ratio;
                    const gridVal = Math.round(maxVal * (1 - ratio));
                    return (
                      <g key={i}>
                        <line x1={paddingX} y1={y} x2={width - paddingX} y2={y} stroke="#f1f5f9" strokeWidth={1} />
                        <text x={paddingX - 10} y={y + 4} fill="#94a3b8" fontSize="9" textAnchor="end">
                          {gridVal}
                        </text>
                      </g>
                    );
                  })}

                  <path d={areaPath} fill="url(#areaGrad)" />
                  <path d={linePath} fill="none" stroke="#3b82f6" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />

                  {coordinates.map((c, i) => (
                    <g key={i} className="group cursor-pointer">
                      <circle cx={c.x} cy={c.y} r={3.5} fill="#3b82f6" stroke="#ffffff" strokeWidth={1.5} />
                      <circle cx={c.x} cy={c.y} r={7} fill="#3b82f6" fillOpacity="0" className="hover:fill-opacity-20 transition" />
                      <title>{`${c.date}: ${c.val} exceptions`}</title>
                    </g>
                  ))}

                  {coordinates.map((c, i) => {
                    if (coordinates.length > 8 && i % Math.ceil(coordinates.length / 8) !== 0) return null;
                    return (
                      <text key={i} x={c.x} y={paddingY + chartHeight + 15} fill="#94a3b8" fontSize="9" textAnchor="middle">
                        {c.date}
                      </text>
                    );
                  })}
                </svg>
              </div>
            )}
          </div>

          {/* Details Table */}
          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-sm">
            <h4 className="text-sm font-semibold text-slate-700 px-6 py-4 border-b border-slate-200">
              Exception Breakdown by Day & Type
            </h4>
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
                <tr>
                  <th className="px-6 py-3">Day</th>
                  <th className="px-6 py-3">Exception Type</th>
                  <th className="px-6 py-3 text-right">Count</th>
                  <th className="px-6 py-3 text-right">Delta vs Prev Day</th>
                  <th className="px-6 py-3 text-right">Share of Day %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {loading && (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-slate-400">Loading breakdown data...</td>
                  </tr>
                )}
                {!loading && data.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-slate-400">No data found.</td>
                  </tr>
                )}
                {!loading &&
                  data.map((row, idx) => {
                    const delta = parseInt(row.delta_vs_prev_day, 10);
                    const deltaColor = delta > 0 ? "text-red-600" : delta < 0 ? "text-green-600" : "text-slate-500";
                    const deltaSign = delta > 0 ? `+${delta}` : `${delta}`;

                    return (
                      <tr key={idx} className="hover:bg-slate-50/70 transition">
                        <td className="px-6 py-4 font-medium text-slate-800">
                          {new Date(row.day).toLocaleDateString(undefined, {
                            weekday: "short",
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })}
                        </td>
                        <td className="px-6 py-4 text-slate-600">{row.exception_type}</td>
                        <td className="px-6 py-4 text-right font-semibold text-slate-700">{row.cnt}</td>
                        <td className={`px-6 py-4 text-right font-medium ${deltaColor}`}>
                          {row.prev_day_cnt != null ? deltaSign : "—"}
                        </td>
                        <td className="px-6 py-4 text-right text-slate-500 font-mono text-xs">{row.pct_of_day}%</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div>
          {/* Operations & Workers Tab */}
          {opsLoading && !kpis ? (
            <div className="py-20 text-center text-slate-400 text-sm font-semibold">
              Loading operations dashboard metrics...
            </div>
          ) : (
            <div>
              {/* KPIs Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
                <div className="bg-white p-5 border border-slate-200 rounded-lg shadow-sm">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Auto Match Rate</p>
                  <p className="text-2xl font-bold text-slate-800 mt-2 font-mono">{kpis?.autoMatchRate}%</p>
                </div>
                <div className="bg-white p-5 border border-slate-200 rounded-lg shadow-sm">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">SLA Compliance</p>
                  <p className="text-2xl font-bold text-green-600 mt-2 font-mono">{kpis?.slaComplianceRate}%</p>
                </div>
                <div className="bg-white p-5 border border-slate-200 rounded-lg shadow-sm">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Avg Resolution Time</p>
                  <p className="text-2xl font-bold text-slate-800 mt-2 font-mono">{kpis?.avgResolutionTimeHours} hrs</p>
                </div>
                <div className="bg-white p-5 border border-slate-200 rounded-lg shadow-sm">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Import Success Rate</p>
                  <p className="text-2xl font-bold text-slate-800 mt-2 font-mono">{kpis?.importSuccessRate}%</p>
                </div>
                <div className="bg-white p-5 border border-slate-200 rounded-lg shadow-sm">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Active Queue Size</p>
                  <p className="text-2xl font-bold text-blue-600 mt-2 font-mono">{kpis?.activeQueueSize} breaks</p>
                </div>
              </div>

              {/* Status and Worker split */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Exception breakdown status */}
                <div className="bg-white rounded-lg border border-slate-200 p-6 shadow-sm flex flex-col gap-6">
                  <div>
                    <h3 className="font-semibold text-slate-700 text-sm">Active Breaks Distribution</h3>
                    <p className="text-xs text-slate-400 mt-0.5">Live breakdown of exception queue items.</p>
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">By Status</h4>
                    <div className="flex flex-col gap-2">
                      {queueStatus?.byStatus && Object.keys(queueStatus.byStatus).length > 0 ? (
                        Object.entries(queueStatus.byStatus).map(([status, count]) => (
                          <div key={status} className="flex justify-between items-center bg-slate-50 px-3 py-2 rounded text-sm">
                            <span className="font-semibold font-mono text-xs text-slate-600">{status}</span>
                            <span className="font-bold text-slate-800">{count}</span>
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-slate-400">No active breaks in queue.</p>
                      )}
                    </div>
                  </div>

                  <div>
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">By Break Type</h4>
                    <div className="flex flex-col gap-2">
                      {queueStatus?.byType && Object.keys(queueStatus.byType).length > 0 ? (
                        Object.entries(queueStatus.byType).map(([type, count]) => (
                          <div key={type} className="flex justify-between items-center bg-slate-50 px-3 py-2 rounded text-sm">
                            <span className="font-mono text-xs text-slate-600">{type.replace(/_/g, " ")}</span>
                            <span className="font-bold text-slate-800">{count}</span>
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-slate-400">No types categorized.</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Worker status info */}
                <div className="bg-white rounded-lg border border-slate-200 p-6 shadow-sm flex flex-col gap-6">
                  <div>
                    <h3 className="font-semibold text-slate-700 text-sm">Background Worker Threads</h3>
                    <p className="text-xs text-slate-400 mt-0.5">Real-time status of job executors.</p>
                  </div>

                  <div className="flex gap-4 items-center bg-slate-50 p-4 rounded-lg">
                    <span className={`w-3.5 h-3.5 rounded-full ${workerStatus?.activeWorkerThreads > 0 ? "bg-green-500 animate-pulse" : "bg-slate-300"}`}></span>
                    <div>
                      <p className="text-xs font-semibold text-slate-700">Active Worker Nodes</p>
                      <p className="text-lg font-bold text-slate-900 font-mono">{workerStatus?.activeWorkerThreads || 0} online</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-slate-50 p-3 rounded-lg text-center">
                      <p className="text-[10px] font-semibold text-slate-400 uppercase">Schedulers Active</p>
                      <p className="text-xl font-bold text-slate-800 font-mono mt-1">{workerStatus?.activeSchedulers || 0}</p>
                    </div>
                    <div className="bg-slate-50 p-3 rounded-lg text-center">
                      <p className="text-[10px] font-semibold text-slate-400 uppercase">Dead Letter (DLQ)</p>
                      <p className={`text-xl font-bold font-mono mt-1 ${workerStatus?.deadLetterQueueSize > 0 ? "text-red-600 font-black" : "text-slate-800"}`}>
                        {workerStatus?.deadLetterQueueSize || 0}
                      </p>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Job Queue Summary</h4>
                    <div className="flex flex-col gap-1.5 font-mono text-xs text-slate-600">
                      <div className="flex justify-between py-1 border-b border-slate-100">
                        <span>PENDING</span>
                        <span className="font-bold">{workerStatus?.jobsByStatus?.PENDING || 0}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-100">
                        <span>RUNNING</span>
                        <span className="font-bold">{workerStatus?.jobsByStatus?.RUNNING || 0}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-100">
                        <span>RETRYING</span>
                        <span className="font-bold">{workerStatus?.jobsByStatus?.RETRYING || 0}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-100">
                        <span>FAILED</span>
                        <span className="font-bold text-red-600">{workerStatus?.jobsByStatus?.FAILED || 0}</span>
                      </div>
                      <div className="flex justify-between py-1">
                        <span>COMPLETED</span>
                        <span className="font-bold text-green-600">{workerStatus?.jobsByStatus?.COMPLETED || 0}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
