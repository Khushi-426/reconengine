import React, { useState } from "react";
import { uploadFile } from "../api/client.js";
import { useAuth } from "../api/AuthContext.jsx";
import { Button, Alert } from "../components/common.jsx";

export default function UploadStatement() {
  const { user } = useAuth();
  const [file, setFile] = useState(null);
  const [sourceId, setSourceId] = useState("2"); // Default SWIFT_MT940
  const [importType, setImportType] = useState("external");
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
      const res = await uploadFile(
        importType === "internal" ? "/imports/ledger" : "/imports/statements",
        file,
        importType === "internal" ? {} : { sourceId }
      );
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
    <div className="max-w-xl mx-auto p-6 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 shadow-xs mt-4">
      <div className="border-b border-slate-100 dark:border-slate-800 pb-3 mb-5">
        <h2 className="text-base font-bold text-slate-900 dark:text-white">Ingest Statement Feed</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Atomically upload external settlement files or new internal ledger transaction batches.
        </p>
      </div>

      {successMsg && (
        <Alert variant="success" className="mb-5">
          {successMsg}
        </Alert>
      )}

      {generalError && (
        <Alert variant="error" className="mb-5">
          {generalError}
        </Alert>
      )}

      {errors.length > 0 && (
        <Alert variant="error" className="mb-5 max-h-60 overflow-y-auto">
          <p className="font-semibold text-xs mb-2">CSV Line Validation Failed ({errors.length} errors):</p>
          <ul className="list-disc pl-4 space-y-1 font-mono text-[11px]">
            {errors.map((err, idx) => (
              <li key={idx}>{err}</li>
            ))}
          </ul>
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
            Ingestion Target
          </label>
          <select
            value={importType}
            onChange={(e) => setImportType(e.target.value)}
            className="w-full border border-slate-300 dark:border-slate-700 rounded px-3 py-2 text-xs bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-slate-900 dark:focus:ring-slate-300"
          >
            <option value="external">External settlement statement</option>
            {user?.role === "ADMIN" && <option value="internal">Internal ledger (new immutable batch)</option>}
          </select>
        </div>

        {importType === "external" && (
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
              Settlement Protocol / Source
            </label>
            <select
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
              className="w-full border border-slate-300 dark:border-slate-700 rounded px-3 py-2 text-xs bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-slate-900 dark:focus:ring-slate-300 font-mono"
            >
              <option value="2">SWIFT_MT940 (Source ID: 2)</option>
              <option value="3">CARD_NETWORK (Source ID: 3)</option>
            </select>
          </div>
        )}

        {importType === "internal" && (
          <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-300 rounded text-xs">
            <strong>Financial Invariant:</strong> Ledger uploads append a new immutable batch. Previously reconciled ledger rows cannot be overwritten or deleted.
          </div>
        )}

        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition ${
            isDragOver ? "border-slate-800 bg-slate-50 dark:bg-slate-950" : "border-slate-300 dark:border-slate-700 hover:border-slate-400"
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
              className="w-8 h-8 text-slate-400 dark:text-slate-500 mb-2"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              {file ? file.name : "Select or drag & drop CSV file"}
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">Maximum file size: 25MB</p>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={!file || loading}
            loading={loading}
          >
            {loading ? "Processing..." : importType === "internal" ? "Import Ledger Batch" : "Import Statement"}
          </Button>
        </div>
      </form>
    </div>
  );
}
