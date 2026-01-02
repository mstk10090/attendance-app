// src/App.jsx
import React, { useState, useEffect } from "react";
import { BrowserRouter as Router, Routes, Route, NavLink } from "react-router-dom";

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
import Attendance from "./pages/Attendance";


import "./ripple.css";
import "./App.css";

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // ログイン状態を復元
  useEffect(() => {
    const stored = localStorage.getItem("isLoggedIn");
    if (stored === "true") {
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
    localStorage.removeItem("userName");
    localStorage.removeItem("hourlyWage");
    setIsLoggedIn(false);
  };

  return (
    <Router>
      {/* ログイン後だけナビバーを表示 */}
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
          <div className="tab">
            <NavLink to="/" className="tab-link">
              確定シフト
            </NavLink>
          </div>

          <div className="tab">
            <NavLink to="/request" className="tab-link">
              希望シフト
            </NavLink>
          </div>

          <div className="tab">
            <NavLink to="/mypage" className="tab-link">
              マイページ
            </NavLink>
          </div>

          <div className="tab">
            <NavLink to="/admin" className="tab-link">
              管理者
            </NavLink>
          </div>

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
                <NavLink to="/attendance" className={navLinkClass}>
                  出退勤入力
                </NavLink>
              </div>
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
          {/* 未ログインなら全て Login を表示 */}
          {!isLoggedIn ? (
            <>
              <Route
                path="*"
                element={<Login onLogin={handleLoginSuccess} />}
              />
            </>
          ) : (
            <>
              <Route path="/" element={<Home />} />
              <Route path="/request" element={<ShiftRequest />} />
              <Route path="/mypage" element={<MyPage onLogout={handleLogout} />} />

              <Route path="/attendance" element={<Attendance />} />
              <Route
                path="/mypage"
                element={<MyPage onLogout={handleLogout} />}
              />

              <Route path="/shift/:date" element={<ShiftDetail />} />
              <Route path="/admin" element={<AdminUser />} />

              {/* ログイン後に login に来た場合は Home に戻す */}
              <Route path="/login" element={<Home />} />
            </>
          )}
        </Routes>
      </div>
    </Router>
  );
}
