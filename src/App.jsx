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
import AdminAttendanceSheet from "./pages/admin/AdminAttendanceSheet"; // 勤怠確認シート

import Attendance from "./pages/Attendance";
import StaffReport from "./pages/StaffReport";

import "./ripple.css";
import "./App.css";

import { ALLOWED_IPS } from "./constants"; // IPリスト


export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(() => localStorage.getItem("isLoggedIn") === "true");

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

    checkIpAccess();
  }, []);

  // IP Check with retry and fallback
  const checkIpAccess = async () => {
    setIpStatus("loading");

    // 1. localhostからのアクセスは常に許可
    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
      setIpStatus("allowed");
      return;
    }

    // 2. Check Device Bypass
    if (localStorage.getItem("device_allowed") === "true") {
      setIpStatus("allowed");
      return;
    }

    // IP取得サービスのリスト（フォールバック用）
    const IP_SERVICES = [
      "https://api.ipify.org?format=json",
      "https://api.myip.com",
      "https://ipinfo.io/json",
    ];

    for (let attempt = 0; attempt < IP_SERVICES.length; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000); // 8秒タイムアウト

        const res = await fetch(IP_SERVICES[attempt], { signal: controller.signal });
        clearTimeout(timeoutId);
        const data = await res.json();
        const ip = data.ip;
        setClientIp(ip);

        if (ALLOWED_IPS.includes(ip)) {
          setIpStatus("allowed");
          return;
        } else {
          setIpStatus("denied");
          return;
        }
      } catch (e) {
        console.warn(`IP check attempt ${attempt + 1} failed (${IP_SERVICES[attempt]}):`, e);
        if (attempt === IP_SERVICES.length - 1) {
          // 全サービス失敗 → ネットワーク不安定なのでアクセス許可（セキュリティよりUX優先）
          console.warn("All IP check services failed. Allowing access as fallback.");
          setIpStatus("allowed");
        }
      }
    }
  };


  // 自動ログアウト（5分無操作）
  const AUTO_LOGOUT_MS = 5 * 60 * 1000; // 5分
  const logoutTimerRef = useRef(null);
  const loginTimestampRef = useRef(null); // ログイン成功時刻を記録

  const resetLogoutTimer = useCallback(() => {
    // 管理者は自動ログアウトしない
    if (localStorage.getItem("role") === "admin" || localStorage.getItem("role") === "super_admin") {
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
      alert("5分間操作がなかったため、自動ログアウトしました。");
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
    if (localStorage.getItem("role") === "admin" || localStorage.getItem("role") === "super_admin") return;

    // ログイン直後（3秒以内）は古いlastActivityでのログアウト判定をスキップ
    const loginTs = loginTimestampRef.current;
    const isJustLoggedIn = loginTs && (Date.now() - loginTs < 3000);

    if (!isJustLoggedIn) {
      // 他タブでのログアウトチェック（ログイン直後でない場合のみ）
      const lastActivity = localStorage.getItem("lastActivity");
      if (lastActivity) {
        const elapsed = Date.now() - parseInt(lastActivity);
        if (elapsed > AUTO_LOGOUT_MS) {
          localStorage.removeItem("isLoggedIn");
          localStorage.removeItem("lastActivity");
          setIsLoggedIn(false);
          return;
        }
      }
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
        <p style={{ fontSize: "16px", color: "#666" }}>🔄 接続確認中...</p>
      </div>
    );
  }

  // Show Denied
  if (ipStatus === "denied") {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", flexDirection: "column", color: "#d32f2f" }}>
        <h1>Access Denied</h1>
        <p>このIPアドレス({clientIp})からのアクセスは許可されていません。</p>
        <button
          onClick={checkIpAccess}
          style={{
            marginTop: "16px",
            padding: "12px 24px",
            border: "none",
            borderRadius: "8px",
            background: "#1976d2",
            color: "#fff",
            fontSize: "16px",
            cursor: "pointer",
            fontWeight: "bold"
          }}
        >
          🔄 再試行
        </button>
        <p style={{ color: "#666", fontSize: "13px", marginTop: "12px" }}>
          Wi-Fiに接続してから再試行してください
        </p>
      </div>
    );
  }

  const handleLoginSuccess = () => {
    // ★ 自動ログアウトの誤判定防止
    const now = Date.now();
    loginTimestampRef.current = now; // ログイン時刻を記録
    localStorage.setItem("lastActivity", now.toString());
    localStorage.setItem("isLoggedIn", "true");
    setIsLoggedIn(true);
    // ログイン後は必ず出退勤入力ページへ遷移（roleベースで判定）
    const currentRole = localStorage.getItem("role");
    const isAdminUser = currentRole === "admin" || currentRole === "super_admin";
    const targetPath = isAdminUser ? "/admin/attendance" : "/attendance";
    if (window.location.pathname !== targetPath) {
      window.history.replaceState(null, "", targetPath);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("isLoggedIn");
    localStorage.removeItem("userId");
    localStorage.removeItem("loginId");
    localStorage.removeItem("userName");
    localStorage.removeItem("hourlyWage");
    localStorage.removeItem("token");
    localStorage.removeItem("role");
    localStorage.removeItem("lastActivity");
    loginTimestampRef.current = null;
    setIsLoggedIn(false);
  };

  const navLinkClass = ({ isActive }) =>
    "tab-link" + (isActive ? " tab-link-active" : "");

  const role = localStorage.getItem("role");
  const isAdmin =
    isLoggedIn && (role === "admin" || role === "super_admin");

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
            backgroundColor: role === "super_admin" ? "#cc1237" : isAdmin ? "#ed6c02" : "#1976d2",
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
                  to="/admin/history"
                  className={navLinkClass}
                >
                  レポート
                </NavLink>
              </div>

              <div className="tab">
                <NavLink
                  to="/admin/sheet"
                  className={navLinkClass}
                >
                  勤怠確認
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
                  to="/attendance"
                  className={navLinkClass}
                >
                  出退勤入力
                </NavLink>
              </div>

              <div className="tab">
                <NavLink
                  to="/report"
                  className={navLinkClass}
                >
                  レポート
                </NavLink>
              </div>

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
                path="/admin/sheet"
                element={
                  <RequireAdmin>
                    <AdminAttendanceSheet />
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
              <Route path="/report" element={<StaffReport />} />
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
