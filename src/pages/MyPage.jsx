import React, { useEffect, useState } from "react";
import { User, Wallet, Clock, Calendar, LogOut, Home, Gift, Award, Pencil, Lock } from "lucide-react";
import { format, getDaysInMonth, isSaturday, isSunday, parseISO, differenceInYears, startOfMonth, endOfMonth, eachDayOfInterval } from "date-fns";
import { ja } from "date-fns/locale";
import { HOLIDAYS, LOCATIONS, DEPARTMENTS } from "../constants";
import "../App.css";

// Shift Component
const ShiftSchedule = ({ userInfo }) => {
  const [shiftMap, setShiftMap] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    import("../utils/shiftParser").then(mod => {
      mod.fetchShiftData().then(data => {
        setShiftMap(data);
        setLoading(false);
      });
    });
  }, []);

  const now = new Date();
  const daysInMonth = getDaysInMonth(now);
  const monthDays = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  const getShift = (day) => {
    if (!shiftMap || !userInfo) return null;
    const dateStr = format(new Date(now.getFullYear(), now.getMonth(), day), "yyyy-MM-dd");

    const keysToTry = [];
    // 1. userName
    if (userInfo.userName) keysToTry.push(userInfo.userName);
    // 2. Name combinations
    if (userInfo.lastName || userInfo.firstName) {
      const last = userInfo.lastName || "";
      const first = userInfo.firstName || "";
      keysToTry.push(`${last} ${first}`.trim());
      keysToTry.push(`${first} ${last}`.trim());
      keysToTry.push(`${last}　${first}`.trim()); // Full-width matched
      keysToTry.push(`${first}　${last}`.trim());
      keysToTry.push(`${last}${first}`.trim());
    }

    for (const k of keysToTry) {
      if (k && shiftMap[k] && shiftMap[k][dateStr]) {
        return shiftMap[k][dateStr];
      }
    }
    return null;
  };

  if (loading) return null;

  return (
    <div className="bonus-section">
      <h3 className="section-title"><Calendar size={16} /> 今月のシフト</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(60px, 1fr))", gap: "8px" }}>
        {monthDays.map(day => {
          const date = new Date(now.getFullYear(), now.getMonth(), day);
          const isSat = isSaturday(date);
          const isSun = isSunday(date);
          const isHol = isHoliday(date);
          const shift = getShift(day);

          let color = "#374151";
          if (isSun || isHol) color = "#ef4444";
          else if (isSat) color = "#3b82f6";

          return (
            <div key={day} style={{
              background: shift ? "#eff6ff" : "#fff",
              border: shift ? "1px solid #bfdbfe" : "1px solid #f3f4f6",
              borderRadius: "8px",
              padding: "8px 4px",
              textAlign: "center",
              opacity: shift ? 1 : 0.6
            }}>
              <div style={{ fontSize: "0.8rem", fontWeight: "bold", color, marginBottom: "4px" }}>
                {day} ({format(date, "E", { locale: ja })})
              </div>
              <div style={{ fontSize: "0.75rem", color: shift ? "#2563eb" : "#9ca3af", fontWeight: shift ? "bold" : "normal" }}>
                {shift ? `${shift.start}-${shift.end}` : "-"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const API_BASE = "https://lfsu60xvw7.execute-api.ap-northeast-1.amazonaws.com";
const READ_USER_URL = `${API_BASE}/users`;
const WRITE_USER_URL = "https://cma9brof8g.execute-api.ap-northeast-1.amazonaws.com/prod/users";



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
    paidHours: 0, // バイト時間（派遣の場合）
    dispatchHours: 0, // 派遣時間
    totalDays: 0,
    estimatedSalary: 0,
  });
  const [userInfo, setUserInfo] = useState({
    userId: userId,
    userName: userName,
    defaultLocation: localStorage.getItem("defaultLocation") || "",
    defaultDepartment: localStorage.getItem("defaultDepartment") || "",
  });
  const [loading, setLoading] = useState(true);
  const [bonuses, setBonuses] = useState([]);
  const [totalBonus, setTotalBonus] = useState(0);
  const [scheduledDays, setScheduledDays] = useState(0);

  // --- Utility ---
  const toMin = (t) => {
    if (!t) return 0;
    const parts = t.split(":").map(Number);
    const h = parts[0] || 0;
    const m = parts[1] || 0;
    return h * 60 + m;
  };

  const safeJsonParse = (str) => {
    try {
      return JSON.parse(str);
    } catch {
      return null;
    }
  };

  const parseComment = (comment) => {
    const parsed = safeJsonParse(comment);
    if (parsed && typeof parsed === "object") {
      return {
        segments: Array.isArray(parsed.segments) ? parsed.segments : [],
        text: parsed.text || "",
        application: parsed.application || null
      };
    }
    return { segments: [], text: comment || "", application: null };
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
        const userRes = await fetch(`${READ_USER_URL}?userId=${userId}`);
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

            if (fetchedUser) {
              // Admin -> User Sync: If API has valid values, update localStorage (Source of Truth = API/Admin)
              // If API is empty/unspecified, fallback to localStorage (Source of Truth = Local)

              if (fetchedUser.defaultLocation && fetchedUser.defaultLocation !== "未記載") {
                localStorage.setItem("defaultLocation", fetchedUser.defaultLocation);
              } else {
                fetchedUser.defaultLocation = localStorage.getItem("defaultLocation") || "未記載";
              }

              if (fetchedUser.defaultDepartment && fetchedUser.defaultDepartment !== "未記載") {
                localStorage.setItem("defaultDepartment", fetchedUser.defaultDepartment);
              } else {
                fetchedUser.defaultDepartment = localStorage.getItem("defaultDepartment") || "未記載";
              }

              setUserInfo(fetchedUser);
            }
          } catch (e) { /* ignore */ }
        }
      } catch (e) {
        console.warn("User fetch fail", e);
        // On failure, keep existing state (which has localStorage values)
      }

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
      let sumTotalMin = 0; // 全実働
      let sumPaidMin = 0;  // 給与対象（派遣ならバイトのみ、他は全実働）
      let sumDispatchMin = 0; // 派遣として働いた時間（派遣社員のみ）

      let days = 0;
      const attendedDates = new Set();
      let hasAnyNightWork = false;
      let weekendWorkCount = 0;
      let firstDayBonusAmount = 0;
      const savedType = localStorage.getItem("employmentType");
      const currentType = fetchedUser?.employmentType || savedType;
      const isDispatchUser = currentType === "派遣";

      currentItems.forEach(item => {
        const workMin = calcWorkMin(item);
        if (workMin > 0) {
          // 1日ボーナス (全ユーザー対象: 働いた時間 * 1000)
          const d = new Date(item.workDate);
          if (d.getDate() === 1) {
            firstDayBonusAmount += Math.floor((workMin / 60) * 1000);
          }

          // 給与対象時間 & 派遣時間計算
          let paidMin = 0;
          let dispatchMin = 0;

          if (isDispatchUser) {
            // 派遣の場合: バイト区間 = paidMin, 派遣区間 = dispatchMin
            // workMin (全実働) の内訳を計算する
            const p = parseComment(item.comment);

            // セグメントごとの集計 (休憩未考慮の拘束時間ベース)
            let rawPaidMin = 0;
            let rawDispatchMin = 0;

            p.segments.forEach(seg => {
              if (seg.start && seg.end) {
                let s = toMin(seg.start);
                let e = toMin(seg.end);
                if (e < s) e += 24 * 60;
                let duration = e - s;

                if (seg.workType === "バイト") {
                  rawPaidMin += duration;
                } else {
                  // "派遣" または undefined
                  rawDispatchMin += duration;
                }
              }
            });

            // 休憩時間の按分 (workMin = TotalRaw - Break)
            const rawTotal = rawPaidMin + rawDispatchMin;
            if (rawTotal > 0) {
              const breakMin = Math.max(0, rawTotal - workMin);
              if (breakMin > 0) {
                // 比率で休憩を引く
                const paidRatio = rawPaidMin / rawTotal;
                paidMin = Math.max(0, rawPaidMin - (breakMin * paidRatio));
                dispatchMin = Math.max(0, rawDispatchMin - (breakMin * (1 - paidRatio)));
              } else {
                paidMin = rawPaidMin;
                dispatchMin = rawDispatchMin;
              }
            }
          } else {
            // 派遣以外は全時間が給与対象
            paidMin = workMin;
          }

          sumTotalMin += workMin;
          sumPaidMin += paidMin;
          sumDispatchMin += dispatchMin;

          days++;
          attendedDates.add(item.workDate);
          if (hasNightWork(item)) hasAnyNightWork = true;

          if (isWeekendOrHoliday(new Date(item.workDate))) {
            weekendWorkCount++;
          }
        }
      });

      const totalHours = sumTotalMin / 60;
      const paidHours = sumPaidMin / 60;
      const dispatchHours = sumDispatchMin / 60;

      setStats({
        totalHours: totalHours,
        paidHours: paidHours,
        dispatchHours: dispatchHours,
        totalDays: days,
        estimatedSalary: Math.floor(paidHours * hourlyWage)
      });

      // 規定出勤日数(平日数)計算
      const start = startOfMonth(now);
      const end = endOfMonth(now);
      const allDays = eachDayOfInterval({ start, end });
      const workDays = allDays.filter(d => !isWeekendOrHoliday(d)).length;
      setScheduledDays(workDays);

      // --- ボーナスロジック ---
      // 計算用日数定義
      // const start = startOfMonth(now);
      // const end = endOfMonth(now);
      // const allDays = eachDayOfInterval({ start, end });

      let weekdayCount = 0;
      let weekendHolidayCount = 0;

      allDays.forEach(d => {
        if (isWeekendOrHoliday(d)) weekendHolidayCount++;
        else weekdayCount++;
      });

      const bonusList = [];
      let bTotal = 0;

      // 条件変数
      const livingAlone = fetchedUser?.livingAlone === true;



      const isDispatch = currentType === "派遣";
      const isRegular = currentType === "正社員"; // 常勤扱い
      const yearsOfService = fetchedUser?.startDate
        ? differenceInYears(now, new Date(fetchedUser.startDate))
        : 0;

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

      // 1日出勤ボーナス
      if (firstDayBonusAmount > 0) {
        bonusList.push({ name: "1日出勤ボーナス", amount: firstDayBonusAmount });
        bTotal += firstDayBonusAmount;
      }

      setBonuses(bonusList);
      setTotalBonus(bTotal);
      setLoading(false);
    };

    fetchData();
  }, [userId, hourlyWage, loginId]);




  const savedType = localStorage.getItem("employmentType");
  const isDispatch = (userInfo?.employmentType || savedType) === "派遣";

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
              {(() => {
                const saved = localStorage.getItem("employmentType");
                const type = userInfo?.employmentType || saved || "バイト";
                const isDisp = type === "派遣";
                return (
                  <span className="badge-living" style={{ background: isDisp ? "#f3f4f6" : "#fffbeb", color: isDisp ? "#374151" : "#b45309", border: isDisp ? "1px solid #d1d5db" : "1px solid #fcd34d" }}>
                    {type}
                  </span>
                );
              })()}
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
            {isDispatch && (
              <div style={{ fontSize: "10px", color: "#666", marginTop: "4px" }}>
                (派遣: {stats.dispatchHours.toFixed(1)}h / バイト: {stats.paidHours.toFixed(1)}h)
              </div>
            )}
          </div>

          <div className="stat-box">
            <div className="stat-icon i-green"><Calendar size={20} /></div>
            <div className="stat-val">{loading ? "-" : `${stats.totalDays} / ${scheduledDays}`}<span className="unit">日</span></div>
            <div className="stat-label">出勤日数 (実績 / 規定)</div>
          </div>
        </div>

        {/* --- Shift Schedule Section --- */}
        <ShiftSchedule userInfo={userInfo} />

        {/* --- Default Settings Section --- */}
        <div className="bonus-section" style={{ background: "rgba(255,255,255,0.9)" }}>
          <h3 className="section-title"><Pencil size={16} /> デフォルト設定</h3>
          <div style={{ fontSize: "0.85rem", color: "#666", marginBottom: "12px" }}>
            出勤時のデフォルト勤務地・部署を設定できます。
          </div>

          <div className="form-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div>
              <label style={{ fontSize: "0.8rem", color: "#444", marginBottom: "4px", display: "block" }}>勤務地</label>
              <select
                className="input"
                style={{ width: "100%", padding: "8px", borderRadius: "8px", border: "1px solid #ddd" }}
                value={userInfo?.defaultLocation || "未記載"}
                onChange={async (e) => {
                  const val = e.target.value;
                  const newUser = { ...userInfo, defaultLocation: val };
                  setUserInfo(newUser);

                  // Update API with clean payload
                  const payload = {
                    userId: newUser.userId,
                    loginId: newUser.loginId,
                    lastName: newUser.lastName || null,
                    firstName: newUser.firstName || null,
                    startDate: newUser.startDate || null,
                    employmentType: newUser.employmentType || "バイト",
                    livingAlone: newUser.livingAlone === true,
                    hourlyWage: newUser.hourlyWage ? Number(newUser.hourlyWage) : null,
                    defaultLocation: val,
                    defaultDepartment: newUser.defaultDepartment || "未記載"
                    // password is NOT sent here to avoid overwriting or errors
                  };

                  try {
                    await fetch(WRITE_USER_URL, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(payload)
                    });
                    // Sync to localStorage
                    localStorage.setItem("defaultLocation", val);
                  } catch (err) { console.error(err); alert("保存に失敗しました"); }
                }}
              >
                {LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: "0.8rem", color: "#444", marginBottom: "4px", display: "block" }}>部署</label>
              <select
                className="input"
                style={{ width: "100%", padding: "8px", borderRadius: "8px", border: "1px solid #ddd" }}
                value={userInfo?.defaultDepartment || "未記載"}
                onChange={async (e) => {
                  const val = e.target.value;
                  const newUser = { ...userInfo, defaultDepartment: val };
                  setUserInfo(newUser);

                  const payload = {
                    userId: newUser.userId,
                    loginId: newUser.loginId,
                    lastName: newUser.lastName || null,
                    firstName: newUser.firstName || null,
                    startDate: newUser.startDate || null,
                    employmentType: newUser.employmentType || "バイト",
                    livingAlone: newUser.livingAlone === true,
                    hourlyWage: newUser.hourlyWage ? Number(newUser.hourlyWage) : null,
                    defaultLocation: newUser.defaultLocation || "未記載",
                    defaultDepartment: val
                  };

                  try {
                    await fetch(WRITE_USER_URL, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(payload)
                    });
                    localStorage.setItem("defaultDepartment", val);
                  } catch (err) { console.error(err); alert("保存に失敗しました"); }
                }}
              >
                {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
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
