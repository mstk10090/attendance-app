// src/App.jsx
import React, { useState, useEffect } from "react";
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

import Attendance from "./pages/Attendance";

import "./ripple.css";
import "./App.css";

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    const flag = localStorage.getItem("isLoggedIn");
    if (flag === "true") {
      setIsLoggedIn(true);
    }
  }, []);

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
              {/* <div className="tab">
                <NavLink to="/admin" className={navLinkClass}>
                  管理TOP
                </NavLink>
              </div> */}

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
                  to="/attendance"
                  className={navLinkClass}
                >
                  出退勤入力
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
              <Route path="*" element={<Navigate to="/attendance" replace />} />
            </>
          )}
        </Routes>
      </div>
    </Router>
  );
}
