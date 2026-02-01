import React, { useEffect, useState, useMemo } from "react";
import {
  Clock,
  LogIn,
  LogOut,
  Coffee,
  Pencil,
  Plus,
  Trash2,
  Briefcase,
  Info,
  AlertCircle,
  CheckCircle,
  XCircle,
  MessageCircle
} from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSaturday, isSunday, addDays, isSameDay, addMonths, subMonths } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ja } from "date-fns/locale";
import { HOLIDAYS, LOCATIONS, DEPARTMENTS, REASON_OPTIONS } from "../constants";
import "../App.css";

const isHoliday = (d) => {
  const s = format(d, "yyyy-MM-dd");
  return HOLIDAYS.includes(s);
};

// Generate 30-minute intervals for 24 hours (00:00 - 23:30)
const TIME_OPTIONS = [];
for (let h = 0; h < 24; h++) {
  const hh = String(h).padStart(2, '0');
  TIME_OPTIONS.push(`${hh}:00`);
  TIME_OPTIONS.push(`${hh}:30`);
}

const API_BASE = "https://lfsu60xvw7.execute-api.ap-northeast-1.amazonaws.com";

/* --- UTILS --- */
const toMin = (t) => {
  if (!t) return 0;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

const minToTime = (min) => {
  const h = Math.floor(min / 60);
  const m = Math.floor(min % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

const calcBreakTime = (e) => {
  if (!e.breaks || e.breaks.length === 0) return 0;
  return e.breaks.reduce((acc, b) => {
    if (b.start && b.end) {
      return acc + (toMin(b.end) - toMin(b.start));
    }
    return acc;
  }, 0);
};

const calcWorkMin = (e) => {
  if (!e.clockIn || !e.clockOut) return 0;
  const total = toMin(e.clockOut) - toMin(e.clockIn);
  const brk = calcBreakTime(e);
  return Math.max(0, total - brk);
};

const calcRoundedWorkMin = (e) => {
  const raw = calcWorkMin(e);
  if (raw <= 0) return 0;
  return Math.floor(raw / 30) * 30; // 30 min truncate
};

const parseComment = (raw) => {
  try {
    if (!raw) return { segments: [], text: "", application: null };
    if (typeof raw === "object") return raw;
    const parsed = JSON.parse(raw);

    // Support new structure { segments, text, application }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return {
        segments: parsed.segments || [],
        text: parsed.text || "",
        application: parsed.application || null // { status, reason, adminComment, ... }
      };
    }
    // Fallback for old array structure
    if (Array.isArray(parsed)) return { segments: parsed, text: "", application: null };
    return { segments: [], text: raw, application: null };
  } catch (e) {
    return { segments: [], text: raw || "", application: null };
  }
};

export default function AttendanceRecord({ user: propUser }) {
  // Use prop or fallback to localStorage
  const user = useMemo(() => {
    if (propUser) return propUser;
    const uid = localStorage.getItem("userId");
    if (!uid) return null;
    return {
      userId: uid,
      userName: localStorage.getItem("userName"),
      defaultLocation: localStorage.getItem("defaultLocation") || "未記載",
      defaultDepartment: localStorage.getItem("defaultDepartment") || "未記載"
    };
  }, [propUser]);

  const [items, setItems] = useState([]);
  const [currentDate, setCurrentDate] = useState(new Date());

  // Modal State REMOVED, Inline State ADDED
  const [expandedDate, setExpandedDate] = useState(null); // Track which row is expanded
  // const [modalOpen, setModalOpen] = useState(false); // Removed
  // const [editingDate, setEditingDate] = useState(""); // Replaced by expandedDate

  const [formIn, setFormIn] = useState("");
  const [formOut, setFormOut] = useState("");
  const [formBreaks, setFormBreaks] = useState([]);
  const [formSegments, setFormSegments] = useState([]);
  const [reason, setReason] = useState(REASON_OPTIONS[0]);
  const [formText, setFormText] = useState(""); // Detailed reason text
  const [loading, setLoading] = useState(false);

  // Resubmission Context
  const [adminFeedback, setAdminFeedback] = useState("");

  const handlePrevMonth = () => {
    setCurrentDate(prev => subMonths(prev, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(prev => addMonths(prev, 1));
  };

  // --- SHIFT DATA INTEGRATION ---
  const [shiftMap, setShiftMap] = useState({}); // { [userName]: { [dayInt]: { start, end } } }

  useEffect(() => {
    import("../utils/shiftParser").then(mod => {
      mod.fetchShiftData().then(data => setShiftMap(data));
    });
  }, []);

  const getShift = (uName, dateStr) => {
    if (!uName || !shiftMap[uName]) return null;
    return shiftMap[uName][dateStr] || null;
  };
  // -----------------------------

  useEffect(() => {
    if (user && user.userId) {
      fetchData();
    }
  }, [user, currentDate]);

  // Multi-Shift Support
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const todayItems = items.filter(i => i.workDate.startsWith(todayStr));
  const activeItem = todayItems.find(i => i.clockIn && !i.clockOut);
  const displayItem = activeItem || (todayItems.length > 0 ? todayItems[todayItems.length - 1] : null);

  const todayShift = useMemo(() => user ? getShift(user.userName, todayStr) : null, [user, shiftMap, todayStr]);

  // Helper: Is On Break?
  const isOnBreak = useMemo(() => {
    if (!displayItem || !displayItem.breaks || displayItem.breaks.length === 0) return false;
    const last = displayItem.breaks[displayItem.breaks.length - 1];
    return (last.start && !last.end);
  }, [displayItem]);

  /* --- API ENDPOINTS --- */
  const ENDPOINTS = {
    clockIn: `${API_BASE}/attendance/clock-in`,
    clockOut: `${API_BASE}/attendance/clock-out`,
    breakStart: `${API_BASE}/attendance/break-start`,
    breakEnd: `${API_BASE}/attendance/break-end`,
    update: `${API_BASE}/attendance/update`,
  };

  // Clock In/Out Handlers
  // Clock In/Out Handlers
  const handleClockIn = async () => {
    if (!user) return;
    setLoading(true);
    try {
      // Multi-shift Logic
      // If we have an active item (clockIn but no clockOut), we can't clock in again.
      if (activeItem) {
        alert("既に出勤しています。");
        setLoading(false);
        return;
      }

      // Determine Target Date Key (Suffixed if needed)
      let targetDateKey = todayStr;
      if (todayItems.length > 0) {
        // Check if the last item is finished
        const last = todayItems[todayItems.length - 1];
        if (last.clockOut) {
          // Start 2nd shift
          // Determine suffix index based on existing count
          // existing: ["2026-02-01"] count=1 -> next is "_2"
          // existing: ["2026-02-01", "2026-02-01_2"] count=2 -> next is "_3"
          targetDateKey = `${todayStr}_${todayItems.length + 1}`;
        }
      }

      const payload = { userId: user.userId, workDate: targetDateKey };

      await fetch(ENDPOINTS.clockIn, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      alert("出勤しました！");

      // Optimistic Update
      const nowTime = format(new Date(), "HH:mm");
      const newItems = [...items];

      const defaultComment = JSON.stringify({
        segments: [{
          location: user.defaultLocation || "未記載",
          department: user.defaultDepartment || "未記載",
          hours: ""
        }],
        text: "",
        application: null
      });

      // We ALWAYS create a new record if we reach here (since we blocked activeItem)
      // wait, logic: if todayItems is empty -> new record. If finished -> new record.
      // So yes, always push.

      newItems.push({
        userId: user.userId,
        workDate: targetDateKey,
        clockIn: nowTime,
        clockOut: "",
        breaks: [],
        comment: defaultComment
      });

      setItems(newItems);
      fetchData();
    } catch (e) {
      console.error(e);
      alert("エラーが発生しました: " + (e.message || "Unknown Error"));
    } finally {
      setLoading(false);
    }
  };

  const handleClockOut = async () => {
    if (!user || !activeItem) {
      alert("出勤していません");
      return;
    }
    setLoading(true);
    try {
      // Pass workDate to specify which shift to clock out from
      const payload = { userId: user.userId, workDate: activeItem.workDate };

      await fetch(ENDPOINTS.clockOut, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      alert("退勤しました！お疲れ様でした。");

      // Optimistic Update
      const nowTime = format(new Date(), "HH:mm");
      const newItems = [...items];
      const idx = newItems.findIndex(i => i.workDate === activeItem.workDate);
      if (idx >= 0) {
        newItems[idx].clockOut = nowTime;
      }
      setItems(newItems);

      fetchData();
    } catch (e) {
      console.error(e);
      alert("エラーが発生しました");
    } finally {
      setLoading(false);
    }
  };

  const handleBreakStart = async () => {
    if (!user || !activeItem) return;
    setLoading(true);
    try {
      const payload = { userId: user.userId, workDate: activeItem.workDate };

      await fetch(ENDPOINTS.breakStart, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      // Optimistic
      const nowTime = format(new Date(), "HH:mm");
      const newBreaks = [...(activeItem.breaks || []), { start: nowTime, end: "" }];
      const newItems = [...items];
      const idx = newItems.findIndex(i => i.workDate === activeItem.workDate);
      if (idx >= 0) {
        newItems[idx].breaks = newBreaks;
      }
      setItems(newItems);

      fetchData();
    } catch (e) {
      console.error(e);
      alert("エラーが発生しました");
    } finally {
      setLoading(false);
    }
  };

  const handleBreakEnd = async () => {
    if (!user || !activeItem) return;
    setLoading(true);
    try {
      const payload = { userId: user.userId, workDate: activeItem.workDate };

      await fetch(ENDPOINTS.breakEnd, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      // Optimistic
      const nowTime = format(new Date(), "HH:mm");
      const newBreaks = [...(activeItem.breaks || [])];
      if (newBreaks.length > 0) {
        newBreaks[newBreaks.length - 1].end = nowTime;
      }
      const newItems = [...items];
      const idx = newItems.findIndex(i => i.workDate === activeItem.workDate);
      if (idx >= 0) {
        newItems[idx].breaks = newBreaks;
      }
      setItems(newItems);

      fetchData();
    } catch (e) {
      console.error(e);
      alert("エラーが発生しました");
    } finally {
      setLoading(false);
    }
  };

  const fetchData = async () => {
    try {
      const res = await fetch(`${API_BASE}/attendance?userId=${user.userId}`);
      const data = await res.json();
      if (data.success) {
        setItems(data.items);
      }
    } catch (e) {
      console.error(e);
    }
  };

  /* --- ALERTS / NOTIFICATIONS --- */
  const alerts = items.filter(item => {
    const p = parseComment(item.comment);
    const app = p.application || {};
    const isResubmit = app.status === "resubmission_requested";

    const workMin = calcWorkMin(item);
    const isError = (item.clockIn && item.clockOut && workMin <= 0);

    const today = format(new Date(), "yyyy-MM-dd");
    const isPast = item.workDate < today;
    const isIncomplete = (item.clockIn && !item.clockOut && isPast);

    return isResubmit || isError || isIncomplete;
  }).sort((a, b) => b.workDate.localeCompare(a.workDate)); // Newest first

  /* --- ACTIONS --- */
  const handleEdit = (dayStr, item) => {
    // Toggle expand
    if (expandedDate === dayStr) {
      setExpandedDate(null);
      return;
    }
    setExpandedDate(dayStr);

    // Check if there is an admin feedback
    const p = parseComment(item?.comment);
    const app = p.application || {};
    setAdminFeedback(app.adminComment || "");

    const shift = getShift(user?.userName, dayStr);

    if (item) {
      // Use existing values or defaults
      setFormIn(item.clockIn || shift?.start || "");
      setFormOut(item.clockOut || shift?.end || "");
      setFormBreaks(item.breaks || []);

      if (item.segments && item.segments.length > 0) {
        setFormSegments(item.segments);
      } else if (p.segments && p.segments.length > 0) {
        setFormSegments(p.segments);
      } else {
        // Default segment based on User Default
        setFormSegments([{
          location: user.defaultLocation || LOCATIONS[0],
          department: user.defaultDepartment || DEPARTMENTS[0],
          hours: ""
        }]);
      }

      setFormText(p.text || ""); // Set text
      // Set Reason
      if (app.reason && REASON_OPTIONS.includes(app.reason)) setReason(app.reason);
      else setReason(REASON_OPTIONS[0]);

    } else {
      setFormIn(shift?.start || "");
      setFormOut(shift?.end || "");
      setFormBreaks([]);
      setAdminFeedback("");
      setFormSegments([{ location: user.defaultLocation || LOCATIONS[0], department: user.defaultDepartment || DEPARTMENTS[0], hours: "" }]);
      setFormText("");
      setReason(REASON_OPTIONS[0]);
    }
    // setModalOpen(true); // Removed
  };

  const addBreak = () => setFormBreaks([...formBreaks, { start: "", end: "" }]);
  const removeBreak = (i) => {
    const n = [...formBreaks];
    n.splice(i, 1);
    setFormBreaks(n);
  };
  const updateBreak = (i, field, val) => {
    const n = [...formBreaks];
    n[i][field] = val;
    setFormBreaks(n);
  };

  const addSegment = () => setFormSegments([...formSegments, { location: LOCATIONS[0], department: DEPARTMENTS[0], hours: "" }]);
  const removeSegment = (i) => {
    const n = [...formSegments];
    n.splice(i, 1);
    setFormSegments(n);
  };
  const updateSegment = (i, field, val) => {
    const n = [...formSegments];
    n[i][field] = val;
    setFormSegments(n);
  };

  const handleUpdate = async () => {
    setLoading(true);
    try {
      if (!expandedDate) return;

      const originalItem = items.find(i => i.workDate === expandedDate);
      const shift = getShift(user.userName, expandedDate);

      // --- VALIDATION START ---
      // 1. Reason Check for "Other"
      if (reason === "その他" && (!formText || !formText.trim())) {
        alert("修正理由が「その他」の場合は、詳細な理由（コメント）の入力が必須です。");
        setLoading(false);
        return;
      }

      // 2. Lateness/Early Check
      let isLate = false;
      let isEarly = false;
      const intendedIn = shift ? shift.start : null;
      const intendedOut = shift ? shift.end : null;

      // Late if Actual (formIn) > Scheduled (intendedIn)
      if (intendedIn && formIn && toMin(formIn) > toMin(intendedIn)) isLate = true;
      // Early if Actual (formOut) < Scheduled (intendedOut)
      if (intendedOut && formOut && toMin(formOut) < toMin(intendedOut)) isEarly = true;

      const isDiscrepancy = isLate || isEarly;

      // Strict Rule: If Discrepancy, Reason IS Required.
      // And we rely on shift data.
      if (isDiscrepancy && !reason) {
        const msg = [];
        if (isLate) msg.push(`本来の出勤時間(${intendedIn})より遅れています`);
        if (isEarly) msg.push(`本来の退勤時間(${intendedOut})より早まっています`);
        alert(`${msg.join("・")}。\n遅刻/早退のため、修正理由の入力が必須です`);
        setLoading(false);
        return;
      }
      // --- VALIDATION END ---

      const p = parseComment(originalItem?.comment);

      const application = {
        status: "pending",
        appliedAt: new Date().toISOString(),
        appliedIn: formIn,
        appliedOut: formOut,
        reason: reason,
        adminComment: null
      };

      const commentObj = {
        segments: formSegments,
        text: formText || "",
        application: application
      };

      const payload = {
        userId: user.userId,
        workDate: expandedDate,
        clockIn: formIn,
        clockOut: formOut,
        breaks: formBreaks.filter(b => b.start && b.end),
        comment: JSON.stringify(commentObj),
        location: formSegments[0]?.location || "",
        department: formSegments[0]?.department || ""
      };

      await fetch(ENDPOINTS.update, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      setExpandedDate(null); // Close inline
      fetchData();
    } catch (e) {
      console.error(e);
      alert("保存に失敗しました: " + (e.message || "Error"));
    } finally {
      setLoading(false);
    }
  };

  /* --- STATISTICS CALCULATION --- */
  const stats = useMemo(() => {
    let days = 0;
    let dispatchMin = 0;
    let partTimeMin = 0;

    items.forEach(item => {
      if (item.workDate.startsWith(format(currentDate, "yyyy-MM"))) {
        if (item.clockIn) {
          days++;
          const wm = calcRoundedWorkMin(item);

          // Get Shift to check Dispatch status
          const s = getShift(user.userName, item.workDate);
          if (s && s.isDispatch) {
            // Dispatch Logic: First 8h is Dispatch, Rest is PartTime
            const disp = Math.min(wm, 8 * 60);
            const part = Math.max(0, wm - 8 * 60);
            dispatchMin += disp;
            partTimeMin += part;
          } else {
            // All PartTime
            partTimeMin += wm;
          }
        }
      }
    });

    const dispH = Math.floor(dispatchMin / 60);
    const dispM = dispatchMin % 60;
    const partH = Math.floor(partTimeMin / 60);
    const partM = partTimeMin % 60;

    const totalMin = dispatchMin + partTimeMin;
    const avgMin = days > 0 ? Math.floor(totalMin / days) : 0;
    const avgHours = Math.floor(avgMin / 60);

    return { days, dispH, dispM, partH, partM, avgHours };
  }, [items, currentDate, shiftMap, user]);

  const unappliedCount = items.filter(i => {
    const p = parseComment(i.comment);
    const app = p.application;
    // Fix: Only count as "Unapplied" if clockOut exists (work finished) OR if admin requested resubmission
    // If clockIn exists but no clockOut, it's either "Working" or "Forgot Clockout" (handled separately)
    if (i.clockIn && i.clockOut && !app?.status) return true;
    if (app?.status === "resubmission_requested") return true;
    return false;
  }).length;

  return (
    <div className="record-container" style={{ width: "100%", margin: "0 auto" }}> {/* RESTORED FULL WIDTH */}

      {/* 1. TOP ALERTS */}
      <div style={{ marginBottom: "20px" }}>
        <div style={{ background: "#eff6ff", color: "#1e40af", padding: "12px 16px", borderRadius: "8px", marginBottom: "8px", display: "flex", alignItems: "center", gap: "8px", fontSize: "0.9rem" }}>
          <Info size={18} />
          前日以降の勤怠が申請可能です
        </div>

        {unappliedCount > 0 && (
          <div style={{ background: "#fef2f2", color: "#b91c1c", padding: "12px 16px", borderRadius: "8px", display: "flex", alignItems: "center", gap: "8px", fontSize: "0.9rem", border: "1px solid #fee2e2" }}>
            <AlertCircle size={18} />
            <span>未申請: <strong>{unappliedCount}件</strong> があります。確認してください。</span>
          </div>
        )}
      </div>

      {/* 2. MAIN ACTION CARD */}
      <div className="card" style={{ padding: "32px", marginBottom: "24px", position: "relative" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "40px" }}>
          <h2 style={{ fontSize: "1.2rem", fontWeight: "bold", display: "flex", alignItems: "center", gap: "10px", margin: 0 }}>
            <Clock size={24} />
            出退勤入力
            <span style={{ fontSize: "0.9rem", color: "#6b7280", fontWeight: "normal", marginLeft: "12px" }}>
              ({format(currentDate, "M")}月の規定日数: {19}日)
              {todayShift && (
                <span style={{ marginLeft: "12px", color: "#2563eb", fontWeight: "bold" }}>
                  本日のシフト: {todayShift.isOff ? "休み" : `${todayShift.start} - ${todayShift.end}`}
                </span>
              )}
            </span>
          </h2>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button
              onClick={() => alert("出張申請機能は開発中です")}
              style={{
                display: "flex", alignItems: "center", gap: "6px",
                background: "#fff", border: "1px solid #a855f7", color: "#a855f7",
                padding: "8px 16px", borderRadius: "6px", cursor: "pointer", fontSize: "0.9rem", fontWeight: "bold"
              }}
            >
              <Briefcase size={16} /> 出張申請
            </button>
            <Info size={16} color="#9ca3af" />
          </div>
        </div>

        {/* Buttons Center */}
        <div style={{ display: "flex", justifyContent: "center", gap: "24px", marginBottom: "16px", flexWrap: "wrap" }}>
          {/* Clock In */}
          <button
            onClick={handleClockIn}
            disabled={loading || activeItem}
            style={{
              width: "160px", height: "64px",
              borderRadius: "8px", border: "none",
              background: activeItem ? "#d1d5db" : "#22c55e",
              color: "#fff",
              fontSize: "1.1rem", fontWeight: "bold",
              cursor: activeItem ? "default" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
              boxShadow: activeItem ? "none" : "0 4px 6px rgba(34,197,94,0.3)"
            }}
          >
            <LogIn size={20} /> 出勤
          </button>

          {/* Break Buttons */}
          {!isOnBreak && activeItem && (
            <button
              onClick={handleBreakStart}
              disabled={loading}
              style={{
                width: "160px", height: "64px",
                borderRadius: "8px", border: "none",
                background: "#f97316",
                color: "#fff",
                fontSize: "1.1rem", fontWeight: "bold",
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
                boxShadow: "0 4px 6px rgba(249,115,22,0.3)"
              }}
            >
              <Coffee size={20} /> 休憩開始
            </button>
          )}

          {isOnBreak && (
            <button
              onClick={handleBreakEnd}
              disabled={loading}
              style={{
                width: "160px", height: "64px",
                borderRadius: "8px", border: "none",
                background: "#f59e0b",
                color: "#fff",
                fontSize: "1.1rem", fontWeight: "bold",
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
                boxShadow: "0 4px 6px rgba(245,158,11,0.3)"
              }}
            >
              <Coffee size={20} /> 休憩終了
            </button>
          )}

          {/* Clock Out */}
          <button
            onClick={handleClockOut}
            disabled={loading || !activeItem}
            style={{
              width: "160px", height: "64px",
              borderRadius: "8px", border: "none",
              background: (!activeItem) ? "#e5e7eb" : "#ef4444",
              color: (!activeItem) ? "#9ca3af" : "#fff",
              fontSize: "1.1rem", fontWeight: "bold",
              cursor: (!activeItem) ? "default" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
              boxShadow: (!activeItem) ? "none" : "0 4px 6px rgba(239,68,68,0.3)"
            }}
          >
            <LogOut size={20} /> 退勤
          </button>
        </div>

        {/* Helper text for default location */}
        {user && (!user.defaultLocation || user.defaultLocation === "未記載") && (
          <div style={{ textAlign: "center", marginTop: "12px", fontSize: "0.85rem", color: "#f59e0b" }}>
            <AlertCircle size={14} style={{ display: "inline", marginRight: "4px" }} />
            デフォルトの勤務地が未設定です。マイページで設定してください。
          </div>
        )}
        {user && user.defaultLocation && user.defaultLocation !== "未記載" && (
          <div style={{ textAlign: "center", marginTop: "12px", fontSize: "0.9rem", color: "#6b7280" }}>
            勤務地: {user.defaultLocation} / 部署: {user.defaultDepartment}
          </div>
        )}

      </div>

      {/* 3. STATS CARDS */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "20px", marginBottom: "32px" }}>
        <div className="card" style={{ padding: "24px" }}>
          <div style={{ fontSize: "0.85rem", color: "#6b7280", marginBottom: "8px" }}>今月の出勤日数</div>
          <div style={{ fontSize: "1.5rem", fontWeight: "bold" }}>{stats.days} 日</div>
        </div>
        <div className="card" style={{ padding: "24px" }}>
          <div style={{ fontSize: "0.85rem", color: "#6b7280", marginBottom: "8px" }}>今月の勤務時間</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            <div style={{ fontSize: "1.1rem", fontWeight: "bold", color: "#2563eb" }}>派遣: {stats.dispH}h {stats.dispM}m</div>
            <div style={{ fontSize: "1.1rem", fontWeight: "bold", color: "#16a34a" }}>バイト: {stats.partH}h {stats.partM}m</div>
          </div>
        </div>
        <div className="card" style={{ padding: "24px" }}>
          <div style={{ fontSize: "0.85rem", color: "#6b7280", marginBottom: "8px" }}>平均勤務時間</div>
          <div style={{ fontSize: "1.5rem", fontWeight: "bold" }}>{stats.avgHours} 時間</div>
        </div>
      </div>

      {/* 4. HISTORY SECTION */}
      <div className="card" style={{ padding: "0" }}>
        <div style={{ padding: "24px", borderBottom: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ fontSize: "1.1rem", fontWeight: "bold", margin: 0 }}>勤務履歴</h3>

          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <button
              onClick={handlePrevMonth}
              style={{ background: "none", border: "1px solid #d1d5db", borderRadius: "4px", padding: "4px 8px", cursor: "pointer", display: "flex", alignItems: "center" }}
            >
              <ChevronLeft size={16} /> <span style={{ fontSize: "0.8rem", marginLeft: "4px" }}>先月</span>
            </button>

            <span style={{ fontWeight: "bold", fontSize: "1rem" }}>{format(currentDate, "yyyy年 M月")}</span>

            <button
              onClick={handleNextMonth}
              style={{ background: "none", border: "1px solid #d1d5db", borderRadius: "4px", padding: "4px 8px", cursor: "pointer", display: "flex", alignItems: "center" }}
            >
              <span style={{ fontSize: "0.8rem", marginRight: "4px" }}>翌月</span> <ChevronRight size={16} />
            </button>
          </div>
        </div>

        <div style={{ padding: "0 24px 24px" }}>
          {/* Table Header like */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr 2fr 100px", padding: "16px 0", borderBottom: "1px solid #e5e7eb", color: "#6b7280", fontSize: "0.85rem", fontWeight: "bold" }}>
            <div>日付</div>
            <div>出勤</div>
            <div>退勤</div>
            <div>休憩</div>
            <div>勤務</div>
            <div>勤務地 / 部署 / コメント</div>
            <div></div>
          </div>

          {items
            .filter(item => item.workDate.startsWith(format(currentDate, "yyyy-MM")))
            .sort((a, b) => b.workDate.localeCompare(a.workDate))
            .map(item => {
              // Multi-shift safe parsing
              const baseDateStr = item.workDate.split("_")[0];
              const shiftNum = item.workDate.split("_")[1] ? parseInt(item.workDate.split("_")[1]) : 1;
              const day = new Date(baseDateStr);
              const isSat = isSaturday(day);
              const isSun = isSunday(day);
              const isHol = isHoliday(day);
              const p = parseComment(item.comment);
              const app = p.application;
              // Fix: Visual badge same logic
              const isUnapplied = item.clockIn && item.clockOut && !app?.status;
              const isResubmit = app?.status === "resubmission_requested";

              let bgStyle = {};
              if (isUnapplied) bgStyle = { background: "#fffbfc" }; // Slight tint?
              if (isResubmit) bgStyle = { background: "#fff5f5" };

              const isExpanded = (item.workDate === expandedDate);

              return (
                <React.Fragment key={item.workDate}>
                  <div style={{
                    display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr 2fr 100px",
                    padding: "16px 0", borderBottom: "1px solid #f3f4f6", alignItems: "center",
                    fontSize: "0.9rem", ...bgStyle
                  }}>
                    {/* Date */}
                    <div>
                      {format(day, "M/dd")}(
                      <span style={{ color: (isSun || isHol) ? "#ef4444" : isSat ? "#3b82f6" : "inherit" }}>
                        {format(day, "E", { locale: ja })}
                      </span>)
                      {shiftNum > 1 && <span style={{ fontSize: "0.8rem", color: "#6b7280", marginLeft: "4px" }}>({shiftNum}回目)</span>}
                    </div>

                    {/* Times */}
                    <div>{item.clockIn || "-"}</div>
                    <div>{item.clockOut || "-"}</div>
                    <div>{item.clockOut ? calcBreakTime(item) + "分" : "-"}</div>
                    <div>{item.clockOut ? minToTime(calcRoundedWorkMin(item)) : "-"}</div>

                    {/* Details column */}
                    <div>
                      {isUnapplied && <span style={{ fontSize: "0.7rem", color: "#ef4444", border: "1px solid #ef4444", padding: "2px 6px", borderRadius: "12px", background: "#fff" }}>未申請</span>}
                      {isResubmit && <span style={{ fontSize: "0.7rem", color: "#9333ea", border: "1px solid #9333ea", padding: "2px 6px", borderRadius: "12px", background: "#fff" }}>再提出</span>}

                      {/* Shift Logic Badges */}
                      {(() => {
                        const s = getShift(user.userName, item.workDate);
                        if (!s) return null;
                        if (s.isOff) {
                          return <span style={{ marginLeft: "4px", fontSize: "0.7rem", color: "#6b7280", border: "1px solid #d1d5db", padding: "2px 6px", borderRadius: "12px", background: "#f3f4f6" }}>休日</span>;
                        }

                        // Check Late
                        if (item.clockIn && s.start && toMin(item.clockIn) > toMin(s.start)) {
                          return <span style={{ marginLeft: "4px", fontSize: "0.7rem", color: "#b91c1c", border: "1px solid #b91c1c", padding: "2px 6px", borderRadius: "12px", background: "#fef2f2" }}>遅刻</span>;
                        }
                        return null;
                      })()}

                      {(() => {
                        const s = getShift(user.userName, item.workDate);
                        if (s && !s.isOff && !item.clockIn && new Date(item.workDate) < new Date(todayStr)) {
                          return <span style={{ marginLeft: "4px", fontSize: "0.7rem", color: "#4b5563", border: "1px solid #4b5563", padding: "2px 6px", borderRadius: "12px", background: "#f3f4f6" }}>欠勤</span>;
                        }
                        return null;
                      })()}

                      <div style={{ fontSize: "0.8rem", color: "#6b7280", marginTop: "4px" }}>
                        {p.segments.map((s, i) => (
                          <span key={i} style={{ marginRight: "8px", background: "#f3f4f6", padding: "2px 6px", borderRadius: "4px" }}>
                            {s.location} / {s.department}
                          </span>
                        ))}
                        {p.text && <div style={{ marginTop: "2px" }}>{p.text}</div>}
                      </div>
                    </div>

                    {/* Action Button */}
                    <div style={{ textAlign: "right" }}>
                      {app?.status === "pending" ? (
                        <span style={{ fontSize: "0.8rem", color: "#f97316", border: "1px solid #f97316", padding: "4px 10px", borderRadius: "20px", background: "#fff", fontWeight: "bold" }}>
                          承認待ち
                        </span>
                      ) : (
                        <button
                          onClick={() => handleEdit(item.workDate, item)}
                          style={{
                            background: isExpanded ? "#4b5563" : "#3b82f6", // Grey if expanding/closing? Or just keep blue?
                            // User image shows a Pencil icon actually, but let's stick to the button for now or match image if possible.
                            // Image shows a generated edit icon? No, user image shows "未記" badges etc.
                            // The user image 2 shows an edit pen icon on the right.
                            // But I will keep the "申請" button for now to match current state logic, 
                            // changing it to "閉じる" (Close) if expanded might be good interactions.
                            color: "#fff", border: "none",
                            padding: "6px 16px", borderRadius: "20px", fontSize: "0.8rem", cursor: "pointer", fontWeight: "bold"
                          }}
                        >
                          {isExpanded ? (isUnapplied ? "申請" : "修正") : (isUnapplied ? "申請" : "修正")}
                          {/* Actually user just clicked "Submit" on second image. I will keep it simple. */}
                        </button>
                      )}

                      {/* Show edit icon on right if not pending? User image 2 shows a Pencil icon. */}
                      {!isExpanded && !app?.status && (
                        <button onClick={() => handleEdit(item.workDate, item)} style={{ background: "none", border: "none", cursor: "pointer", marginLeft: "8px" }}>
                          <Pencil size={16} color="#9ca3af" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* INLINE FORM */}
                  {isExpanded && (
                    <div style={{
                      gridColumn: "1 / -1",
                      background: "#fee2e2", // Pinkish background
                      padding: "24px",
                      borderRadius: "8px",
                      marginTop: "8px",
                      marginBottom: "16px"
                    }}>
                      {/* Admin Feedback Inline */}
                      {adminFeedback && (
                        <div style={{
                          background: "#fff", border: "1px solid #fca5a5", padding: "12px", borderRadius: "8px", marginBottom: "16px", color: "#b91c1c", fontSize: "0.9rem"
                        }}>
                          <strong>管理者からのメッセージ:</strong> {adminFeedback}
                        </div>
                      )}

                      <div style={{ marginBottom: "16px" }}>
                        <div style={{ fontSize: "0.85rem", color: "#6b7280", marginBottom: "4px" }}>勤務地 / 部署 / コメント</div>
                        {formSegments.map((s, i) => (
                          <div key={i} style={{ display: "flex", gap: "8px", marginBottom: "8px", alignItems: "center" }}>
                            <span style={{ fontSize: "0.8rem", background: "#fff", padding: "2px 6px", borderRadius: "4px" }}>未記載</span>
                            <span style={{ fontSize: "0.8rem", background: "#fff", padding: "2px 6px", borderRadius: "4px" }}>未記載</span>
                          </div>
                        ))}
                        {/* NOTE: user image shows "未記載" badges, but also inputs below. 
                             The inputs below are handled by formSegments. 
                             I'll mimic the form layout from the image.
                             Image shows:
                             - Top: Badges (read only representation?)
                             - Label: "勤務地" -> Select "未記載"
                             - Label: "部署" -> Select "未記載"
                             - Label: "区間を追加"
                             - Inputs "本来の出勤時刻" "本来の退勤時刻"
                             - Logic for segments editing
                         */}

                        {/* Actual Segment Editor */}
                        {formSegments.map((s, i) => (
                          <div key={i} style={{ background: "#fff", padding: "12px", borderRadius: "8px", marginBottom: "8px" }}>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "8px" }}>
                              <div>
                                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: "bold", marginBottom: "4px" }}>勤務地</label>
                                <select
                                  value={s.location}
                                  onChange={e => updateSegment(i, "location", e.target.value)}
                                  style={{ width: "100%", padding: "8px", border: "1px solid #d1d5db", borderRadius: "4px" }}
                                >
                                  {LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
                                </select>
                              </div>
                              <div>
                                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: "bold", marginBottom: "4px" }}>部署</label>
                                <select
                                  value={s.department}
                                  onChange={e => updateSegment(i, "department", e.target.value)}
                                  style={{ width: "100%", padding: "8px", border: "1px solid #d1d5db", borderRadius: "4px" }}
                                >
                                  {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                                </select>
                              </div>
                            </div>
                            <button onClick={() => removeSegment(i)} style={{ fontSize: "0.8rem", color: "#ef4444", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
                              削除
                            </button>
                          </div>
                        ))}
                        <button onClick={addSegment} style={{
                          width: "100%", padding: "8px", border: "1px dashed #d1d5db", background: "#fff", color: "#6b7280", borderRadius: "4px", cursor: "pointer", fontSize: "0.9rem"
                        }}>
                          + 区間を追加
                        </button>
                      </div>

                      {/* Shift Info Header */}
                      {(() => {
                        const shift = getShift(user.userName, expandedDate);
                        if (shift) {
                          return (
                            <div style={{
                              background: "#eff6ff", border: "1px solid #bfdbfe", padding: "12px", borderRadius: "8px", marginBottom: "16px", color: "#1e40af", fontSize: "0.9rem", fontWeight: "bold"
                            }}>
                              <Info size={16} style={{ display: "inline", marginRight: "6px", verticalAlign: "middle" }} />
                              本日のシフト: {shift.start} - {shift.end}
                            </div>
                          );
                        }
                        return null;
                      })()}

                      {/* Time Inputs */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "16px" }}>
                        <div>
                          <label style={{ display: "block", fontSize: "0.8rem", fontWeight: "bold", marginBottom: "4px" }}>
                            出勤時刻 <span style={{ color: "#ef4444", fontSize: "0.8rem", marginLeft: "4px" }}>(必須)</span>
                          </label>
                          <select
                            value={formIn}
                            onChange={e => setFormIn(e.target.value)}
                            style={{ width: "100%", padding: "8px", border: "1px solid #d1d5db", borderRadius: "4px" }}
                          >
                            <option value="">選択</option>
                            {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                        <div>
                          <label style={{ display: "block", fontSize: "0.8rem", fontWeight: "bold", marginBottom: "4px" }}>
                            退勤時刻 <span style={{ color: "#ef4444", fontSize: "0.8rem", marginLeft: "4px" }}>(必須)</span>
                          </label>
                          <select
                            value={formOut}
                            onChange={e => setFormOut(e.target.value)}
                            style={{ width: "100%", padding: "8px", border: "1px solid #d1d5db", borderRadius: "4px" }}
                          >
                            <option value="">選択</option>
                            {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                      </div>

                      {/* If NO Shift, maybe show optional Original Time or just hide? 
                          User says "If no shift, calculate actual only". 
                          So we don't show Original Time inputs anymore. 
                      */}

                      {/* Lateness/Early Auto-Detection */}
                      {(() => {
                        const shift = getShift(user.userName, expandedDate);

                        let isLate = false;
                        let isEarly = false;
                        let intendedIn = shift ? shift.start : null;
                        let intendedOut = shift ? shift.end : null;

                        if (intendedIn && formIn && toMin(formIn) > toMin(intendedIn)) isLate = true;
                        if (intendedOut && formOut && toMin(formOut) < toMin(intendedOut)) isEarly = true;

                        /* No shift -> No lateness check */

                        return (
                          <>
                            {isLate && (
                              <div style={{ background: "#fef2f2", color: "#b91c1c", padding: "8px", borderRadius: "6px", fontSize: "0.85rem", marginBottom: "8px", border: "1px solid #fee2e2" }}>
                                ※ シフト開始({intendedIn})より遅れています。「遅刻」等の理由を選択してください。
                              </div>
                            )}
                            {isEarly && (
                              <div style={{ background: "#fef2f2", color: "#b91c1c", padding: "8px", borderRadius: "6px", fontSize: "0.85rem", marginBottom: "8px", border: "1px solid #fee2e2" }}>
                                ※ シフト終了({intendedOut})より早まっています。「早退」等の理由を選択してください。
                              </div>
                            )}
                          </>
                        );
                      })()}

                      {/* Reason - Conditional Display */}
                      {(() => {
                        const shift = getShift(user.userName, expandedDate);
                        let isLate = false;
                        let isEarly = false;

                        if (shift) {
                          if (formIn && toMin(formIn) > toMin(shift.start)) isLate = true;
                          if (formOut && toMin(formOut) < toMin(shift.end)) isEarly = true;
                        }

                        const showReason = isLate || isEarly;

                        if (!showReason) return null;

                        return (
                          <div style={{ marginBottom: "24px" }}>
                            <label style={{ display: "block", fontSize: "0.8rem", fontWeight: "bold", marginBottom: "4px" }}>
                              勤怠修正理由 <span style={{ color: "#ef4444", fontSize: "0.8rem", marginLeft: "4px" }}>(必須)</span>
                            </label>
                            {isLate && <div style={{ fontSize: "0.8rem", color: "#ef4444", marginBottom: "4px" }}>※遅刻の可能性があります</div>}
                            {isEarly && <div style={{ fontSize: "0.8rem", color: "#ef4444", marginBottom: "4px" }}>※早退の可能性があります</div>}
                            <select
                              value={reason}
                              onChange={e => setReason(e.target.value)}
                              style={{ width: "100%", padding: "8px", border: "1px solid #d1d5db", borderRadius: "4px", marginBottom: "8px" }}
                            >
                              <option value="">選択してください</option>
                              {REASON_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>

                            {/* Detailed Text if "Others" */}
                            {reason === "その他" && (
                              <div>
                                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: "bold", marginBottom: "4px" }}>
                                  詳細理由 (コメント) <span style={{ color: "#ef4444", fontSize: "0.8rem", marginLeft: "4px" }}>(必須)</span>
                                </label>
                                <textarea
                                  value={formText}
                                  onChange={e => setFormText(e.target.value)}
                                  placeholder="理由を詳しく入力してください"
                                  style={{ width: "100%", padding: "8px", border: "1px solid #d1d5db", borderRadius: "4px", minHeight: "60px" }}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })()}
                      {/* Original Reason Block was here */}

                      {/* Buttons */}
                      <div style={{ display: "flex", gap: "12px" }}>
                        <button
                          onClick={() => setExpandedDate(null)}
                          style={{
                            flex: 1, padding: "10px", border: "none", background: "#f3f4f6", borderRadius: "20px", fontWeight: "bold", color: "#4b5563", cursor: "pointer"
                          }}
                        >
                          キャンセル
                        </button>
                        <button
                          onClick={handleUpdate}
                          style={{
                            flex: 1, padding: "10px", border: "none", background: "#3b82f6", borderRadius: "20px", fontWeight: "bold", color: "#fff", cursor: "pointer"
                          }}
                        >
                          申請する
                        </button>
                      </div>

                    </div>
                  )}
                </React.Fragment>
              );
            })}

          {items.length === 0 && (
            <div style={{ padding: "40px", textAlign: "center", color: "#9ca3af" }}>
              履歴がありません
            </div>
          )}
        </div>
      </div>


      {/* Modal Removed */}

      <style>{`
        .modal-overlay {
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.5);
            display: flex; align-items: center; justify-content: center;
            z-index: 1000;
        }
        .modal-content {
            background: white;
            padding: 32px;
            border-radius: 12px;
            width: 90%;
            max-width: 500px;
            max-height: 90vh;
            overflow-y: auto;
            box-shadow: 0 4px 20px rgba(0,0,0,0.15);
        }
        .form-group { margin-bottom: 20px; }
        .form-group label { display: block; font-weight: bold; margin-bottom: 8px; color: #374151; }
        .input { width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 1rem; }
        .time-inputs { display: flex; gap: 20px; }
        .break-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
        .modal-actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px; }
        .btn-cancel { background: #f3f4f6; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; color: #4b5563; font-weight: bold; }
        .btn-save { background: #2563eb; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; color: white; font-weight: bold; }
        .btn-save:disabled { background: #93c5fd; cursor: wait; }
        .req { color: #ef4444; font-size: 0.8rem; margin-left: 4px; }
        .btn-small { background: #eff6ff; color: #2563eb; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; display: flex; align-items: center; gap: 4px; font-size: 0.9rem; }
        .icon-btn-del { background: none; border: none; color: #ef4444; cursor: pointer; }

        .alert-box {
            background: #fef2f2;
            border: 1px solid #fee2e2;
            color: #991b1b;
            padding: 16px;
            border-radius: 8px;
            margin-bottom: 24px;
        }
        .alert-list {
            margin: 0; padding: 0; list-style: none;
        }
        .alert-item {
            display: flex;
            align-items: center;
            padding: 8px 0;
            border-bottom: 1px solid #fee2e2;
        }
        .alert-item:last-child { border-bottom: none; }
        .btn-tiny {
            margin-left: auto;
            background: #fff;
            border: 1px solid #f87171;
            color: #ef4444;
            padding: 4px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.8rem;
        }
        .btn-tiny:hover { background: #fee2e2; }
        
        .feedback-box {
            background: #fef2f2;
            border: 1px solid #fca5a5;
            padding: 12px;
            border-radius: 8px;
            margin-bottom: 16px;
            font-size: 0.9rem;
        }
        .segment-box {
            background: #f9fafb;
            padding: 8px;
            border-radius: 6px;
            margin-bottom: 8px;
        }
        .segment-row {
            display: flex; gap: 8px; margin-bottom: 4px;
        }
        .segment-row select {
            flex: 1; padding: 6px; border: 1px solid #d1d5db; border-radius: 4px;
        }
        .btn-text-del {
            background: none; border: none; color: #ef4444; font-size: 0.8rem; cursor: pointer; text-decoration: underline;
        }
      `}</style>
    </div>
  );
}
