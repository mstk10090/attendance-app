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
import HistoryReport from "../components/HistoryReport";
import "../App.css";

const isHoliday = (d) => {
  const s = format(d, "yyyy-MM-dd");
  return HOLIDAYS.includes(s);
};

// Generate 30-minute intervals for 24 hours (00:00 - 24:00)
const TIME_OPTIONS = [];
for (let h = 0; h < 24; h++) {
  const hh = String(h).padStart(2, '0');
  TIME_OPTIONS.push(`${hh}:00`);
  TIME_OPTIONS.push(`${hh}:30`);
}
TIME_OPTIONS.push("24:00"); // 深夜シフト用

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

// 時刻を30分単位に丸める（出勤時刻は切り上げ、退勤時刻は切り捨て）
const roundTimeToHalfHour = (timeStr, mode = "floor") => {
  if (!timeStr) return "";
  const mins = toMin(timeStr);
  let rounded;
  if (mode === "ceil") {
    // 出勤は切り上げ（過少評価を避ける）
    rounded = Math.ceil(mins / 30) * 30;
  } else {
    // 退勤は切り捨て（過大評価を避ける）
    rounded = Math.floor(mins / 30) * 30;
  }
  // 24時間を超えた場合は23:30に
  if (rounded >= 24 * 60) rounded = 23 * 60 + 30;
  return minToTime(rounded);
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
  if (!e.clockIn || !e.clockOut) return 0;
  // 出勤は30分切り上げ、退勤は30分切り捨てしてから実動時間を算出
  const roundedIn = Math.ceil(toMin(e.clockIn) / 30) * 30;
  const roundedOut = Math.floor(toMin(e.clockOut) / 30) * 30;
  const brk = calcBreakTime(e);
  return Math.max(0, roundedOut - roundedIn - brk);
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
  const [currentTime, setCurrentTime] = useState(new Date());

  // 1秒ごとに現在時刻を更新
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);


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

  // --- TRIP MODAL STATE ---
  const [tripModalOpen, setTripModalOpen] = useState(false);
  const [tripDate, setTripDate] = useState("");
  const [tripStart, setTripStart] = useState("09:00");
  const [tripEnd, setTripEnd] = useState("18:00");
  const [tripComment, setTripComment] = useState("");

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

  const handleTripSubmit = async () => {
    if (!tripDate || !tripStart || !tripEnd || !tripComment) {
      alert("日付、時間、コメントは必須です");
      return;
    }
    // Time Validation
    if (toMin(tripStart) >= toMin(tripEnd)) {
      alert("終了時間は開始時間より後である必要があります");
      return;
    }

    // Duplicate Check
    const existingNum = items.filter(i => i.workDate === tripDate).length;
    if (existingNum > 0) {
      alert("同日にすでに申請が行われています。重複して申請することはできません。");
      return;
    }

    setLoading(true);
    try {
      const application = {
        status: "pending",
        type: "business_trip",
        appliedAt: new Date().toISOString(),
        appliedIn: tripStart,
        appliedOut: tripEnd,
        reason: "出張",
        adminComment: null
      };

      const commentObj = {
        segments: [{ location: "出張", department: user.defaultDepartment || "未記載", hours: "" }],
        text: tripComment,
        application: application
      };

      const payload = {
        userId: user.userId,
        workDate: tripDate, // YYYY-MM-DD
        clockIn: tripStart,
        clockOut: tripEnd,
        breaks: [],
        comment: JSON.stringify(commentObj),
        location: (user && user.defaultLocation) || "出張",
        department: (user && user.defaultDepartment) || "未記載"
      };

      // Use apply endpoint
      const res = await fetch(`${API_BASE}/attendance/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const resData = await res.json();
      if (!res.ok || !resData.success) {
        throw new Error(resData.message || "申請に失敗しました (Server Error)");
      }

      setTripModalOpen(false);
      alert("出張申請を完了しました");
      fetchData();
    } catch (e) {
      console.error(e);
      alert("保存に失敗しました");
    } finally {
      setLoading(false);
    }
  };

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

        // シフト通りに出勤していたら自動で承認待ちにする（シフトがない場合も自動申請）
        const lookupDate = newItems[idx].displayDate || newItems[idx].workDate;
        const shift = getShift(user.userName, lookupDate);
        const clockInTime = newItems[idx].clockIn;
        const clockOutTime = nowTime;

        let appliedIn, appliedOut;
        let shouldAutoApply = false;

        if (shift && clockInTime && clockOutTime) {
          const shiftStartMin = toMin(shift.start);
          const shiftEndMin = toMin(shift.end);
          const clockInMin = toMin(clockInTime);
          const clockOutMin = toMin(clockOutTime);

          // シフト開始時刻より前に出勤し、シフト終了時刻より後に退勤している場合のみ自動申請
          if (clockInMin < shiftStartMin && clockOutMin >= shiftEndMin) {
            // シフト通りなのでシフト時間を申請時間とする
            appliedIn = shift.start;
            appliedOut = shift.end;
            shouldAutoApply = true;
          }
          // シフトと乖離がある場合は自動申請しない（手動で理由付き申請が必要）
        }
        // シフトがない場合も自動申請しない（手動で理由付き申請が必要）

        if (shouldAutoApply) {
          // 自動で承認待ちにする
          const existingComment = parseComment(newItems[idx].comment);
          const updatedComment = {
            segments: existingComment.segments || [],
            text: existingComment.text || "",
            application: {
              status: "pending",
              reason: "-",
              appliedIn: appliedIn,
              appliedOut: appliedOut,
              submittedAt: new Date().toISOString(),
              autoApplied: true  // 自動申請フラグ
            }
          };

          // APIで更新
          await fetch(ENDPOINTS.update, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              userId: user.userId,
              workDate: activeItem.workDate,
              clockIn: newItems[idx].clockIn,
              clockOut: nowTime,
              breaks: newItems[idx].breaks || [],
              comment: JSON.stringify(updatedComment),
              location: newItems[idx].location || "",
              department: newItems[idx].department || ""
            }),
          });

          newItems[idx].comment = JSON.stringify(updatedComment);
        }
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
        // Normalize Items (Fix for mangled IDs: 202602-02-02 -> 2026-02-02)
        const normalized = (data.items || []).map(item => {
          let displayDate = item.workDate;
          // Pattern: YYYYMM-MM-DD (Length 12, start with 6 digits then dash)
          // e.g. 202602-02-02
          if (/^\d{6}-\d{2}-\d{2}$/.test(item.workDate)) {
            const yyyymm = item.workDate.substring(0, 6);
            const dd = item.workDate.substring(10, 12);
            displayDate = `${yyyymm.substring(0, 4)}-${yyyymm.substring(4, 6)}-${dd}`;
          }
          return { ...item, displayDate };
        });

        // シフト一致レコードを自動で承認待ちにする（バックグラウンドで更新）
        const today = format(new Date(), "yyyy-MM-dd");
        for (const item of normalized) {
          const p = parseComment(item.comment);
          const existingStatus = p.application?.status;

          // 既にステータスがある場合はスキップ
          if (existingStatus) continue;

          // 取り下げ済みの場合はスキップ（再度自動申請しない）
          if (p.application?.withdrawn) continue;

          // 出勤・退勤が完了していない場合はスキップ
          if (!item.clockIn || !item.clockOut) continue;

          // 未来の日付はスキップ
          const lookupDate = item.displayDate || item.workDate;
          if (lookupDate > today) continue;

          // シフトを取得
          const shift = getShift(user.userName, lookupDate);

          let appliedIn, appliedOut;

          if (shift) {
            // シフトがある場合: シフト通りかチェック（シフト開始前に出勤、シフト終了後に退勤）
            const shiftStartMin = toMin(shift.start);
            const shiftEndMin = toMin(shift.end);
            const clockInMin = toMin(item.clockIn);
            const clockOutMin = toMin(item.clockOut);

            if (clockInMin < shiftStartMin && clockOutMin >= shiftEndMin) {
              // シフト通りなのでシフト時間を申請時間とする
              appliedIn = shift.start;
              appliedOut = shift.end;
            } else {
              // シフトはあるが時間が合わないのでスキップ（手動で理由付き申請が必要）
              continue;
            }
          } else {
            // シフトがない場合もスキップ（手動で理由付き申請が必要）
            continue;
          }

          // 自動で承認待ちにする
          const updatedComment = {
            segments: p.segments || [],
            text: p.text || "",
            application: {
              status: "pending",
              reason: "-",
              appliedIn: appliedIn,
              appliedOut: appliedOut,
              submittedAt: new Date().toISOString(),
              autoApplied: true
            }
          };

          // APIで更新（バックグラウンド）
          fetch(ENDPOINTS.update, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              userId: user.userId,
              workDate: item.workDate,
              clockIn: item.clockIn,
              clockOut: item.clockOut,
              breaks: item.breaks || [],
              comment: JSON.stringify(updatedComment),
              location: item.location || "",
              department: item.department || ""
            }),
          }).catch(err => console.error("Auto-apply failed:", err));

          // ローカルも更新
          item.comment = JSON.stringify(updatedComment);
        }

        setItems(normalized);
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
    setExpandedDate(dayStr); // dayStr is the Key (workDate), potentially mangled

    // Check if there is an admin feedback
    const p = parseComment(item?.comment);
    const app = p.application || {};
    setAdminFeedback(app.adminComment || "");

    // Use displayDate for shift lookup
    const lookupDate = item?.displayDate || item?.workDate || dayStr;
    const shift = getShift(user?.userName, lookupDate);

    if (item) {
      // Use existing values or defaults, rounding to 30-minute intervals
      const clockInRounded = roundTimeToHalfHour(item.clockIn, "ceil"); // 出勤は切り上げ
      const clockOutRounded = roundTimeToHalfHour(item.clockOut, "floor"); // 退勤は切り捨て
      setFormIn(clockInRounded || shift?.start || "");
      setFormOut(clockOutRounded || "");
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
      // Set Reason: Use existing or default to "-"
      if (app.reason && REASON_OPTIONS.includes(app.reason)) setReason(app.reason);
      else setReason(REASON_OPTIONS[0]);

    } else {
      setFormIn(shift?.start || "");
      setFormOut(shift?.end || "");
      setFormBreaks([]);
      setAdminFeedback("");
      setFormSegments([{ location: user.defaultLocation || LOCATIONS[0], department: user.defaultDepartment || DEPARTMENTS[0], hours: "" }]);
      setFormText("");
      setReason(REASON_OPTIONS[0]); // Default to "-"
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
      // Use displayDate for shift lookup
      const lookupDate = originalItem?.displayDate || expandedDate;
      const shift = getShift(user.userName, lookupDate);

      // --- VALIDATION START ---
      // 0. Reason Required Check
      if (!reason || reason === "-") {
        alert("修正・申請理由を選択してください");
        setLoading(false);
        return;
      }

      // 1. Reason Check for "Other"
      if (reason === "その他" && (!formText || !formText.trim())) {
        alert("修正理由が「その他」の場合は、詳細な理由（コメント）の入力が必須です。");
        setLoading(false);
        return;
      }

      // 2. Lateness/Early Check
      // Logic removed as Reason is now mandatory.
      // const isDiscrepancy = ...

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

      // シフト未出勤の場合（originalItemがない、またはclockInがない）
      // workDateは正規化された日付形式（yyyy-MM-dd）を使用する
      const effectiveWorkDate = originalItem?.workDate || expandedDate;

      const payload = {
        userId: user.userId,
        workDate: effectiveWorkDate,
        clockIn: originalItem ? originalItem.clockIn : formIn,   // 既存レコードは元の打刻時間を保持（空文字でもそのまま）
        clockOut: originalItem ? originalItem.clockOut : formOut, // 既存レコードは元の打刻時間を保持（未退勤=""もそのまま）
        breaks: formBreaks.filter(b => b.start && b.end),
        comment: JSON.stringify(commentObj),
        location: formSegments[0]?.location || user.defaultLocation || "",
        department: formSegments[0]?.department || user.defaultDepartment || ""
      };

      // APIを呼び出し - updateはUPSERT動作をする（存在しなければ作成）
      const res = await fetch(ENDPOINTS.update, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error("申請エラー:", res.status, errText);
        alert(`申請に失敗しました (${res.status}): ${errText || "不明なエラー"}`);
        setLoading(false);
        return;
      }

      setExpandedDate(null); // Close inline
      fetchData();
    } catch (e) {
      console.error(e);
      alert("保存に失敗しました: " + (e.message || "Error"));
    } finally {
      setLoading(false);
    }
  };

  const handleWithdraw = async (workDate = null) => {
    const targetDate = workDate || expandedDate;
    if (!targetDate) return;
    if (!window.confirm("申請を取り下げますか？")) return;
    setLoading(true);
    try {
      const originalItem = items.find(i => i.workDate === targetDate);
      if (!originalItem) {
        alert("対象の勤怠データが見つかりません");
        setLoading(false);
        return;
      }
      const p = parseComment(originalItem?.comment);

      // 取り下げフラグを設定（application: nullにすると自動申請で再度pendingに戻るため）
      const newComment = {
        ...p,
        application: { withdrawn: true, withdrawnAt: new Date().toISOString() }
      };

      const payload = {
        userId: user.userId,
        workDate: targetDate,
        clockIn: originalItem.clockIn,
        clockOut: originalItem.clockOut,
        breaks: originalItem.breaks,
        segments: originalItem.segments,
        comment: JSON.stringify(newComment)
      };

      await fetch(`${API_BASE}/attendance/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      alert("申請を取り下げました");
      fetchData();
      if (workDate === expandedDate) setExpandedDate(null);
    } catch (e) {
      console.error(e);
      alert("エラーが発生しました");
    } finally {
      setLoading(false);
    }
  };

  /* --- 欠勤申請 --- */
  const handleAbsentRequest = async () => {
    if (!expandedDate) return;

    setLoading(true);
    try {
      // 完全なペイロードを送信（ドキュメントのCorrect Patternに従う）
      const payload = {
        userId: user.userId,
        workDate: expandedDate,
        clockIn: "",
        clockOut: "",
        breaks: [],
        location: user.defaultLocation || "",
        department: user.defaultDepartment || "",
        comment: JSON.stringify({
          segments: [],
          text: "スタッフによる欠勤申請",
          application: { status: "absent", reason: "欠勤" }
        })
      };

      const res = await fetch(ENDPOINTS.update, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        console.error("欠勤申請エラー:", res.status, await res.text());
        alert(`欠勤申請に失敗しました (${res.status})`);
        return;
      }

      fetchData();
      setExpandedDate(null);
    } catch (e) {
      console.error(e);
      alert("エラーが発生しました");
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
      // Use displayDate for stats
      const dDate = item.displayDate || item.workDate;
      if (dDate.startsWith(format(currentDate, "yyyy-MM"))) {
        // 承認済み（approved）のレコードのみを集計対象とする
        const p = parseComment(item.comment);
        const status = p.application?.status;

        if (status === "approved") {
          days++;

          // 申請時間から勤務時間を計算（承認済みなので申請時間を使用）
          let wm = 0;
          const appliedIn = p.application?.appliedIn;
          const appliedOut = p.application?.appliedOut;

          if (appliedIn && appliedOut) {
            const inMin = toMin(appliedIn);
            const outMin = toMin(appliedOut);
            wm = Math.max(0, outMin - inMin);
          } else if (item.clockIn && item.clockOut) {
            // フォールバック：実際の打刻時間を使用
            wm = calcRoundedWorkMin(item);
          }

          // Get Shift to check Dispatch status. Use displayDate.
          const s = getShift(user.userName, dDate);

          if (s && s.isDispatch && (s.dispatchRange || s.partTimeRange)) {
            // 派遣シフトがある場合: dispatchRangeとpartTimeRangeを使用して正確に計算
            const actualIn = toMin(appliedIn || item.clockIn);
            const actualOut = toMin(appliedOut || item.clockOut);

            // 派遣区間の計算
            if (s.dispatchRange) {
              const dispStart = toMin(s.dispatchRange.start);
              const dispEnd = toMin(s.dispatchRange.end);
              // 実際の出勤時刻と派遣区間の重なりを計算
              const overlapStart = Math.max(actualIn, dispStart);
              const overlapEnd = Math.min(actualOut, dispEnd);
              if (overlapStart < overlapEnd) {
                dispatchMin += (overlapEnd - overlapStart);
              }
            }

            // バイト区間の計算
            if (s.partTimeRange) {
              const partStart = toMin(s.partTimeRange.start);
              const partEnd = toMin(s.partTimeRange.end);
              // 実際の出勤時刻とバイト区間の重なりを計算
              const overlapStart = Math.max(actualIn, partStart);
              const overlapEnd = Math.min(actualOut, partEnd);
              if (overlapStart < overlapEnd) {
                partTimeMin += (overlapEnd - overlapStart);
              }
            }

            // partTimeRangeがない場合（派遣のみの日）で、派遣終了後も働いている場合
            if (!s.partTimeRange && s.dispatchRange) {
              const dispEnd = toMin(s.dispatchRange.end);
              if (actualOut > dispEnd) {
                // 派遣終了後はバイト時間として計算
                partTimeMin += (actualOut - dispEnd);
              }
            }
          } else if (s && s.isDispatch) {
            // dispatchRange/partTimeRangeがない旧データの場合のフォールバック
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
    // 取り下げ済みの場合は未申請としてカウントしない
    if (app?.withdrawn) return false;
    // Fix: Only count as "Unapplied" if clockOut exists (work finished) OR if admin requested resubmission
    // If clockIn exists but no clockOut, it's either "Working" or "Forgot Clockout" (handled separately)
    if (i.clockIn && i.clockOut && !app?.status) return true;
    return false;
  }).length;

  // 再提出依頼のカウント
  const resubmissionCount = items.filter(i => {
    const p = parseComment(i.comment);
    return p.application?.status === "resubmission_requested";
  }).length;

  // 未退勤のカウント（今月・出勤しているが退勤していない、本日を除く）
  const currentMonth = format(currentDate, "yyyy-MM");
  const notClockedOutCount = items.filter(i => {
    const workDate = i.displayDate || i.workDate;
    // 本日は除外（出勤中のため）
    if (workDate === todayStr) return false;
    return workDate.startsWith(currentMonth) && i.clockIn && !i.clockOut;
  }).length;

  // 遅刻のカウント（今月・シフト開始より遅く出勤した場合）
  const lateCount = useMemo(() => {
    if (!user || !shiftMap) return 0;
    return items.filter(item => {
      const dDate = item.displayDate || item.workDate;
      if (!dDate.startsWith(currentMonth)) return false;
      if (!item.clockIn) return false;

      // シフトを取得
      const keysToTry = [
        user.userName,
        `${user.lastName || ""} ${user.firstName || ""}`.trim(),
        `${user.firstName || ""} ${user.lastName || ""}`.trim(),
        `${user.lastName || ""}　${user.firstName || ""}`.trim(),
        `${user.firstName || ""}　${user.lastName || ""}`.trim(),
        `${user.lastName || ""}${user.firstName || ""}`.trim()
      ];
      let shift = null;
      for (const k of keysToTry) {
        if (k && shiftMap[k] && shiftMap[k][dDate]) {
          shift = shiftMap[k][dDate];
          break;
        }
      }


      // シフトがあり、開始時刻より遅く出勤した場合（取消済みの場合は除外）
      if (shift && shift.start && toMin(item.clockIn) >= toMin(shift.start)) {
        // 遅刻取消フラグがある場合は除外
        const p = parseComment(item.comment);
        if (p.application?.lateCancelled) return false;
        return true;
      }
      return false;
    }).length;
  }, [items, user, shiftMap, currentMonth]);

  return (
    <div className="record-container" style={{ width: "100%", margin: "0 auto" }}> {/* RESTORED FULL WIDTH */}

      {/* 1. MAIN ACTION CARD */}
      <div className="card" style={{ padding: "32px", marginBottom: "24px", position: "relative" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "40px" }}>
          <h2 style={{ fontSize: "1.2rem", fontWeight: "bold", display: "flex", alignItems: "center", gap: "10px", margin: 0 }}>
            <Clock size={24} />
            出退勤入力
            <span style={{ fontSize: "0.9rem", color: "#6b7280", fontWeight: "normal", marginLeft: "12px" }}>
              ({format(currentDate, "M")}月の規定日数: {(currentDate.getFullYear() === 2026 && currentDate.getMonth() === 1) ? (user?.employmentType === "学生バイト" ? 16 : 18) : 19}日)
              {todayShift && (
                <span style={{ marginLeft: "12px", color: "#2563eb", fontWeight: "bold" }}>
                  本日のシフト: {todayShift.isOff ? "休み" : `${todayShift.start} - ${todayShift.end}`}
                  {todayShift.original && ["朝", "早", "中", "遅", "深"].some(code => todayShift.original.includes(code)) && (
                    <span style={{ marginLeft: "6px", background: "#eff6ff", color: "#2563eb", padding: "2px 8px", borderRadius: "4px", fontSize: "0.85rem" }}>
                      {todayShift.original.split(/[\s\/]/)[0]}
                    </span>
                  )}
                </span>
              )}
            </span>
          </h2>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button
              onClick={() => {
                setTripDate(format(addDays(new Date(), 1), "yyyy-MM-dd")); // Default tomorrow
                setTripStart("09:00");
                setTripEnd("18:00");
                setTripComment("");
                setTripModalOpen(true);
              }}
              style={{
                display: "flex", alignItems: "center", gap: "6px",
                background: "#fff", border: "1px solid #a855f7", color: "#a855f7",
                padding: "8px 16px", borderRadius: "6px", cursor: "pointer", fontSize: "0.9rem", fontWeight: "bold"
              }}
            >
              <Briefcase size={16} /> 出張申請
            </button>
            <div className="tooltip-container">
              <Info size={16} color="#9ca3af" style={{ cursor: "help" }} />
              <div className="tooltip-text">
                勤怠の修正や申請に関するお問い合わせは<br />
                管理者までご連絡ください。
              </div>
            </div>
          </div>
        </div>

        {/* 現在時刻表示 */}
        <div style={{ textAlign: "center", marginBottom: "24px" }}>
          <div style={{ fontSize: "3rem", fontWeight: "bold", fontFamily: "monospace", color: "#111827", letterSpacing: "2px" }}>
            {format(currentTime, "HH:mm:ss")}
          </div>
          <div style={{ fontSize: "0.95rem", color: "#6b7280", marginTop: "4px" }}>
            {format(currentTime, "yyyy年M月d日 (E)", { locale: ja })}
          </div>
        </div>

        {/* Buttons Center */}
        <div style={{ display: "flex", justifyContent: "center", gap: "24px", marginBottom: "16px", flexWrap: "wrap" }}>
          {/* Clock In */}
          <button
            onClick={handleClockIn}
            disabled={loading || activeItem || (items.find(i => i.workDate === format(new Date(), "yyyy-MM-dd"))?.clockIn)} // Disable if already clocked in today (finished or not)
            style={{
              width: "160px", height: "64px",
              borderRadius: "8px", border: "none",
              background: (activeItem || items.find(i => i.workDate === format(new Date(), "yyyy-MM-dd"))?.clockIn) ? "#d1d5db" : "#22c55e",
              color: "#fff",
              fontSize: "1.1rem", fontWeight: "bold",
              cursor: (activeItem || items.find(i => i.workDate === format(new Date(), "yyyy-MM-dd"))?.clockIn) ? "default" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
              boxShadow: (activeItem || items.find(i => i.workDate === format(new Date(), "yyyy-MM-dd"))?.clockIn) ? "none" : "0 4px 6px rgba(34,197,94,0.3)"
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

      {/* 2. ALERTS */}
      <div style={{ marginBottom: "20px" }}>
        <div style={{ background: "#eff6ff", color: "#1e40af", padding: "12px 16px", borderRadius: "8px", marginBottom: "8px", display: "flex", alignItems: "center", gap: "8px", fontSize: "0.9rem" }}>
          <Info size={18} />
          前日以降の勤怠が申請可能です
        </div>

        {resubmissionCount > 0 && (
          <div style={{ background: "#faf5ff", color: "#7c3aed", padding: "12px 16px", borderRadius: "8px", marginBottom: "8px", display: "flex", alignItems: "center", gap: "8px", fontSize: "0.9rem", border: "1px solid #e9d5ff" }}>
            <AlertCircle size={18} />
            <span>⚠️ <strong>再提出依頼: {resubmissionCount}件</strong> があります。管理者からのコメントを確認して再度申請してください。</span>
          </div>
        )}

        {notClockedOutCount > 0 && (
          <div style={{ background: "#fffbeb", color: "#b45309", padding: "12px 16px", borderRadius: "8px", marginBottom: "8px", display: "flex", alignItems: "center", gap: "8px", fontSize: "0.9rem", border: "1px solid #fde68a" }}>
            <AlertCircle size={18} />
            <span>⏰ <strong>未退勤: {notClockedOutCount}件</strong> があります。退勤打刻を忘れずに。</span>
          </div>
        )}

        {unappliedCount > 0 && (
          <div style={{ background: "#fef2f2", color: "#b91c1c", padding: "12px 16px", borderRadius: "8px", display: "flex", alignItems: "center", gap: "8px", fontSize: "0.9rem", border: "1px solid #fee2e2" }}>
            <AlertCircle size={18} />
            <span>未申請: <strong>{unappliedCount}件</strong> があります。確認してください。</span>
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
        <div className="card" style={{ padding: "24px", background: lateCount > 0 ? "#fef2f2" : undefined }}>
          <div style={{ fontSize: "0.85rem", color: lateCount > 0 ? "#b91c1c" : "#6b7280", marginBottom: "8px" }}>遅刻</div>
          <div style={{ fontSize: "1.5rem", fontWeight: "bold", color: lateCount > 0 ? "#dc2626" : "#374151" }}>{lateCount} 件</div>
        </div>
      </div>


      {/* 4. HISTORY SECTION */}
      <div className="card" style={{ padding: "0", overflow: "hidden" }}>
        <div style={{ padding: "24px", borderBottom: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ fontSize: "1.1rem", fontWeight: "bold", margin: 0 }}>勤務履歴・レポート</h3>

          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <button
              onClick={handlePrevMonth}
              style={{ background: "#fff", border: "1px solid #d1d5db", borderRadius: "6px", padding: "6px 12px", cursor: "pointer", display: "flex", alignItems: "center", transition: "all 0.2s" }}
            >
              <ChevronLeft size={16} /> <span style={{ fontSize: "0.85rem", marginLeft: "4px" }}>先月</span>
            </button>

            <span style={{ fontWeight: "bold", fontSize: "1rem", minWidth: "100px", textAlign: "center" }}>{format(currentDate, "yyyy年 M月")}</span>

            <button
              onClick={handleNextMonth}
              style={{ background: "#fff", border: "1px solid #d1d5db", borderRadius: "6px", padding: "6px 12px", cursor: "pointer", display: "flex", alignItems: "center", transition: "all 0.2s" }}
            >
              <span style={{ fontSize: "0.85rem", marginRight: "4px" }}>翌月</span> <ChevronRight size={16} />
            </button>
          </div>
        </div>

        <div style={{ padding: "24px" }}>
          <HistoryReport
            user={user}
            items={items}
            baseDate={format(currentDate, "yyyy-MM-dd")}
            viewMode="month"
            shiftMap={shiftMap}
            onRowClick={(dateStr, item) => handleEdit(dateStr, item)}
            onWithdraw={(dateStr, item) => handleWithdraw(dateStr)}
          />
        </div>
      </div>

      {/* --- EDIT FORM (Rendered when expandedDate is set) --- */}
      {expandedDate && (
        <>
          <div

            style={{
              position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
              width: "90%", maxWidth: "600px", zIndex: 1000,
              background: "#fff", padding: "24px", borderRadius: "16px",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
              maxHeight: "90vh", overflowY: "auto", border: "1px solid #e5e7eb"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", borderBottom: "1px solid #f3f4f6", paddingBottom: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div style={{ background: "#eff6ff", padding: "8px", borderRadius: "8px", color: "#2563eb" }}>
                  <Pencil size={20} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: "1.1rem", color: "#1f2937" }}>勤怠修正</h3>
                  <div style={{ fontSize: "0.85rem", color: "#6b7280" }}>{format(new Date(expandedDate), "yyyy年MM月dd日", { locale: ja })}</div>
                </div>
              </div>
              <button
                onClick={() => setExpandedDate(null)}
                style={{
                  background: "#f3f4f6", border: "none", cursor: "pointer",
                  width: "32px", height: "32px", borderRadius: "50%",
                  display: "flex", alignItems: "center", justifyContent: "center", color: "#374151",
                  fontSize: "18px", fontWeight: "bold"
                }}
                title="閉じる"
              >
                ✕
              </button>
            </div>

            {/* Admin Feedback Display */}
            {adminFeedback && (
              <div style={{
                background: "#fef2f2", border: "1px solid #fecaca", padding: "12px", borderRadius: "8px", marginBottom: "20px", color: "#b91c1c", fontSize: "0.9rem", display: "flex", gap: "8px", alignItems: "start"
              }}>
                <MessageCircle size={18} style={{ marginTop: "2px", flexShrink: 0 }} />
                <div>
                  <strong style={{ display: "block", marginBottom: "4px" }}>管理者からのメッセージ:</strong>
                  {adminFeedback}
                </div>
              </div>
            )}

            <div style={{ marginBottom: "24px" }}>
              {/* SEGMENTS */}
              <div style={{ fontSize: "0.9rem", fontWeight: "bold", color: "#374151", marginBottom: "8px" }}>勤務場所 / 部署</div>
              {formSegments.map((s, i) => (
                <div key={i} style={{ background: "#f9fafb", padding: "16px", borderRadius: "12px", marginBottom: "12px", border: "1px solid #e5e7eb", position: "relative" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "8px" }}>
                    <div>
                      <label style={{ fontSize: "0.8rem", fontWeight: "bold", color: "#6b7280", marginBottom: "4px", display: "block" }}>勤務地</label>
                      <select value={s.location} onChange={e => updateSegment(i, "location", e.target.value)} className="input" style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid #d1d5db" }}>
                        {LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: "0.8rem", fontWeight: "bold", color: "#6b7280", marginBottom: "4px", display: "block" }}>部署</label>
                      <select value={s.department} onChange={e => updateSegment(i, "department", e.target.value)} className="input" style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid #d1d5db" }}>
                        {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </div>
                  </div>
                  {formSegments.length > 1 && (
                    <button
                      onClick={() => removeSegment(i)}
                      style={{
                        position: "absolute", top: "-8px", right: "-8px",
                        background: "#ef4444", color: "#fff",
                        width: "24px", height: "24px", borderRadius: "50%",
                        border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                        boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              ))}
              <button
                onClick={addSegment}
                style={{
                  width: "100%", padding: "10px", border: "1px dashed #cbd5e1", borderRadius: "8px",
                  background: "#f8fafc", color: "#64748b", fontWeight: "500", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
                  transition: "all 0.2s"
                }}
              >
                <Plus size={16} /> 区間を追加
              </button>
            </div>

            {/* TIME INPUTS */}
            <div style={{ background: "#f9fafb", padding: "16px", borderRadius: "12px", border: "1px solid #e5e7eb", marginBottom: "24px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: "bold", color: "#374151", marginBottom: "6px" }}>出勤時刻</label>
                  <div style={{ position: "relative" }}>
                    <LogIn size={16} style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: "#6b7280" }} />
                    <select value={formIn} onChange={e => setFormIn(e.target.value)} style={{ width: "100%", padding: "10px 10px 10px 32px", borderRadius: "8px", border: "1px solid #d1d5db", fontSize: "1rem" }}>
                      <option value="">未選択</option>
                      {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: "bold", color: "#374151", marginBottom: "6px" }}>退勤時刻</label>
                  <div style={{ position: "relative" }}>
                    <LogOut size={16} style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: "#6b7280" }} />
                    <select value={formOut} onChange={e => setFormOut(e.target.value)} style={{ width: "100%", padding: "10px 10px 10px 32px", borderRadius: "8px", border: "1px solid #d1d5db", fontSize: "1rem" }}>
                      <option value="">未選択</option>
                      {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            </div>

            {/* REASON */}
            <div style={{ marginBottom: "24px" }}>
              <label style={{ display: "block", fontSize: "0.9rem", fontWeight: "bold", marginBottom: "8px", color: "#374151" }}>
                修正・申請理由
                {((formIn && shiftMap[user.userName]?.[expandedDate]?.start && toMin(formIn) > toMin(shiftMap[user.userName]?.[expandedDate]?.start)) || (formOut && shiftMap[user.userName]?.[expandedDate]?.end && toMin(formOut) < toMin(shiftMap[user.userName]?.[expandedDate]?.end))) &&
                  <span style={{ color: "#ef4444", fontSize: "0.8rem", marginLeft: "6px", background: "#fef2f2", padding: "2px 6px", borderRadius: "4px", border: "1px solid #fecaca" }}>遅刻/早退 (必須)</span>
                }
              </label>
              <select value={reason} onChange={e => setReason(e.target.value)} style={{ width: "100%", padding: "12px", borderRadius: "8px", border: "1px solid #d1d5db", marginBottom: "12px", fontSize: "0.95rem" }}>
                <option value="">理由を選択してください</option>
                {REASON_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
              {reason === "その他" && (
                <textarea
                  value={formText}
                  onChange={e => setFormText(e.target.value)}
                  placeholder="具体的な理由を入力してください（必須）"
                  style={{ width: "100%", padding: "12px", borderRadius: "8px", border: "1px solid #d1d5db", minHeight: "80px", fontSize: "0.95rem", boxSizing: "border-box" }}
                />
              )}
            </div>

            <div style={{ display: "flex", gap: "12px", paddingTop: "12px", borderTop: "1px solid #f3f4f6" }}>
              <button onClick={() => setExpandedDate(null)} style={{ flex: 1, padding: "14px", borderRadius: "8px", border: "none", background: "#f3f4f6", color: "#4b5563", fontWeight: "bold", cursor: "pointer" }}>キャンセル</button>
              {adminFeedback && items.find(i => i.workDate === expandedDate)?._application?.status === "pending" && (
                <button
                  type="button"
                  onClick={handleWithdraw}
                  disabled={loading}
                  style={{
                    flex: 1, padding: "14px", borderRadius: "8px", border: "none",
                    background: "#ef4444", color: "#fff", fontWeight: "bold", cursor: loading ? "default" : "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: "8px"
                  }}
                >
                  取り下げ
                </button>
              )}
              {/* Also show withdraw if status is pending generally, not just with feedback? 
                  The user request said "Withdraw pending application". 
                  Let's show it if status is pending. 
              */}
              {!adminFeedback && items.find(i => i.workDate === expandedDate)?._application?.status === "pending" && (
                <button
                  type="button"
                  onClick={handleWithdraw}
                  disabled={loading}
                  style={{
                    flex: 1, padding: "14px", borderRadius: "8px", border: "none",
                    background: "#6b7280", color: "#fff", fontWeight: "bold", cursor: loading ? "default" : "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: "8px"
                  }}
                >
                  申請取り下げ
                </button>
              )}

              {/* 欠勤申請ボタン */}
              <button
                type="button"
                onClick={handleAbsentRequest}
                disabled={loading}
                style={{
                  flex: 1, padding: "14px", borderRadius: "8px", border: "none",
                  background: "#ef4444", color: "#fff", fontWeight: "bold", cursor: loading ? "default" : "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: "8px"
                }}
              >
                欠勤申請
              </button>

              <button
                onClick={handleUpdate}
                disabled={loading}
                style={{
                  flex: 2, padding: "14px", borderRadius: "8px", border: "none",
                  background: loading ? "#93c5fd" : "#2563eb", color: "#fff", fontWeight: "bold", cursor: loading ? "default" : "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
                  boxShadow: "0 4px 6px rgba(37, 99, 235, 0.2)"
                }}
              >
                {loading ? "送信中..." : <><CheckCircle size={20} /> 申請を保存</>}
              </button>
            </div>
          </div>
          <div className="modal-overlay" onClick={() => setExpandedDate(null)} style={{ zIndex: 999 }}></div>
        </>
      )}


      {/* TRIP MODAL (Kept as is) */}
      {tripModalOpen && (
        <div className="modal-overlay">
          <div className="modal" style={{ width: "420px", maxWidth: "90vw" }}>
            <div className="modal-title" style={{ display: "flex", alignItems: "center", gap: "10px", color: "#4b5563" }}>
              <Briefcase size={24} style={{ color: "#a855f7" }} />
              <span>出張申請</span>
            </div>

            <div style={{ marginBottom: "24px" }}>
              <p style={{ fontSize: "0.9rem", color: "#6b7280", margin: 0, lineHeight: "1.5" }}>
                出張の日時と目的を入力してください。<br />
                <span style={{ fontSize: "0.8rem", color: "#9ca3af" }}>※承認待ちとして申請されます。</span>
              </p>
            </div>

            {/* Inputs */}
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              {/* Date */}
              <div>
                <label style={{ display: "block", fontWeight: "bold", fontSize: "0.85rem", marginBottom: "6px", color: "#374151" }}>
                  日付 <span style={{ color: "#ef4444", fontSize: "0.75rem", marginLeft: "4px" }}>(必須)</span>
                </label>
                <input
                  type="date"
                  value={tripDate}
                  onChange={(e) => setTripDate(e.target.value)}
                  style={{
                    width: "100%", padding: "10px 12px", borderRadius: "8px",
                    border: "1px solid #d1d5db", fontSize: "0.95rem",
                    boxSizing: "border-box"
                  }}
                />
              </div>

              {/* Time Range */}
              <div>
                <label style={{ display: "block", fontWeight: "bold", fontSize: "0.85rem", marginBottom: "6px", color: "#374151" }}>
                  時間 <span style={{ color: "#ef4444", fontSize: "0.75rem", marginLeft: "4px" }}>(必須)</span>
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <select
                    value={tripStart}
                    onChange={(e) => setTripStart(e.target.value)}
                    style={{
                      flex: 1, padding: "10px", borderRadius: "8px",
                      border: "1px solid #d1d5db", fontSize: "0.95rem",
                      background: "#fff", cursor: "pointer"
                    }}
                  >
                    {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <span style={{ color: "#9ca3af", fontWeight: "bold" }}>～</span>
                  <select
                    value={tripEnd}
                    onChange={(e) => setTripEnd(e.target.value)}
                    style={{
                      flex: 1, padding: "10px", borderRadius: "8px",
                      border: "1px solid #d1d5db", fontSize: "0.95rem",
                      background: "#fff", cursor: "pointer"
                    }}
                  >
                    {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              {/* Comment */}
              <div>
                <label style={{ display: "block", fontWeight: "bold", fontSize: "0.85rem", marginBottom: "6px", color: "#374151" }}>
                  詳細・目的 <span style={{ color: "#ef4444", fontSize: "0.75rem", marginLeft: "4px" }}>(必須)</span>
                </label>
                <textarea
                  value={tripComment}
                  onChange={(e) => setTripComment(e.target.value)}
                  placeholder="例: クライアント訪問のため (○○株式会社)"
                  style={{
                    width: "100%", padding: "10px 12px", borderRadius: "8px",
                    border: "1px solid #d1d5db", fontSize: "0.95rem",
                    minHeight: "100px", resize: "vertical",
                    boxSizing: "border-box", fontFamily: "inherit"
                  }}
                />
              </div>
            </div>

            {/* Actions */}
            <div className="modal-actions" style={{ marginTop: "32px" }}>
              <button
                className="modal-btn modal-cancel"
                onClick={() => setTripModalOpen(false)}
              >
                キャンセル
              </button>
              <button
                className="modal-btn"
                style={{ background: "#a855f7", color: "#fff" }} // Purple to match the button that opens it
                onClick={handleTripSubmit}
                disabled={loading}
              >
                {loading ? "送信中..." : "申請する"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Styles for Modal */}
      <style>{`
        .modal-overlay {
          position: fixed; top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000;
          backdrop-filter: blur(2px);
        }
        .modal {
          background: #fff; padding: 32px; borderRadius: 16px;
          box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25);
          animation: modalFadeIn 0.2s ease-out;
        }
        @keyframes modalFadeIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
        .modal-actions { display: flex; gap: 12px; justify-content: flex-end; }
        .modal-btn {
          padding: 10px 20px; border-radius: 8px; border: none; cursor: pointer; font-weight: bold; transition: all 0.2s;
        }
        .modal-cancel { background: #f3f4f6; color: #4b5563; }
        .modal-cancel:hover { background: #e5e7eb; }
      `}</style>

    </div>
  );
}
