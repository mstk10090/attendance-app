// src/App.jsx
import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  NavLink,
  Navigate,
} from "react-router-dom";

import Home from "./pages/Home";
import ShiftRequest from "./pages/ShiftRequest";
import MyPage from "./pages/MyPage";
import ShiftDetail from "./pages/ShiftDetail";
import Login from "./pages/Login";
import AdminUser from "./pages/AdminUser";
import RequireAdmin from "./components/RequireAdmin";

import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminShifts from "./pages/admin/AdminShifts";
import AdminShiftsDetail from "./pages/admin/AdminShiftsDetail";
import AdminFixedShifts from "./pages/admin/AdminFixedShifts";
import AdminAttendance from "./pages/admin/AdminAttendance";
import AdminHistory from "./pages/admin/AdminHistory";
import AdminManual from "./pages/admin/AdminManual";
import StaffManual from "./pages/StaffManual";
import ShiftGantt from "./pages/ShiftGantt";

import AdminShiftManagement from "./pages/admin/AdminShiftManagement"; // New Component

import Attendance from "./pages/Attendance";

import "./ripple.css";
import "./App.css";

import { ALLOWED_IPS } from "./constants"; // IPリスト


export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // IP Restriction State
  const [ipStatus, setIpStatus] = useState("loading"); // "loading" | "allowed" | "denied"
  const [clientIp, setClientIp] = useState("");

  useEffect(() => {
    // Check if device is allowed via URL param
    const params = new URLSearchParams(window.location.search);
    if (params.get("allow_device") === "true") {
      localStorage.setItem("device_allowed", "true");
      alert("このデバイスからのアクセスを許可しました。");
      // Clean URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    // Check IP
    const checkIp = async () => {
      // 1. Check Device Bypass
      if (localStorage.getItem("device_allowed") === "true") {
        setIpStatus("allowed");
        return;
      }

      try {
        const res = await fetch("https://api.ipify.org?format=json");
        const data = await res.json();
        const ip = data.ip;
        setClientIp(ip);

        // Check against allowed list
        if (ALLOWED_IPS.includes(ip)) {
          setIpStatus("allowed");
        } else {
          setIpStatus("denied");
        }
      } catch (e) {
        console.error("IP check failed", e);
        // Fallback: If check fails, maybe deny or allow? 
        // Strict security -> Deny. 
        setIpStatus("denied");
      }
    };
    checkIp();
  }, []);

  useEffect(() => {
    const flag = localStorage.getItem("isLoggedIn");
    if (flag === "true") {
      setIsLoggedIn(true);
    }
  }, []);

  // 自動ログアウト（5分無操作）
  const AUTO_LOGOUT_MS = 5 * 60 * 1000; // 5分
  const logoutTimerRef = useRef(null);

  const resetLogoutTimer = useCallback(() => {
    // 管理者は自動ログアウトしない
    if (localStorage.getItem("role") === "admin") {
      if (logoutTimerRef.current) {
        clearTimeout(logoutTimerRef.current);
      }
      return;
    }
    if (logoutTimerRef.current) {
      clearTimeout(logoutTimerRef.current);
    }
    localStorage.setItem("lastActivity", Date.now().toString());
    logoutTimerRef.current = setTimeout(() => {
      // 自動ログアウト実行
      localStorage.removeItem("isLoggedIn");
      localStorage.removeItem("userId");
      localStorage.removeItem("loginId");
      localStorage.removeItem("userName");
      localStorage.removeItem("hourlyWage");
      localStorage.removeItem("token");
      localStorage.removeItem("role");
      localStorage.removeItem("lastActivity");
      setIsLoggedIn(false);
      alert("30分間操作がなかったため、自動ログアウトしました。");
    }, AUTO_LOGOUT_MS);
  }, []);

  useEffect(() => {
    if (!isLoggedIn) {
      if (logoutTimerRef.current) {
        clearTimeout(logoutTimerRef.current);
      }
      return;
    }

    // 管理者は自動ログアウトしない
    if (localStorage.getItem("role") === "admin") return;

    // 他タブでのログアウトチェック
    const lastActivity = localStorage.getItem("lastActivity");
    if (lastActivity && Date.now() - parseInt(lastActivity) > AUTO_LOGOUT_MS) {
      localStorage.removeItem("isLoggedIn");
      localStorage.removeItem("lastActivity");
      setIsLoggedIn(false);
      return;
    }

    // 操作イベントを監視
    const events = ["mousemove", "keydown", "click", "touchstart", "scroll"];
    events.forEach(evt => window.addEventListener(evt, resetLogoutTimer));
    resetLogoutTimer(); // 初期化

    return () => {
      events.forEach(evt => window.removeEventListener(evt, resetLogoutTimer));
      if (logoutTimerRef.current) {
        clearTimeout(logoutTimerRef.current);
      }
    };
  }, [isLoggedIn, resetLogoutTimer]);

  // Show Loading
  if (ipStatus === "loading") {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", flexDirection: "column" }}>
        <p>Checking Access Permission...</p>
      </div>
    );
  }

  // Show Denied
  if (ipStatus === "denied") {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", flexDirection: "column", color: "#d32f2f" }}>
        <h1>Access Denied</h1>
        <p>このIPアドレス({clientIp})からのアクセスは許可されていません。</p>
      </div>
    );
  }

  const handleLoginSuccess = () => {
    setIsLoggedIn(true);
    localStorage.setItem("isLoggedIn", "true");
  };

  const handleLogout = () => {
    localStorage.removeItem("isLoggedIn");
    localStorage.removeItem("userId");
    localStorage.removeItem("loginId");
    localStorage.removeItem("userName");
    localStorage.removeItem("hourlyWage");
    localStorage.removeItem("token");
    localStorage.removeItem("role");
    setIsLoggedIn(false);
  };

  const navLinkClass = ({ isActive }) =>
    "tab-link" + (isActive ? " tab-link-active" : "");

  const isAdmin =
    isLoggedIn && localStorage.getItem("role") === "admin";

  return (
    <Router>
      {/* ===== ナビゲーションバー ===== */}
      {isLoggedIn && (
        <nav
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            backgroundColor: isAdmin ? "#ed6c02" : "#1976d2",
            height: "60px",
            padding: "0 12px",
            color: "#fff",
          }}
        >
          {/* 画面種別 */}
          <div
            style={{
              fontWeight: "bold",
              marginRight: "16px",
              padding: "4px 10px",
              borderRadius: "6px",
              background: "rgba(255,255,255,0.2)",
              fontSize: "13px",
              whiteSpace: "nowrap",
            }}
          >
            {isAdmin ? "管理者画面" : "一般ユーザー画面"}
          </div>

          {/* ===== 管理者ナビ ===== */}
          {isAdmin ? (
            <>
              <div className="tab">
                <NavLink
                  to="/admin/manual"
                  className={navLinkClass}
                >
                  操作マニュアル
                </NavLink>
              </div>

              <div className="tab">
                <NavLink
                  to="/admin/attendance"
                  className={navLinkClass}
                >
                  勤怠管理
                </NavLink>
              </div>

              <div className="tab">
                <NavLink
                  to="/admin/shift"
                  className={navLinkClass}
                >
                  シフト管理
                </NavLink>
              </div>

              <div className="tab">
                <NavLink
                  to="/admin/history"
                  className={navLinkClass}
                >
                  個人履歴
                </NavLink>
              </div>

              {/* <div className="tab">
                <NavLink to="/admin/fixed" className={navLinkClass}>
                  確定シフト
                </NavLink>
              </div> */}

              {/* <div className="tab">
                <NavLink to="/admin/shifts" className={navLinkClass}>
                  シフト編集
                </NavLink>
              </div> */}

              <div className="tab">
                <NavLink to="/admin/users" className={navLinkClass}>
                  スタッフ管理
                </NavLink>
              </div>

              <button
                onClick={handleLogout}
                style={{
                  marginLeft: "auto",
                  padding: "8px 16px",
                  border: "none",
                  borderRadius: "6px",
                  background: "#d32f2f",
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                ログアウト
              </button>
            </>
          ) : (
            /* ===== スタッフナビ ===== */
            <>
              <div className="tab">
                <NavLink
                  to="/manual"
                  className={navLinkClass}
                >
                  操作マニュアル
                </NavLink>
              </div>

              <div className="tab">
                <NavLink
                  to="/attendance"
                  className={navLinkClass}
                >
                  出退勤入力
                </NavLink>
              </div>

              <div className="tab">
                <NavLink
                  to="/shift"
                  className={navLinkClass}
                >
                  シフト管理
                </NavLink>
              </div>

              {/* <div className="tab">
                <NavLink to="/" className={navLinkClass}>
                  確定シフト
                </NavLink>
              </div> */}

              {/* <div className="tab">
                <NavLink to="/request" className={navLinkClass}>
                  希望シフト
                </NavLink>
              </div> */}

              <div className="tab">
                <NavLink to="/mypage" className={navLinkClass}>
                  マイページ
                </NavLink>
              </div>

              <button
                onClick={handleLogout}
                style={{
                  marginLeft: "auto",
                  padding: "8px 16px",
                  border: "none",
                  borderRadius: "6px",
                  background: "#d32f2f",
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                ログアウト
              </button>
            </>
          )}
        </nav>
      )}

      {/* ===== メイン ===== */}
      <div
        style={{
          marginTop: isLoggedIn ? "60px" : 0,
          padding: "0 16px",
        }}
      >
        <Routes>
          {!isLoggedIn ? (
            <>
              <Route
                path="/login"
                element={<Login onLogin={handleLoginSuccess} />}
              />
              <Route
                path="*"
                element={<Login onLogin={handleLoginSuccess} />}
              />
            </>
          ) : isAdmin ? (
            <>
              {/* ===== 管理者ルート ===== */}
              {/* 管理TOPは非表示 -> 勤怠管理へリダイレクト */}
              <Route
                path="/admin"
                element={<Navigate to="/admin/attendance" replace />}
              />

              <Route
                path="/admin/attendance"
                element={
                  <RequireAdmin>
                    <AdminAttendance />
                  </RequireAdmin>
                }
              />

              <Route
                path="/admin/history"
                element={
                  <RequireAdmin>
                    <AdminHistory />
                  </RequireAdmin>
                }
              />

              <Route
                path="/admin/shift"
                element={
                  <RequireAdmin>
                    <AdminShiftManagement />
                  </RequireAdmin>
                }
              />

              <Route
                path="/admin/manual"
                element={
                  <RequireAdmin>
                    <AdminManual />
                  </RequireAdmin>
                }
              />

              <Route
                path="/admin/users"
                element={
                  <RequireAdmin>
                    <AdminUser />
                  </RequireAdmin>
                }
              />

              <Route
                path="/admin/shifts"
                element={
                  <RequireAdmin>
                    <AdminShifts />
                  </RequireAdmin>
                }
              />

              <Route
                path="/admin/shifts/:date"
                element={
                  <RequireAdmin>
                    <AdminShiftsDetail />
                  </RequireAdmin>
                }
              />

              <Route
                path="/admin/fixed"
                element={
                  <RequireAdmin>
                    <AdminFixedShifts />
                  </RequireAdmin>
                }
              />

              <Route path="/" element={<Navigate to="/admin/attendance" replace />} />
              <Route path="*" element={<Navigate to="/admin/attendance" replace />} />
            </>
          ) : (
            <>
              {/* ===== スタッフルート ===== */}
              {/* 確定シフト(HOME)非表示 -> 出退勤へリダイレクト */}
              <Route path="/" element={<Navigate to="/attendance" replace />} />
              <Route path="/request" element={<ShiftRequest />} />
              <Route
                path="/mypage"
                element={<MyPage onLogout={handleLogout} />}
              />
              <Route path="/shift/:date" element={<ShiftDetail />} />
              <Route path="/attendance" element={<Attendance />} />
              <Route path="/shift" element={<ShiftGantt />} />
              <Route path="/manual" element={<StaffManual />} />
              <Route path="*" element={<Navigate to="/attendance" replace />} />
            </>
          )}
        </Routes>
      </div>

    </Router >
  );
}
