import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../api/AuthContext.jsx";
import { Button, Alert } from "../components/common.jsx";

export default function LoginPage() {
  const { login, loading, error } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    try {
      await login(email, password);
      navigate("/exceptions");
    } catch {
      // error surfaced via auth context
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
      <div className="bg-white dark:bg-slate-900 shadow-xl border border-slate-200 dark:border-slate-800 rounded-lg p-8 w-full max-w-sm">
        <div className="flex items-center gap-2.5 mb-6">
          <div className="w-8 h-8 rounded bg-slate-900 dark:bg-white text-white dark:text-slate-950 font-black flex items-center justify-center text-sm font-mono">
            R
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight text-slate-900 dark:text-white leading-none">
              ReconEngine
            </h1>
            <p className="text-[10px] text-slate-500 font-mono uppercase tracking-wider mt-1">
              Transaction Reconciliation Platform
            </p>
          </div>
        </div>

        {error && (
          <Alert variant="error" className="mb-4 text-xs">
            {error}
          </Alert>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
              Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-slate-300 dark:border-slate-700 rounded px-3 py-2 text-xs bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-slate-900 dark:focus:ring-slate-300 font-mono"
              placeholder="approver@reconengine.local"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-slate-300 dark:border-slate-700 rounded px-3 py-2 text-xs bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-slate-900 dark:focus:ring-slate-300"
            />
          </div>

          <Button
            type="submit"
            variant="primary"
            size="md"
            loading={loading}
            className="w-full mt-2"
          >
            {loading ? "Authenticating..." : "Sign in"}
          </Button>
        </form>

        <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-400 text-center">
          Role-Based Access: Analyst, Approver, Auditor, Admin
        </div>
      </div>
    </div>
  );
}
