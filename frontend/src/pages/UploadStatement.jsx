import React, { useState } from "react";
import { uploadFile } from "../api/client.js";

export default function UploadStatement() {
  const [file, setFile] = useState(null);
  const [sourceId, setSourceId] = useState("2"); // Default SWIFT_MT940
  const [isDragOver, setIsDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState(null);
  const [errors, setErrors] = useState([]);
  const [generalError, setGeneralError] = useState(null);

  function handleDragOver(e) {
    e.preventDefault();
    setIsDragOver(true);
  }

  function handleDragLeave() {
    setIsDragOver(false);
  }

  function handleDrop(e) {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
    }
  }

  function handleFileChange(e) {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!file) return;

    setLoading(true);
    setSuccessMsg(null);
    setErrors([]);
    setGeneralError(null);

    try {
      const res = await uploadFile("/imports/statements", file, { sourceId });
      setSuccessMsg(res.message || "File uploaded and processed successfully.");
      setFile(null);
    } catch (err) {
      if (err.details && Array.isArray(err.details)) {
        setErrors(err.details);
      } else {
        setGeneralError(err.message || "An error occurred during file upload.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto p-6 bg-white rounded-lg border border-slate-200 shadow-sm mt-8">
      <h2 className="text-xl font-semibold text-slate-800 mb-2">Upload Statement Feed</h2>
      <p className="text-sm text-slate-500 mb-6">
        Ingest bank statements or credit card network feeds. Files are fully validated and imported atomically.
      </p>

      {successMsg && (
        <div className="bg-green-50 border border-green-200 text-green-800 text-sm px-4 py-3 rounded-md mb-6">
          {successMsg}
        </div>
      )}

      {generalError && (
        <div className="bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-3 rounded-md mb-6">
          {generalError}
        </div>
      )}

      {errors.length > 0 && (
        <div className="bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-3 rounded-md mb-6 max-h-60 overflow-y-auto">
          <p className="font-semibold mb-2">CSV Validation Failed ({errors.length} errors found):</p>
          <ul className="list-disc pl-5 space-y-1 font-mono text-xs">
            {errors.map((err, idx) => (
              <li key={idx}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Import Source</label>
          <select
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
            className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="2">SWIFT_MT940 (Source ID: 2)</option>
            <option value="3">CARD_NETWORK (Source ID: 3)</option>
          </select>
        </div>

        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition ${
            isDragOver ? "border-blue-500 bg-blue-50/50" : "border-slate-300 hover:border-slate-400"
          }`}
          onClick={() => document.getElementById("file-input").click()}
        >
          <input
            id="file-input"
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            className="hidden"
          />
          <div className="flex flex-col items-center">
            <svg
              className="w-10 h-10 text-slate-400 mb-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
            <p className="text-sm font-medium text-slate-700">
              {file ? file.name : "Drag & drop your CSV file here, or click to browse"}
            </p>
            <p className="text-xs text-slate-400 mt-1">Accepts CSV files up to 25MB</p>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={!file || loading}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-md text-sm transition"
          >
            {loading ? "Processing Upload..." : "Import Statement"}
          </button>
        </div>
      </form>
    </div>
  );
}
