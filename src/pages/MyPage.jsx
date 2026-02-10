import React, { useEffect, useState, useMemo } from "react";
import { User, Wallet, Clock, Calendar, LogOut, Home, Gift, Award, Pencil, Lock, ChevronLeft, ChevronRight, PieChart, CheckCircle } from "lucide-react";
import { format, getDaysInMonth, isSaturday, isSunday, parseISO, differenceInYears, startOfMonth, endOfMonth, eachDayOfInterval, addMonths, subMonths } from "date-fns";
import { ja } from "date-fns/locale";
import { HOLIDAYS, LOCATIONS, DEPARTMENTS } from "../constants";
import { fetchShiftData } from "../utils/shiftParser";

import "../App.css";



const API_BASE = "https://lfsu60xvw7.execute-api.ap-northeast-1.amazonaws.com";
const READ_USER_URL = "https://lfsu60xvw7.execute-api.ap-northeast-1.amazonaws.com/users";
const WRITE_USER_URL = "https://lfsu60xvw7.execute-api.ap-northeast-1.amazonaws.com/users";



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

  // New States
  const [currentDate, setCurrentDate] = useState(new Date());
  const [currentItems, setCurrentItems] = useState([]); // Filtered by currentDate
  const [allItems, setAllItems] = useState([]); // All fetched items for yearly stats
  const [lateViewMode, setLateViewMode] = useState("month"); // "month" or "year"
  const [shiftMap, setShiftMap] = useState({}); // シフトデータ

  // シフトデータを取得
  useEffect(() => {
    fetchShiftData().then(data => setShiftMap(data));
  }, []);

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
          console.log("MyPage: User API raw response:", text);
          let uData = null;
          try {
            const outer = JSON.parse(text);
            if (outer.body && typeof outer.body === "string") uData = JSON.parse(outer.body);
            else uData = outer;

            // 配列形式の場合の処理を修正
            if (Array.isArray(uData)) {
              fetchedUser = uData.find(u => u.userId === userId) || null;
            } else if (uData && uData.Items && Array.isArray(uData.Items)) {
              fetchedUser = uData.Items.find(u => u.userId === userId) || null;
            } else if (uData && (uData.userId === userId || uData.loginId === loginId)) {
              fetchedUser = uData;
            } else if (Array.isArray(outer)) {
              fetchedUser = outer.find(u => u.userId === userId) || null;
            }

            console.log("MyPage: fetchedUser:", fetchedUser);

            if (fetchedUser) {
              // Admin -> User Sync: APIの値を常に使用（Source of Truth = API/Admin）
              const newDefaultLocation = fetchedUser.defaultLocation || "未記載";
              const newDefaultDepartment = fetchedUser.defaultDepartment || "未記載";

              console.log("MyPage: Setting defaultLocation to:", newDefaultLocation);
              console.log("MyPage: Setting defaultDepartment to:", newDefaultDepartment);

              // localStorageを更新
              localStorage.setItem("defaultLocation", newDefaultLocation);
              localStorage.setItem("defaultDepartment", newDefaultDepartment);

              // userInfoを確実に更新
              setUserInfo(prev => ({
                ...prev,
                ...fetchedUser,
                defaultLocation: newDefaultLocation,
                defaultDepartment: newDefaultDepartment
              }));
            }
          } catch (e) { console.error("MyPage: User parse error:", e); }
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
      // const now = new Date(); // REMOVED: Use currentDate
      const currentMonthPrefix = format(currentDate, "yyyy-MM");

      // 今月のレコード抽出 (From all fetched items)
      const sourceItems = fetchedItems;

      const currentItems = sourceItems.filter(item =>
        item.workDate && item.workDate.startsWith(currentMonthPrefix)
      );
      setCurrentItems(currentItems);
      setAllItems(sourceItems); // 年間統計用に全データを保存

      // 基本集計
      let sumTotalMin = 0; // 全働
      let sumPaidMin = 0;  // 給与対象（派遣ならバイトのみ、他は全実働）
      let sumDispatchMin = 0; // 派遣として働いた時間（派遣社員のみ）

      let days = 0;
      const attendedDates = new Set();
      let hasAnyNightWork = false;
      let weekendWorkCount = 0;
      let firstDayBonusAmount = 0;
      let firstDayHasNightWork = false;
      const savedType = localStorage.getItem("employmentType");
      const currentType = fetchedUser?.employmentType || savedType;
      const isDispatchUser = currentType === "派遣";

      currentItems.forEach(item => {
        const workMin = calcWorkMin(item);
        if (workMin > 0) {
          // アリアちゃん1日出勤ボーナス (全ユーザー対象)
          const d = new Date(item.workDate);
          if (d.getDate() === 1) {
            // 30分単位で¥500、最低¥1,000
            const units = Math.floor(workMin / 30);
            firstDayBonusAmount += Math.max(1000, units * 500);
            // 1日に深夜勤務(22時以降)があるかチェック
            if (hasNightWork(item)) {
              firstDayHasNightWork = true;
            }
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
      const start = startOfMonth(currentDate);
      const end = endOfMonth(currentDate);
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
        ? differenceInYears(currentDate, new Date(fetchedUser.startDate))
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

      // 深夜勤務手当は1日出勤ボーナス（夜勤）に統合のため削除

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

      // アリアちゃん1日出勤ボーナス（時給）
      if (firstDayBonusAmount > 0) {
        bonusList.push({ name: "アリアちゃん1日出勤ボーナス（時給）", amount: firstDayBonusAmount });
        bTotal += firstDayBonusAmount;
      }

      // アリアちゃん1日出勤ボーナス（夜勤）- 1日に22時以降の勤務があれば¥10,000
      if (firstDayHasNightWork) {
        bonusList.push({ name: "アリアちゃん1日出勤ボーナス（夜勤）", amount: 10000 });
        bTotal += 10000;
      }

      setBonuses(bonusList);
      setTotalBonus(bTotal);
      setLoading(false);
    };

    fetchData();
    fetchData();
  }, [userId, hourlyWage, loginId, currentDate]); // Added currentDate dependency




  const savedType = localStorage.getItem("employmentType");
  const isDispatch = (userInfo?.employmentType || savedType) === "派遣";

  const handleSaveSettings = async () => {
    if (!userInfo) return;

    // 既存のユーザー情報を全て維持し、勤務地と部署のみ変更する
    const payload = {
      ...userInfo,
      userId: userInfo.userId || userId,
      loginId: userInfo.loginId || loginId,
      defaultLocation: userInfo.defaultLocation || "未記載",
      defaultDepartment: userInfo.defaultDepartment || "未記載"
    };

    try {
      const token = localStorage.getItem("token");
      const headers = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = token;

      const res = await fetch(WRITE_USER_URL, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error("Settings save error:", res.status, errText);
        alert(`保存に失敗しました (${res.status})`);
        return;
      }

      // Sync to localStorage
      localStorage.setItem("defaultLocation", payload.defaultLocation);
      localStorage.setItem("defaultDepartment", payload.defaultDepartment);
      alert("設定を保存しました");
    } catch (err) { console.error(err); alert("保存に失敗しました"); }
  };

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
          <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
            {/* Month Nav */}
            <div style={{ display: "flex", alignItems: "center", background: "#f3f4f6", padding: "4px 8px", borderRadius: "8px" }}>
              <button onClick={() => setCurrentDate(subMonths(currentDate, 1))} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", padding: "4px" }}>
                <ChevronLeft size={20} color="#4b5563" />
              </button>
              <span style={{ margin: "0 8px", fontSize: "1rem", fontWeight: "bold", color: "#374151" }}>
                {format(currentDate, "yyyy年 M月")}
              </span>
              <button onClick={() => setCurrentDate(addMonths(currentDate, 1))} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", padding: "4px" }}>
                <ChevronRight size={20} color="#4b5563" />
              </button>
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
          </div>
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
                (派遣: {stats.dispatchHours.toFixed(1)}h / {stats.paidHours.toFixed(1)}h)
              </div>
            )}
          </div>

          <div className="stat-box">
            <div className="stat-icon i-green"><Calendar size={20} /></div>
            <div className="stat-val">{loading ? "-" : `${stats.totalDays} / ${scheduledDays}`}<span className="unit">日</span></div>
            <div className="stat-label">出勤日数 (実績 / 規定)</div>
          </div>
        </div>

        {/* --- 遅刻件数セクション --- */}
        <div className="bonus-section" style={{ background: "rgba(255,255,255,0.9)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <h3 className="section-title" style={{ margin: 0 }}>
              <Clock size={16} /> 遅刻件数
            </h3>
            <div style={{ display: "flex", gap: "4px" }}>
              <button
                onClick={() => setLateViewMode("month")}
                style={{
                  padding: "4px 12px",
                  borderRadius: "6px",
                  border: "none",
                  background: lateViewMode === "month" ? "#2563eb" : "#f3f4f6",
                  color: lateViewMode === "month" ? "#fff" : "#374151",
                  fontSize: "0.8rem",
                  fontWeight: "bold",
                  cursor: "pointer"
                }}
              >
                今月
              </button>
              <button
                onClick={() => setLateViewMode("year")}
                style={{
                  padding: "4px 12px",
                  borderRadius: "6px",
                  border: "none",
                  background: lateViewMode === "year" ? "#2563eb" : "#f3f4f6",
                  color: lateViewMode === "year" ? "#fff" : "#374151",
                  fontSize: "0.8rem",
                  fontWeight: "bold",
                  cursor: "pointer"
                }}
              >
                今年
              </button>
            </div>
          </div>
          {(() => {
            // 遅刻件数の計算
            const currentYearPrefix = format(currentDate, "yyyy");
            const targetItems = lateViewMode === "month" ? currentItems : allItems.filter(item =>
              item.workDate && item.workDate.startsWith(currentYearPrefix)
            );

            // シフト開始時刻と出勤時刻を比較して遅刻をカウント
            const lateCount = targetItems.filter(item => {
              if (!item.clockIn) return false;

              // 管理者が遅刻取消済みの場合はカウントしない
              const parsed = safeJsonParse(item.comment);
              if (parsed?.application?.lateCancelled) return false;

              const workDate = item.displayDate || item.workDate;
              // ユーザー名でシフトを検索
              const keysToTry = [
                userName,
                userInfo?.lastName && userInfo?.firstName ? `${userInfo.lastName} ${userInfo.firstName}` : null,
                userInfo?.lastName && userInfo?.firstName ? `${userInfo.lastName}${userInfo.firstName}` : null,
              ].filter(Boolean);
              let shift = null;
              for (const k of keysToTry) {
                if (shiftMap[k] && shiftMap[k][workDate]) {
                  shift = shiftMap[k][workDate];
                  break;
                }
              }
              if (shift && shift.start && toMin(item.clockIn) > toMin(shift.start)) {
                return true;
              }
              return false;
            }).length;

            return (
              <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                <div style={{
                  width: "60px",
                  height: "60px",
                  borderRadius: "50%",
                  background: lateCount > 0 ? "#fef2f2" : "#f0fdf4",
                  border: lateCount > 0 ? "2px solid #fecaca" : "2px solid #bbf7d0",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "1.5rem",
                  fontWeight: "bold",
                  color: lateCount > 0 ? "#ef4444" : "#16a34a"
                }}>
                  {lateCount}
                </div>
                <div>
                  <div style={{ fontSize: "0.9rem", fontWeight: "bold", color: "#374151" }}>
                    {lateViewMode === "month" ? format(currentDate, "M月") : format(currentDate, "yyyy年")}の遅刻
                  </div>
                  <div style={{ fontSize: "0.8rem", color: "#6b7280" }}>
                    {lateCount === 0 ? "遅刻なし！素晴らしいです" : `${lateCount}件の遅刻があります`}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>


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
                onChange={(e) => {
                  const val = e.target.value;
                  setUserInfo({ ...userInfo, defaultLocation: val });
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
                onChange={(e) => {
                  const val = e.target.value;
                  setUserInfo({ ...userInfo, defaultDepartment: val });
                }}
              >
                {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginTop: "16px", textAlign: "right" }}>
            <button
              onClick={handleSaveSettings}
              className="save-settings-btn"
              style={{
                background: "#2563eb",
                color: "#fff",
                border: "none",
                padding: "10px 20px",
                borderRadius: "8px",
                fontWeight: "bold",
                cursor: "pointer",
                boxShadow: "0 2px 5px rgba(37,99,235,0.3)"
              }}
            >
              設定を保存
            </button>
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
