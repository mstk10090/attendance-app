import React, { useEffect, useState } from "react";
import { User, Wallet, Clock, Calendar, LogOut, Home, Gift, Award } from "lucide-react";
import { format, getDaysInMonth, isSaturday, isSunday, parseISO, differenceInYears, startOfMonth, endOfMonth, eachDayOfInterval } from "date-fns";
import "../App.css";

const API_BASE = "https://lfsu60xvw7.execute-api.ap-northeast-1.amazonaws.com";
const API_USER_URL = "https://cma9brof8g.execute-api.ap-northeast-1.amazonaws.com/prod/users";

// 簡易的な祝日リスト (2025-2026)
const HOLIDAYS = [
  "2025-01-01", "2025-01-13", "2025-02-11", "2025-02-23", "2025-02-24", "2025-03-20",
  "2025-04-29", "2025-05-03", "2025-05-04", "2025-05-05", "2025-05-06", "2025-07-21",
  "2025-08-11", "2025-09-15", "2025-09-23", "2025-10-13", "2025-11-03", "2025-11-23", "2025-11-24",
  "2026-01-01", "2026-01-12", "2026-02-11", "2026-02-23", "2026-03-21",
  // 必要に応じて追加
];

const isHoliday = (d) => {
  const s = format(d, "yyyy-MM-dd");
  return HOLIDAYS.includes(s);
};

const isWeekendOrHoliday = (d) => {
  return isSaturday(d) || isSunday(d) || isHoliday(d);
};

