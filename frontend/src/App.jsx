import React, { useEffect, useState, useCallback } from "react";
import { Routes, Route, Navigate, Link, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./api/AuthContext.jsx";
import { api } from "./api/client.js";
import LoginPage from "./pages/LoginPage.jsx";
import ExceptionsDashboard from "./pages/ExceptionsDashboard.jsx";
import UploadStatement from "./pages/UploadStatement.jsx";
import ImportHistory from "./pages/ImportHistory.jsx";
import RunHistory from "./pages/RunHistory.jsx";
import Analytics from "./pages/Analytics.jsx";
import { Button } from "./components/common.jsx";

function ProtectedRoute({ children }) {
  const { user, initializing } = useAuth();
  if (initializing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-300 border-t-slate-900 dark:border-slate-700 dark:border-t-white"></div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function DashboardLayout({ children }) {
  const { user, logout } = useAuth();
  const location = useLocation();

  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem("recon_theme") || "light");

  // Sync theme
  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    localStorage.setItem("recon_theme", theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === "light" ? "dark" : "light"));

  const fetchUnreadCount = useCallback(async () => {
    try {
      const res = await api.get("/notifications/unread-count");
      setUnreadCount(res.count);
    } catch {
      // Non-critical background poll
    }
  }, []);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await api.get("/notifications?pageSize=5");
      setNotifications(res.data || []);
    } catch {
      // Non-critical
    }
  }, []);

  useEffect(() => {
    if (user) {
      fetchUnreadCount();
      const timer = setInterval(fetchUnreadCount, 15000);
      return () => clearInterval(timer);
    }
  }, [user, fetchUnreadCount]);

  useEffect(() => {
    if (showDropdown) {
      fetchNotifications();
    }
  }, [showDropdown, fetchNotifications]);

  async function handleMarkRead(notificationId) {
    try {
      await api.patch(`/notifications/${notificationId}/read`);
      fetchUnreadCount();
      fetchNotifications();
    } catch (err) {
      console.error(err);
    }
  }

  async function handleMarkAllRead() {
    try {
      await api.post("/notifications/read-all");
      fetchUnreadCount();
      fetchNotifications();
    } catch (err) {
      console.error(err);
    }
  }

  const navItems = [
    { name: "Exceptions Queue", path: "/exceptions" },
    { name: "Reconciliation Runs", path: "/runs" },
    { name: "Operations Analytics", path: "/analytics" },
    { name: "Ingest Statement", path: "/upload" },
    { name: "Import Batches", path: "/history" },
  ];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col text-slate-800 dark:text-slate-100">
      {/* Top Application Header */}
      <header className="bg-slate-950 text-white border-b border-slate-800 px-5 py-3 flex justify-between items-center shadow-xs">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded bg-slate-100 text-slate-950 font-black flex items-center justify-center text-xs font-mono">
              R
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight text-white leading-none">ReconEngine</h1>
              <p className="text-[9px] text-slate-400 font-mono uppercase tracking-wider mt-0.5">Financial Operations</p>
            </div>
          </div>

          <nav className="hidden md:flex gap-1">
            {navItems.map((item) => {
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`px-2.5 py-1.5 rounded text-xs font-medium transition ${
                    isActive
                      ? "bg-slate-800 text-white font-semibold"
                      : "text-slate-400 hover:bg-slate-850 hover:text-slate-200"
                  }`}
                >
                  {item.name}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          {/* Theme Toggle Button */}
          <button
            onClick={toggleTheme}
            className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition text-xs"
            title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
            aria-label="Toggle visual theme"
          >
            {theme === "light" ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 9H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            )}
          </button>

          {/* Notifications Dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowDropdown(!showDropdown)}
              className="relative p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition focus:outline-none"
              aria-label="Notifications"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 bg-rose-600 text-white rounded-full text-[9px] w-3.5 h-3.5 flex items-center justify-center font-bold font-mono">
                  {unreadCount}
                </span>
              )}
            </button>

            {showDropdown && (
              <div className="absolute right-0 mt-2 w-80 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl text-slate-800 dark:text-slate-200 py-1 z-50 overflow-hidden">
                <div className="px-3.5 py-2 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-950">
                  <span className="font-semibold text-xs text-slate-700 dark:text-slate-300">Audit Alerts</span>
                  {unreadCount > 0 && (
                    <button
                      onClick={handleMarkAllRead}
                      className="text-[10px] text-blue-600 hover:underline font-semibold"
                    >
                      Mark all read
                    </button>
                  )}
                </div>
                <div className="max-h-60 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                  {notifications.length === 0 ? (
                    <div className="px-4 py-6 text-center text-xs text-slate-400">
                      No notifications
                    </div>
                  ) : (
                    notifications.map((n) => (
                      <div
                        key={n.notification_id}
                        onClick={() => {
                          handleMarkRead(n.notification_id);
                          setShowDropdown(false);
                        }}
                        className={`px-3.5 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800 transition cursor-pointer text-left ${
                          !n.is_read ? "bg-blue-50/20 dark:bg-blue-950/20" : ""
                        }`}
                      >
                        {n.link ? (
                          <Link to={n.link} className="block">
                            <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">{n.title}</p>
                            <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">{n.message}</p>
                            <p className="text-[9px] text-slate-400 mt-1 font-mono">
                              {new Date(n.created_at).toLocaleString([], { hour: "2-digit", minute: "2-digit" })}
                            </p>
                          </Link>
                        ) : (
                          <div>
                            <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">{n.title}</p>
                            <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">{n.message}</p>
                            <p className="text-[9px] text-slate-400 mt-1 font-mono">
                              {new Date(n.created_at).toLocaleString([], { hour: "2-digit", minute: "2-digit" })}
                            </p>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* User & Role Badge */}
          <div className="text-right hidden sm:block">
            <p className="text-xs font-semibold text-slate-200 leading-none">{user?.fullName}</p>
            <p className="text-[10px] text-slate-400 font-mono mt-0.5">{user?.role}</p>
          </div>

          <Button
            variant="secondary"
            size="sm"
            onClick={logout}
            className="text-xs"
          >
            Sign out
          </Button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 p-5 md:p-6 max-w-7xl w-full mx-auto">
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
