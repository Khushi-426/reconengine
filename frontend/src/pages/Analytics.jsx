import React, { useEffect, useState, useCallback } from "react";
import { api } from "../api/client.js";

export default function Analytics() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  // Default to last 30 days
  const todayStr = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgoStr = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [fromDate, setFromDate] = useState(thirtyDaysAgoStr);
  const [toDate, setToDate] = useState(todayStr);

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

  useEffect(() => {
    fetchTrend();
  }, [fetchTrend]);

  // Aggregate exception counts by day for the chart
  const dailyDataMap = {};
  data.forEach((row) => {
    const dateStr = new Date(row.day).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    dailyDataMap[dateStr] = (dailyDataMap[dateStr] || 0) + parseInt(row.cnt, 10);
  });

  // Convert map to sorted array (the SQL returns ORDER BY day DESC, cnt DESC, so we reverse it to chronological order)
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

  // Generate SVG Coordinates
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
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Exceptions Analytics</h2>
          <p className="text-sm text-slate-500">Analyze daily exception volume and distribution trends.</p>
        </div>

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

      {errorMsg && (
        <div className="bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-3 rounded-md mb-6">
          {errorMsg}
        </div>
      )}

      {/* Visual Chart */}
      <div className="bg-white rounded-lg border border-slate-200 p-6 shadow-sm mb-8">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">Daily Exception Volume Trend</h3>
        
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
              {/* Gradients */}
              <defs>
                <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {/* Grid Lines */}
              {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => {
                const y = paddingY + chartHeight * ratio;
                const gridVal = Math.round(maxVal * (1 - ratio));
                return (
                  <g key={i}>
                    <line
                      x1={paddingX}
                      y1={y}
                      x2={width - paddingX}
                      y2={y}
                      stroke="#f1f5f9"
                      strokeWidth={1}
                    />
                    <text
                      x={paddingX - 10}
                      y={y + 4}
                      fill="#94a3b8"
                      fontSize="9"
                      textAnchor="end"
                    >
                      {gridVal}
                    </text>
                  </g>
                );
              })}

              {/* Filled Area */}
              <path d={areaPath} fill="url(#areaGrad)" />

              {/* Line */}
              <path
                d={linePath}
                fill="none"
                stroke="#3b82f6"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* Dots on line */}
              {coordinates.map((c, i) => (
                <g key={i} className="group cursor-pointer">
                  <circle
                    cx={c.x}
                    cy={c.y}
                    r={3.5}
                    fill="#3b82f6"
                    stroke="#ffffff"
                    strokeWidth={1.5}
                  />
                  <circle
                    cx={c.x}
                    cy={c.y}
                    r={7}
                    fill="#3b82f6"
                    fillOpacity="0"
                    className="hover:fill-opacity-20 transition"
                  />
                  <title>{`${c.date}: ${c.val} exceptions`}</title>
                </g>
              ))}

              {/* X Axis Labels */}
              {coordinates.map((c, i) => {
                // Show label every few points to avoid crowding
                if (coordinates.length > 8 && i % Math.ceil(coordinates.length / 8) !== 0) return null;
                return (
                  <text
                    key={i}
                    x={c.x}
                    y={paddingY + chartHeight + 15}
                    fill="#94a3b8"
                    fontSize="9"
                    textAnchor="middle"
                  >
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
        <h3 className="text-sm font-semibold text-slate-700 px-6 py-4 border-b border-slate-200">
          Exception Breakdown by Day & Type
        </h3>
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
                <td colSpan={5} className="px-6 py-8 text-center text-slate-400">
                  Loading breakdown data...
                </td>
              </tr>
            )}
            {!loading && data.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-slate-400">
                  No data found.
                </td>
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
  );
}
