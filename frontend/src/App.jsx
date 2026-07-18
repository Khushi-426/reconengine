import React from "react";
import { Routes, Route, Navigate, Link, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./api/AuthContext.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import ExceptionsDashboard from "./pages/ExceptionsDashboard.jsx";
import UploadStatement from "./pages/UploadStatement.jsx";
import ImportHistory from "./pages/ImportHistory.jsx";
import RunHistory from "./pages/RunHistory.jsx";
import Analytics from "./pages/Analytics.jsx";

function ProtectedRoute({ children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function DashboardLayout({ children }) {
  const { user, logout } = useAuth();
  const location = useLocation();

  const navItems = [
    { name: "Exceptions Queue", path: "/exceptions" },
    { name: "Ingest Statement", path: "/upload" },
    { name: "Import History", path: "/history" },
    { name: "Reconciliation Runs", path: "/runs" },
    { name: "Analytics & Trends", path: "/analytics" },
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Top Navbar */}
      <header className="bg-slate-900 text-white px-6 py-4 flex justify-between items-center shadow-md">
        <div className="flex items-center gap-8">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white">ReconEngine</h1>
            <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">Transaction Reconciliation</p>
          </div>
          <nav className="hidden md:flex gap-1">
            {navItems.map((item) => {
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
                    isActive
                      ? "bg-slate-800 text-white"
                      : "text-slate-300 hover:bg-slate-800 hover:text-white"
                  }`}
                >
                  {item.name}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-medium text-slate-200">{user?.fullName}</p>
            <p className="text-xs text-slate-400 font-mono">{user?.role}</p>
          </div>
          <button
            onClick={logout}
            className="text-xs bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded text-slate-300 hover:text-white transition font-medium border border-slate-700"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 p-6 max-w-7xl w-full mx-auto">
        {children}
      </main>
    </div>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/exceptions"
        element={
          <ProtectedRoute>
            <DashboardLayout>
              <ExceptionsDashboard />
            </DashboardLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/upload"
        element={
          <ProtectedRoute>
            <DashboardLayout>
              <UploadStatement />
            </DashboardLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/history"
        element={
          <ProtectedRoute>
            <DashboardLayout>
              <ImportHistory />
            </DashboardLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/runs"
        element={
          <ProtectedRoute>
            <DashboardLayout>
              <RunHistory />
            </DashboardLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/analytics"
        element={
          <ProtectedRoute>
            <DashboardLayout>
              <Analytics />
            </DashboardLayout>
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/exceptions" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
