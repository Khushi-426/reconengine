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

function ProtectedRoute({ children }) {
  const { user, initializing } = useAuth();
  if (initializing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900"></div>
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

  const fetchUnreadCount = useCallback(async () => {
    try {
      const res = await api.get("/notifications/unread-count");
      setUnreadCount(res.count);
    } catch (err) {
      console.error("Failed to fetch unread notifications count", err);
    }
  }, []);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await api.get("/notifications?pageSize=5");
      setNotifications(res.data || []);
    } catch (err) {
      console.error("Failed to fetch notifications list", err);
    }
  }, []);

  useEffect(() => {
    if (user) {
      fetchUnreadCount();
      const timer = setInterval(fetchUnreadCount, 15000); // Poll count
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
      console.error("Failed to mark notification read", err);
    }
  }

  async function handleMarkAllRead() {
    try {
      await api.post("/notifications/read-all");
      fetchUnreadCount();
      fetchNotifications();
    } catch (err) {
      console.error("Failed to mark all notifications read", err);
    }
  }

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
          {/* Notifications Icon & Dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowDropdown(!showDropdown)}
              className="relative p-1.5 rounded-full hover:bg-slate-800 transition text-slate-300 hover:text-white focus:outline-none"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              {unreadCount > 0 && (
                <span className="absolute top-0 right-0 bg-red-600 text-white rounded-full text-[9px] w-4 h-4 flex items-center justify-center font-bold font-mono border border-slate-900">
                  {unreadCount}
                </span>
              )}
            </button>

            {showDropdown && (
              <div className="absolute right-0 mt-2 w-80 bg-white border border-slate-200 rounded-lg shadow-xl text-slate-800 py-1 z-50 overflow-hidden">
                <div className="px-4 py-2 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                  <span className="font-semibold text-xs text-slate-700">Notifications</span>
                  {unreadCount > 0 && (
                    <button
                      onClick={handleMarkAllRead}
                      className="text-[10px] text-blue-600 hover:underline font-semibold"
                    >
                      Mark all as read
                    </button>
                  )}
                </div>
                <div className="max-h-60 overflow-y-auto divide-y divide-slate-100">
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
                        className={`px-4 py-3 hover:bg-slate-50 transition cursor-pointer text-left ${
                          !n.is_read ? "bg-blue-50/20" : ""
                        }`}
                      >
                        {n.link ? (
                          <Link to={n.link} className="block">
                            <p className="text-xs font-semibold text-slate-800">{n.title}</p>
                            <p className="text-[11px] text-slate-600 mt-0.5">{n.message}</p>
                            <p className="text-[9px] text-slate-400 mt-1 font-mono">
                              {new Date(n.created_at).toLocaleString([], { hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </Link>
                        ) : (
                          <div>
                            <p className="text-xs font-semibold text-slate-800">{n.title}</p>
                            <p className="text-[11px] text-slate-600 mt-0.5">{n.message}</p>
                            <p className="text-[9px] text-slate-400 mt-1 font-mono">
                              {new Date(n.created_at).toLocaleString([], { hour: '2-digit', minute: '2-digit' })}
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
