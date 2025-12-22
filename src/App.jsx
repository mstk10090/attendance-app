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
import AdminShiftsDetail from "./pages/admin/AdminShiftsDetail"; // ★ 追加
import AdminFixedShifts from "./pages/admin/AdminFixedShifts";


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

  const isAdmin = isLoggedIn && localStorage.getItem("role") === "admin";

  return (
    <Router>
      {/* ログイン済みナビ */}
      {isLoggedIn && (
        <nav
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 1000,
            display: "flex",
            backgroundColor: "#1976d2",
            height: "60px",
          }}
        >
          {isAdmin ? (
            <>
              <div className="tab">
                <NavLink to="/admin" className={navLinkClass}>
                  管理TOP
                </NavLink>
              </div>
              <div className="tab">
                <NavLink to="/admin/fixed" className={navLinkClass}>
                  確定シフト
                </NavLink>
              </div>
              <div className="tab">
                <NavLink to="/admin/shifts" className={navLinkClass}>
                  シフト編集
                </NavLink>
              </div>
              <div className="tab">
                <NavLink to="/admin/users" className={navLinkClass}>
                  スタッフ管理
                </NavLink>
              </div>
              <button
                onClick={handleLogout}
                style={{
                  marginLeft: "auto",
                  padding: "0 16px",
                  border: "none",
                  background: "#d32f2f",
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                ログアウト
              </button>
            </>
          ) : (
            <>
              <div className="tab">
                <NavLink to="/" className={navLinkClass}>
                  確定シフト
                </NavLink>
              </div>
              <div className="tab">
                <NavLink to="/request" className={navLinkClass}>
                  希望シフト
                </NavLink>
              </div>
              <div className="tab">
                <NavLink to="/mypage" className={navLinkClass}>
                  マイページ
                </NavLink>
              </div>
            </>
          )}
        </nav>
      )}

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
              {/* ===== 管理者用ルート ===== */}
              <Route
                path="/admin"
                element={
                  <RequireAdmin>
                    <AdminDashboard />
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
              {/* ★ ここが日別ガントチャート */}
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


              {/* 管理者で / や /login に来たら /admin へ */}
              <Route path="/" element={<Navigate to="/admin" replace />} />
              <Route path="/login" element={<Navigate to="/admin" replace />} />
              <Route path="*" element={<Navigate to="/admin" replace />} />
            </>
          ) : (
            <>
              {/* ===== スタッフ用ルート ===== */}
              <Route path="/" element={<Home />} />
              <Route path="/request" element={<ShiftRequest />} />
              <Route
                path="/mypage"
                element={<MyPage onLogout={handleLogout} />}
              />
              <Route path="/shift/:date" element={<ShiftDetail />} />
              <Route path="/login" element={<Navigate to="/" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />

            </>

          )}
        </Routes>
      </div>
    </Router>
  );
}