export default function MyPage({ onLogout }) {
  const userId = localStorage.getItem("userId") || "";
  const loginId = localStorage.getItem("loginId") || "-";
  const userName = localStorage.getItem("userName") || "-";
  const hourlyWage = Number(localStorage.getItem("hourlyWage") || 1000);

  const [stats, setStats] = useState({
    totalHours: 0,
    totalDays: 0,
    estimatedSalary: 0,
  });
  const [userInfo, setUserInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [bonuses, setBonuses] = useState([]);
  const [totalBonus, setTotalBonus] = useState(0);

  // --- Utility ---
  const toMin = (t) => {
    if (!t) return 0;
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };

  const calcBreakMin = (e) => {
    if (!e.breaks || e.breaks.length === 0) return 0;
    return e.breaks.reduce((acc, b) => {
      if (b.start && b.end) {
        let s = toMin(b.start);
        let E = toMin(b.end);
        if (E < s) E += 24 * 60; // 日跨ぎ対応
        return acc + (E - s);
      }
      return acc;
    }, 0);
  };

  const calcWorkMin = (e) => {
    if (!e.clockIn || !e.clockOut) return 0;
    let s = toMin(e.clockIn);
    let E = toMin(e.clockOut);
    if (E < s) E += 24 * 60; // 日跨ぎ対応

    // 休憩合計
    const brk = calcBreakMin(e);
    // 実働
    const total = (E - s) - brk;
    return Math.max(0, total);
  };

  const hasNightWork = (e) => {
    if (!e.clockIn || !e.clockOut) return false;
    let E = toMin(e.clockOut);
    // 深夜=22:00(1320分)以降
    // 退勤が日をまたいでいれば (E < s) 確実に深夜含む
    // そうでなくても 1320 を超えていれば深夜
    let s = toMin(e.clockIn);
    if (E < s) E += 24 * 60;
    return E > 1320;
  };

  useEffect(() => {
    const fetchData = async () => {
      if (!userId) {
        setLoading(false);
        return;
      }

      let fetchedUser = null;
      let fetchedItems = [];

      // 1. ユーザー情報の取得 (ボーナス判定に必要なので先に確保したいがパラレルでも可)
      try {
        const userRes = await fetch(`${API_USER_URL}?userId=${userId}`);
        if (userRes.ok) {
          const text = await userRes.text();
          let uData = null;
          try {
            const outer = JSON.parse(text);
            if (outer.body && typeof outer.body === "string") uData = JSON.parse(outer.body);
            else uData = outer;

            if (Array.isArray(uData) && uData.items) uData = uData.items.find(u => u.userId === userId) || null;
            else if (uData.Items) uData = uData.Items.find(u => u.userId === userId) || null;

            if (uData && (uData.userId === userId || uData.loginId === loginId)) fetchedUser = uData;
            else if (Array.isArray(outer)) fetchedUser = outer.find(u => u.userId === userId) || null;

            setUserInfo(fetchedUser);
          } catch (e) { /* ignore */ }
        }
      } catch (e) { console.warn("User fetch fail", e); }

      // 2. 勤怠データの取得
      try {
        const attRes = await fetch(`${API_BASE}/attendance?userId=${userId}`);
        if (attRes.ok) {
          const data = await attRes.json();
          if (data.success && Array.isArray(data.items)) {
            fetchedItems = data.items;
          }
        }
      } catch (e) { console.error("Attendance fetch error", e); }

      // --- 集計 & ボーナス計算 ---
      const now = new Date();
      const currentMonthPrefix = format(now, "yyyy-MM");

      // 今月のレコード抽出
      const currentItems = fetchedItems.filter(item =>
        item.workDate && item.workDate.startsWith(currentMonthPrefix)
      );

      // 基本集計
      let sumMin = 0;
      let days = 0;
      const attendedDates = new Set();
      let hasAnyNightWork = false;
      let weekendWorkCount = 0;

      currentItems.forEach(item => {
        const workMin = calcWorkMin(item);
        if (workMin > 0) {
          sumMin += workMin;
          days++;
          attendedDates.add(item.workDate);
          if (hasNightWork(item)) hasAnyNightWork = true;

          if (isWeekendOrHoliday(new Date(item.workDate))) {
            weekendWorkCount++;
          }
        }
      });

      const hours = sumMin / 60;
      setStats({
        totalHours: hours,
        totalDays: days,
        estimatedSalary: Math.floor(hours * hourlyWage)
      });

      // --- ボーナスロジック ---
      // 計算用日数定義
      const start = startOfMonth(now);
      const end = endOfMonth(now);
      const allDays = eachDayOfInterval({ start, end });

      let weekdayCount = 0;
      let weekendHolidayCount = 0;

      allDays.forEach(d => {
        if (isWeekendOrHoliday(d)) weekendHolidayCount++;
        else weekdayCount++;
      });

      const bonusList = [];
      let bTotal = 0;

      // 条件変数
      const isDispatch = fetchedUser?.employmentType === "派遣";
      const isRegular = fetchedUser?.employmentType === "正社員"; // 常勤扱い
      const yearsOfService = fetchedUser?.startDate
        ? differenceInYears(now, new Date(fetchedUser.startDate))
        : 0;
      const livingAlone = fetchedUser?.livingAlone === true;

      // 1. 常勤判定 (派遣でも規定日数(平日数)出勤で常勤扱い)
      // 「平日分の日数（規定日数）を月に出社していたら常勤とします」
      const isFullTimeEquivalent = days >= weekdayCount;
      const isTargetForHousing = isDispatch || isRegular || isFullTimeEquivalent;

      // --- 家賃手当ボーナス ---
      // 派遣or常勤(相当) で...
      if (isTargetForHousing && livingAlone) {
        if (yearsOfService >= 3) {
          bonusList.push({ name: "家賃手当 (3年以上)", amount: 50000 });
          bTotal += 50000;
        } else {
          bonusList.push({ name: "家賃手当 (3年未満)", amount: 30000 });
          bTotal += 30000;
        }
      }

      // --- 深夜手当 ---
      if (hasAnyNightWork) {
        bonusList.push({ name: "深夜勤務手当", amount: 10000 });
        bTotal += 10000;
      }

      // --- 派遣限定ボーナス ---
      if (isDispatch) {
        // 土日祝手当
        if (weekendWorkCount === weekendHolidayCount && weekendHolidayCount > 0) {
          bonusList.push({ name: "土日祝全出勤", amount: 20000 });
          bTotal += 20000;
        } else if (weekendWorkCount >= 5) {
          bonusList.push({ name: "土日祝手当 (5日以上)", amount: 10000 });
          bTotal += 10000;
        }

        // 18日出勤手当
        if (days >= 18) {
          bonusList.push({ name: "18日出勤手当", amount: 10000 });
          bTotal += 10000;
        }
      }

      setBonuses(bonusList);
      setTotalBonus(bTotal);
      setLoading(false);
    };

    fetchData();
  }, [userId, hourlyWage, loginId]);


  return (
    <div className="mypage-container">
      {/* Background Decor */}
      <div className="bg-decor-circle c1"></div>
      <div className="bg-decor-circle c2"></div>

      <div className="mypage-content">
        {/* Header Section */}
        <header className="mypage-header">
          <div className="user-avatar">
            <User size={32} />
          </div>
          <div className="user-info">
            <h1 className="user-name">{userName}</h1>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <span className="user-role">STAFF / {loginId}</span>
              {userInfo && userInfo.livingAlone ? (
                <span className="badge-living">
                  <Home size={12} style={{ marginRight: 3 }} /> 一人暮らし
                </span>
              ) : null}
            </div>
          </div>
          <button className="logout-btn-icon" onClick={() => {
            if (onLogout) onLogout();
            else {
              localStorage.clear();
              window.location.href = "/login";
            }
          }}>
            <LogOut size={20} />
          </button>
        </header>

        {/* Salary Card (Hero) */}
        <div className="salary-hero-card">
          <div className="card-label">
            <Wallet size={18} /> 今月の概算給与
          </div>
          <div className="salary-amount">
            <span className="scurrency">¥</span>
            {loading ? "..." : (stats.estimatedSalary + totalBonus).toLocaleString()}
          </div>
          <div className="salary-sub">
            基本 {stats.estimatedSalary.toLocaleString()} + ボーナス {totalBonus.toLocaleString()}
          </div>
          <div style={{ fontSize: "0.8rem", marginTop: "4px", opacity: 0.8 }}>
            時給 {hourlyWage.toLocaleString()}円 × {stats.totalHours.toFixed(1)}時間 (出勤 {stats.totalDays}日)
          </div>
        </div>

        {/* Bonus Section */}
        {bonuses.length > 0 && (
          <div className="bonus-section">
            <h3 className="section-title"><Gift size={16} /> 対象ボーナス</h3>
            <div className="bonus-list">
              {bonuses.map((b, i) => (
                <div key={i} className="bonus-item">
                  <div className="bonus-name"><Award size={14} className="icon-award" /> {b.name}</div>
                  <div className="bonus-val">+{b.amount.toLocaleString()}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stats Grid */}
        <div className="stats-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div className="stat-box">
            <div className="stat-icon i-blue"><Clock size={20} /></div>
            <div className="stat-val">{loading ? "-" : stats.totalHours.toFixed(1)}<span className="unit">h</span></div>
            <div className="stat-label">総勤務時間</div>
          </div>

          <div className="stat-box">
            <div className="stat-icon i-green"><Calendar size={20} /></div>
            <div className="stat-val">{loading ? "-" : stats.totalDays}<span className="unit">日</span></div>
            <div className="stat-label">出勤日数</div>
          </div>
        </div>

        <button className="logout-full-btn" onClick={() => {
          if (onLogout) onLogout();
          else {
            localStorage.clear();
            window.location.href = "/login";
          }
        }}>
          ログアウト
        </button>

      </div>

      <style>{`
        .mypage-container {
          position: relative;
          min-height: 80vh;
          overflow: hidden;
          padding: 20px;
          color: #333;
        }
        .bg-decor-circle {
          position: absolute;
          border-radius: 50%;
          filter: blur(80px);
          z-index: -1;
          opacity: 0.6;
        }
        .c1 { width: 300px; height: 300px; background: #bfdbfe; top: -50px; left: -50px; }
        .c2 { width: 200px; height: 200px; background: #e9d5ff; bottom: 0; right: -50px; }

        .mypage-content {
          max-width: 600px;
          margin: 0 auto;
          position: relative;
          z-index: 1;
        }

        .mypage-header {
          display: flex;
          align-items: center;
          gap: 16px;
          margin-bottom: 30px;
        }
        .user-avatar {
          width: 50px; height: 50px; min-width: 50px;
          background: #fff;
          border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 4px 12px rgba(0,0,0,0.05);
          color: #2563eb;
        }
        .user-info { flex: 1; }
        .user-name { font-size: 1.2rem; font-weight: bold; margin: 0; }
        .user-role { font-size: 0.8rem; color: #6b7280; letter-spacing: 0.05em; }
        
        .badge-living {
          display: inline-flex;
          align-items: center;
          background: #ecfdf5;
          color: #059669;
          font-size: 0.7rem;
          padding: 2px 8px;
          border-radius: 99px;
          font-weight: bold;
          border: 1px solid #a7f3d0;
        }

        .logout-btn-icon {
          background: none; border: none; cursor: pointer; color: #9ca3af;
          transition: color 0.2s;
        }
        .logout-btn-icon:hover { color: #ef4444; }

        .salary-hero-card {
          background: linear-gradient(135deg, #2563eb, #7c3aed);
          color: #fff;
          border-radius: 20px;
          padding: 30px;
          box-shadow: 0 10px 25px rgba(37, 99, 235, 0.3);
          margin-bottom: 24px;
          position: relative;
          overflow: hidden;
        }
        .salary-hero-card::after {
          content: "";
          position: absolute; top: -50%; left: -50%; width: 200%; height: 200%;
          background: radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 60%);
          transform: rotate(45deg);
          pointer-events: none;
        }
        .card-label { display: flex; align-items: center; gap: 6px; font-size: 0.9rem; opacity: 0.9; margin-bottom: 8px; }
        .salary-amount { font-size: 2.5rem; font-weight: 800; letter-spacing: -0.02em; line-height: 1.1; }
        .scurrency { font-size: 1.5rem; margin-right: 4px; opacity: 0.8; font-weight: 400; }
        .salary-sub { margin-top: 12px; font-size: 0.85rem; opacity: 0.8; }

        .section-title {
          font-size: 0.9rem;
          font-weight: bold;
          color: #4b5563;
          margin-bottom: 12px;
          display: flex; align-items: center; gap: 6px;
        }

        .bonus-section {
          background: rgba(255,255,255,0.6);
          backdrop-filter: blur(10px);
          border-radius: 16px;
          padding: 16px;
          margin-bottom: 24px;
          border: 1px solid rgba(255,255,255,0.5);
        }
        .bonus-list { display: flex; flex-direction: column; gap: 8px; }
        .bonus-item {
          display: flex; justify-content: space-between; align-items: center;
          background: #fff;
          padding: 10px 14px;
          border-radius: 10px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.02);
        }
        .bonus-name { display: flex; align-items: center; gap: 6px; font-size: 0.9rem; font-weight: 500; }
        .bonus-val { font-weight: bold; color: #e11d48; }
        .icon-award { color: #f59e0b; }

        .stats-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 12px;
          margin-bottom: 24px;
        }
        .stat-box {
          background: rgba(255,255,255,0.8);
          backdrop-filter: blur(10px);
          border-radius: 16px;
          padding: 16px;
          text-align: center;
          box-shadow: 0 4px 6px rgba(0,0,0,0.02);
          border: 1px solid rgba(255,255,255,0.5);
        }
        .stat-icon {
          width: 42px; height: 42px;
          border-radius: 12px;
          display: flex; align-items: center; justify-content: center;
          margin: 0 auto 10px auto;
          color: #fff;
        }
        .i-blue { background: #3b82f6; box-shadow: 0 4px 10px rgba(59,130,246,0.3); }
        .i-green { background: #10b981; box-shadow: 0 4px 10px rgba(16,185,129,0.3); }
        
        .stat-val { font-size: 1.2rem; font-weight: bold; color: #1f2937; }
        .unit { font-size: 0.7rem; margin-left: 2px; color: #6b7280; font-weight: normal; }
        .stat-label { font-size: 0.7rem; color: #6b7280; margin-top: 2px; }

        .logout-full-btn {
          width: 100%;
          padding: 14px;
          border-radius: 12px;
          border: none;
          background: #fee2e2;
          color: #ef4444;
          font-weight: bold;
          cursor: pointer;
          transition: background 0.2s;
        }
        .logout-full-btn:hover {
           background: #fca5a5;
           color: #fff;
        }
      `}</style>
    </div>
  );
}
