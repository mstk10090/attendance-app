import React, { useEffect, useState, useMemo, useCallback } from "react";
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
import { useSearchParams } from "react-router-dom";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSaturday, isSunday, addDays, subDays, isSameDay, addMonths, subMonths } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ja } from "date-fns/locale";
import { HOLIDAYS, LOCATIONS, DEPARTMENTS, REASON_OPTIONS, REASON_SUB_OPTIONS, ABSENT_REASONS, getLocationByIp } from "../constants";
import HistoryReport from "../components/HistoryReport";
import StaffManual from "./StaffManual";
import { normalizeName } from "../utils/shiftParser";
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
  // 24時間を超えた場合（例：日跨ぎで24:00より後になった場合）は最大24:00とする
  if (rounded > 24 * 60) rounded = 24 * 60;
  return minToTime(rounded);
};

const calcBreakTime = (e) => {
  if (!e.breaks || e.breaks.length === 0) return 0;
  const raw = e.breaks.reduce((acc, b) => {
    if (b.start && b.end) {
      return acc + (toMin(b.end) - toMin(b.start));
    }
    return acc;
  }, 0);
  if (raw <= 0) return 0;
  return Math.ceil(raw / 30) * 30; // 30分切り上げ丸め
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
    if (!raw) return { segments: [], text: "", application: null, auditLog: [] };
    if (typeof raw === "object") return { ...raw, auditLog: raw.auditLog || [] };
    const parsed = JSON.parse(raw);

    // Support new structure { segments, text, application, auditLog }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return {
        segments: parsed.segments || [],
        text: parsed.text || "",
        application: parsed.application || null,
        auditLog: parsed.auditLog || []
      };
    }
    // Fallback for old array structure
    if (Array.isArray(parsed)) return { segments: parsed, text: "", application: null, auditLog: [] };
    return { segments: [], text: raw, application: null, auditLog: [] };
  } catch (e) {
    return { segments: [], text: raw || "", application: null, auditLog: [] };
  }
};

export default function AttendanceRecord({ user: propUser }) {
  const [searchParams, setSearchParams] = useSearchParams();
  // Use prop or fallback to localStorage
  const user = useMemo(() => {
    if (propUser) return propUser;
    const uid = localStorage.getItem("userId");
    if (!uid) return null;
    return {
      userId: uid,
      userName: localStorage.getItem("userName"),
      defaultLocation: localStorage.getItem("defaultLocation") || "未記載",
      defaultDepartment: localStorage.getItem("defaultDepartment") || "未記載",
      employmentType: localStorage.getItem("employmentType") || ""
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
  const [formBreakDuration, setFormBreakDuration] = useState(0); // 休憩時間（分）
  const [formSegments, setFormSegments] = useState([]);
  const [reason, setReason] = useState(REASON_OPTIONS[0]);
  const [subReason, setSubReason] = useState(""); // サブ理由（早退/欠勤/遅刻の詳細理由）
  const [subReasonText, setSubReasonText] = useState(""); // サブ理由がその他の場合のテキスト
  const [formText, setFormText] = useState(""); // 出張場所/残業理由等のテキスト
  const [formForgotActualIn, setFormForgotActualIn] = useState(""); // 打刻忘れ: 実際の出社時間
  const [formForgotActualOut, setFormForgotActualOut] = useState(""); // 打刻忘れ: 実際の退勤時間
  const [absentReason, setAbsentReason] = useState(ABSENT_REASONS[0]); // 後方互換用
  const [absentReasonText, setAbsentReasonText] = useState(""); // 後方互換用
  const [loading, setLoading] = useState(false);

  // Resubmission Context
  const [adminFeedback, setAdminFeedback] = useState("");

  // --- TRIP MODAL STATE ---
  const [tripModalOpen, setTripModalOpen] = useState(false);
  const [tripDate, setTripDate] = useState("");
  const [tripStart, setTripStart] = useState("09:00");
  const [tripEnd, setTripEnd] = useState("18:00");
  const [tripComment, setTripComment] = useState("");

  // --- 乖離理由モーダル STATE ---
  const [discrepancyModalOpen, setDiscrepancyModalOpen] = useState(false);
  const [discrepancyMode, setDiscrepancyMode] = useState(null); // "clockIn" or "clockOut"
  const [discrepancyReason, setDiscrepancyReason] = useState("");
  const [discrepancySubReason, setDiscrepancySubReason] = useState("");
  const [discrepancySubReasonText, setDiscrepancySubReasonText] = useState("");
  const [discrepancyText, setDiscrepancyText] = useState("");
  const [discrepancyInfo, setDiscrepancyInfo] = useState(null); // { shiftStart, shiftEnd, clockIn, clockOutTime }
  const [forgotClockActualIn, setForgotClockActualIn] = useState(""); // 打刻忘れ: 実際の出社時間
  const [forgotClockActualOut, setForgotClockActualOut] = useState(""); // 打刻忘れ: 実際の退勤時間
  const [discrepancyAppliedIn, setDiscrepancyAppliedIn] = useState(""); // 乖離モーダル: 申請する出勤時間
  const [discrepancyAppliedOut, setDiscrepancyAppliedOut] = useState(""); // 乖離モーダル: 申請する退勤時間
  const [isForgotClockToggle, setIsForgotClockToggle] = useState(false); // 打刻忘れトグル
  // 複数乖離理由 STATE
  const [detectedReasons, setDetectedReasons] = useState([]); // [{ type: "遅刻"|"残業", label: "...", detail: "", subReason: "", subReasonText: "" }]

  const handlePrevMonth = () => {
    setCurrentDate(prev => subMonths(prev, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(prev => addMonths(prev, 1));
  };

  // --- SHIFT DATA INTEGRATION ---
  const [shiftMap, setShiftMap] = useState({}); // { [userName]: { [dayInt]: { start, end } } }
  const [shiftLoaded, setShiftLoaded] = useState(false);
  const shiftModuleRef = React.useRef(null);

  useEffect(() => {
    // ① キャッシュから即座に読み込み（高速）
    try {
      const cached = localStorage.getItem("shift_data_cache");
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Object.keys(parsed).length > 0) {
          setShiftMap(parsed);
          setShiftLoaded(true);
        }
      }
    } catch (e) { /* ignore */ }

    // ② バックグラウンドでスプシ/APIからリフレッシュ
    import("../utils/shiftParser").then(mod => {
      shiftModuleRef.current = mod;
      mod.fetchShiftData().then(data => {
        setShiftMap(data);
        setShiftLoaded(true);
      }).catch(() => setShiftLoaded(true));
    });
  }, []);

  const getShift = (uName, dateStr) => {
    if (!uName || !shiftMap) return null;

    // normalizeName で正規化してルックアップ（parseCsv/キャッシュ側も正規化済み）
    const normalized = normalizeName(uName);
    if (shiftMap[normalized]?.[dateStr]) return shiftMap[normalized][dateStr];

    // loginIdで試行
    const loginId = localStorage.getItem("loginId");
    if (loginId && shiftMap[loginId]?.[dateStr]) return shiftMap[loginId][dateStr];

    return null;
  };
  // -----------------------------

  useEffect(() => {
    if (user && user.userId) {
      fetchData();
    }
  }, [user, currentDate]);

  // Multi-Shift Support
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const yesterdayStr = format(subDays(new Date(), 1), "yyyy-MM-dd");
  const todayItems = items.filter(i => i.workDate.startsWith(todayStr));
  const yesterdayItems = items.filter(i => i.workDate.startsWith(yesterdayStr));

  // 未退勤アイテムを検索（昨日の未退勤レコードがあれば優先して拾う）
  let activeItem = yesterdayItems.find(i => i.clockIn && !i.clockOut) || null;
  if (!activeItem) {
    activeItem = todayItems.find(i => i.clockIn && !i.clockOut) || null;
  }
  
  // 今日退勤済みかどうか
  // （以前は「退勤したらその日の出勤不可(20時まで)」としていたが、
  // 日跨ぎ分割や同日複数回出勤の要望により解除。未退勤データがなければいつでも出勤可能とする）
  const hasClockedOut = false;
  
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
        application: application,
        auditLog: [{ action: "submitted", by: user.userName || user.loginId || "スタッフ", at: new Date().toISOString(), detail: "出張申請を提出しました" }]
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

  // IPアドレス取得ユーティリティ
  const fetchClientIp = async () => {
    try {
      const res = await fetch("https://api.ipify.org?format=json", { signal: AbortSignal.timeout(5000) });
      const data = await res.json();
      return data.ip || null;
    } catch {
      return null;
    }
  };

  // auditLogに打刻ログを追加するヘルパー
  const addPunchLog = (existingComment, action, userName, ip) => {
    const p = parseComment(existingComment || "");
    const location = getLocationByIp(ip);
    const logEntry = {
      action,
      by: userName || "スタッフ",
      at: new Date().toISOString(),
      detail: ip ? `${action === "clock_in" ? "出勤" : action === "clock_out" ? "退勤" : action === "break_start" ? "休憩開始" : "休憩終了"}（${location}）` : `${action === "clock_in" ? "出勤" : action === "clock_out" ? "退勤" : action === "break_start" ? "休憩開始" : "休憩終了"}`,
      ip: ip || null,
      location: location
    };
    const auditLog = [...(p.auditLog || []), logEntry];
    return { ...p, auditLog };
  };

  // Clock In/Out Handlers
  // Clock In/Out Handlers
  const handleClockIn = async () => {
    if (!user) return;

    // Multi-shift Logic
    // If we have an active item (clockIn but no clockOut), we can't clock in again.
    if (activeItem) {
      alert("既に出勤しています。");
      return;
    }

    const nowTime = format(new Date(), "HH:mm");

    // 乖離チェックは退勤時にまとめて行うため、出勤時は常に通常出勤
    await executeClockIn(nowTime);
  };

  // 出勤実行（乖離理由込み or なし）
  const executeClockIn = async (clockInTime, reasonStr = null, subReasonVal = null, subReasonTextVal = null, textVal = null) => {
    setLoading(true);
    try {
      // Determine Target Date Key (Suffixed if needed)
      let targetDateKey = todayStr;
      if (todayItems.length > 0) {
        const last = todayItems[todayItems.length - 1];
        if (last.clockOut) {
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

      // IPアドレス取得（バックグラウンド）
      const clientIp = await fetchClientIp();

      // 乖離理由がある場合はコメントに保存
      const baseSegment = {
        location: user.defaultLocation || "未記載",
        department: user.defaultDepartment || "未記載",
        hours: ""
      };

      let applicationData = null;
      if (reasonStr) {
        applicationData = {
          status: "pending",
          reason: reasonStr,
          subReason: subReasonVal || null,
          subReasonText: subReasonTextVal || null,
          detailText: textVal || null,
          appliedIn: clockInTime,
          appliedOut: '',
          appliedAt: new Date().toISOString()
        };
      }

      // 出勤ログをauditLogに記録
      const clockInLog = {
        action: "clock_in",
        by: user.userName || user.loginId || "スタッフ",
        at: new Date().toISOString(),
        detail: `出勤（${getLocationByIp(clientIp)}）`,
        ip: clientIp,
        location: getLocationByIp(clientIp)
      };

      const defaultComment = JSON.stringify({
        segments: [baseSegment],
        text: "",
        application: applicationData,
        auditLog: [clockInLog]
      });

      // コメント更新をAPIに送信（理由の有無に関わらず、出勤ログを記録するため常に更新）
      await fetch(`${API_BASE}/attendance/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.userId,
          workDate: targetDateKey,
          clockIn: clockInTime,
          clockOut: '',
          breaks: [],
          comment: defaultComment
        }),
      });

      const newItems = [...items];
      newItems.push({
        userId: user.userId,
        workDate: targetDateKey,
        clockIn: clockInTime,
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

  // 動的な乖離再計算関数
  const calculateDiscrepancies = useCallback((compareInStr, compareOutStr, shiftObj) => {
    if (!shiftObj || !shiftObj.start || !shiftObj.end) {
      return [{ type: "シフトなし", label: "シフト未登録", detail: "", subReason: "", subReasonText: "" }];
    }
    const sStart = toMin(shiftObj.start);
    const sEnd = toMin(shiftObj.end);
    const cIn = compareInStr ? toMin(compareInStr) : null;
    const cOut = compareOutStr ? toMin(compareOutStr) : null;

    const reasons = [];
    if (cIn !== null && cIn >= sStart) {
      // 出勤打刻がシフト開始より後 = 遅刻
      reasons.push({ type: "遅刻", label: `遅刻（シフト${shiftObj.start} → 出勤${compareInStr}）`, detail: "", subReason: "", subReasonText: "" });
    }
    if (cOut !== null && cOut >= sEnd + 30) {
      // 退勤打刻がシフト終了30分以上過ぎている = 残業
      reasons.push({ type: "残業", label: `残業（シフト${shiftObj.end} → 退勤${compareOutStr}）`, detail: "", subReason: "", subReasonText: "" });
    }
    
    // 遅刻でも残業でもなく早退などの乖離ありの場合
    const isLate = (cIn !== null && cIn >= sStart);
    const isClockOutOk = (cOut !== null && cOut >= sEnd && cOut < sEnd + 30);
    const isOnTime = !isLate && isClockOutOk;

    if (!isOnTime && reasons.length === 0) {
      if (cOut !== null && cOut < sEnd) {
        reasons.push({ type: "早退", label: `早退（シフト${shiftObj.end} → 退勤${compareOutStr}）`, detail: "", subReason: "", subReasonText: "" });
      } else {
        reasons.push({ type: "その他乖離", label: "シフトとの時間乖離あり", detail: "", subReason: "", subReasonText: "" });
      }
    }
    return reasons;
  }, []);

  // 打刻忘れトグルや時間が変更されたら乖離判定を再計算（退勤モーダル時のみ）
  useEffect(() => {
    if (discrepancyMode === "clockOut" && discrepancyInfo && discrepancyInfo.shiftObj) {
      const inTime = isForgotClockToggle ? forgotClockActualIn : discrepancyInfo.clockIn;
      const outTime = isForgotClockToggle ? forgotClockActualOut : discrepancyInfo.clockOutTime;
      // 実際の時間が未入力の場合は、シフト通りなどの判定が狂うため計算スキップするか、未入力扱いで計算する
      // ここでは入力されていると仮定して計算
      const newReasons = calculateDiscrepancies(inTime, outTime, discrepancyInfo.shiftObj);
      
      setDetectedReasons(prev => {
        // 同じ状態なら更新しない（無限ループ防止）
        if (prev.length === newReasons.length && prev.every((p, i) => p.type === newReasons[i].type)) {
          return prev;
        }
        // 入力済みの詳細理由をマージ
        return newReasons.map(nr => {
          const existing = prev.find(p => p.type === nr.type);
          if (existing) {
            return { ...nr, subReason: existing.subReason, subReasonText: existing.subReasonText, detail: existing.detail };
          }
          return nr;
        });
      });
    }
  }, [isForgotClockToggle, forgotClockActualIn, forgotClockActualOut, discrepancyMode, discrepancyInfo, calculateDiscrepancies]);

  // 直前の勤務レコードを日またぎで分割退勤する処理
  const handleOvernightClockOut = async (yesterdayItem, nowTime, todayStr) => {
    if (!window.confirm(`日またぎの退勤を検出しました。\n前日(${yesterdayItem.displayDate || yesterdayItem.workDate})分を24:00で、\n本日(${todayStr})分を${nowTime}で\nそれぞれ分割して申請します。よろしいですか？`)) {
      return;
    }

    setLoading(true);
    try {
      // 1. 昨日分の更新 (24:00退勤)
      const yesterdayDate = yesterdayItem.displayDate || yesterdayItem.workDate;
      const yShift = getShift(user.userName, yesterdayDate);
      
      const yReasons = calculateDiscrepancies(yesterdayItem.clockIn, "24:00", yShift);
      const yExistingComment = parseComment(yesterdayItem.comment);
      
      let yAppStatus = "pending";
      let yReasonStr = "-";
      let yDetailText = "";
      let autoApp = true;
      if (yReasons.length > 0) {
        yAppStatus = "pending";
        yReasonStr = yReasons.map(r => r.type).join("+");
        yDetailText = "日跨ぎ自動分割処理による申請";
        autoApp = false;
      } else {
        yReasonStr = "日跨ぎ自動分割";
      }
      
      const yCommentObj = {
        segments: yExistingComment.segments || [{ location: user.defaultLocation || "未記載", department: user.defaultDepartment || "未記載", hours: "" }],
        text: yExistingComment.text || "",
        application: {
          status: yAppStatus,
          reason: yReasonStr,
          detailText: yDetailText,
          appliedIn: roundTimeToHalfHour(yesterdayItem.clockIn, "ceil"),
          appliedOut: "24:00",
          submittedAt: new Date().toISOString(),
          autoApplied: autoApp
        },
        auditLog: [
          ...(yExistingComment.auditLog || []),
          { action: "submitted", by: user.userName || user.loginId || "スタッフ", at: new Date().toISOString(), detail: "日跨ぎ退勤（自動分割・前日分）" }
        ]
      };

      await fetch(ENDPOINTS.update, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.userId,
          workDate: yesterdayItem.workDate,
          clockIn: yesterdayItem.clockIn,
          clockOut: "24:00",
          breaks: yesterdayItem.breaks || [],
          comment: JSON.stringify(yCommentObj),
          location: yesterdayItem.location || "",
          department: yesterdayItem.department || ""
        })
      });

      // 2. 本日分の新規作成 (00:00 〜 nowTime)
      let todayRecordId = todayStr;
      const existingToday = items.filter(i => i.workDate.startsWith(todayStr));
      if (existingToday.length > 0) {
        todayRecordId = `${todayStr}_${existingToday.length + 1}`;
      }

      const tShift = getShift(user.userName, todayStr);
      const tReasons = calculateDiscrepancies("00:00", nowTime, tShift);
      
      let tAppStatus = "pending";
      let tReasonStr = "-";
      let tDetailText = "";
      let tAutoApp = true;
      if (tReasons.length > 0) {
        tReasonStr = tReasons.map(r => r.type).join("+");
        tDetailText = "日跨ぎ自動分割処理による申請";
        tAutoApp = false;
      } else {
        tReasonStr = "日跨ぎ自動分割";
      }

      const tCommentObj = {
        segments: [{ location: user.defaultLocation || "未記載", department: user.defaultDepartment || "未記載", hours: "" }],
        text: "",
        application: {
          status: tAppStatus,
          reason: tReasonStr,
          detailText: tDetailText,
          appliedIn: "00:00",
          appliedOut: roundTimeToHalfHour(nowTime, "floor"),
          submittedAt: new Date().toISOString(),
          autoApplied: tAutoApp
        },
        auditLog: [
          { action: "submitted", by: user.userName || user.loginId || "スタッフ", at: new Date().toISOString(), detail: "日跨ぎ退勤（自動分割・本日分）" }
        ]
      };

      await fetch(ENDPOINTS.update, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.userId,
          workDate: todayRecordId,
          clockIn: "00:00",
          clockOut: nowTime,
          breaks: [],
          comment: JSON.stringify(tCommentObj),
          location: user.defaultLocation || "未記載",
          department: user.defaultDepartment || "未記載"
        })
      });

      alert("日またぎの退勤処理が完了しました。管理者の承認をお待ちください。");
      fetchData(); // リロード

    } catch (e) {
      console.error(e);
      alert("エラーが発生しました: " + (e.message || ""));
    } finally {
      setLoading(false);
    }
  };

  // 退勤ボタン押下時：乖離チェック → 「問題なし」の場合のみ即退勤、それ以外は全て申請モーダル表示
  const handleClockOut = async () => {
    if (!user || !activeItem) {
      alert("出勤していません");
      return;
    }

    const nowTime = format(new Date(), "HH:mm");
    const todayStr = format(new Date(), "yyyy-MM-dd");

    // もしアクティブなレコードが「今日（todayStr）」以外のものであれば、日跨ぎ自動分割処理に移譲する
    if (activeItem.workDate !== todayStr && !activeItem.workDate.startsWith(todayStr)) {
      handleOvernightClockOut(activeItem, nowTime, todayStr);
      return;
    }

    // 休憩中の場合は自動的に休憩を終了
    if (isOnBreak) {
      try {
        await fetch(ENDPOINTS.breakEnd, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: user.userId, workDate: activeItem.workDate }),
        });
        // ローカルのbreaksも更新
        const newItems = [...items];
        const idx = newItems.findIndex(i => i.workDate === activeItem.workDate);
        if (idx >= 0 && newItems[idx].breaks?.length > 0) {
          newItems[idx].breaks[newItems[idx].breaks.length - 1].end = format(new Date(), "HH:mm");
          setItems(newItems);
        }
      } catch (e) {
        console.error("休憩終了エラー:", e);
      }
    }

    const lookupDate = activeItem.displayDate || activeItem.workDate;

    // シフトが見つからない場合、再取得を試みる（キャッシュに当日分がない場合の対策）
    let shift = getShift(user.userName, lookupDate);
    if (!shift && shiftModuleRef.current) {
      try {
        const freshData = await shiftModuleRef.current.fetchShiftData();
        setShiftMap(freshData);
        setShiftLoaded(true);
        // 新しいデータで再検索
        const uName = user.userName;
        if (uName && freshData) {
          const normalized = normalizeName(uName);
          const dateStr = lookupDate;
          shift = freshData[normalized]?.[dateStr] || null;
          if (!shift) {
            const loginId = user.loginId || localStorage.getItem("loginId");
            if (loginId) shift = freshData[loginId]?.[dateStr] || null;
          }
        }
      } catch (e) {
        console.warn("シフト再取得失敗:", e);
      }
    }

    const clockInTime = activeItem.clockIn;

    // シフトがある場合：シフト通りかチェック
    if (shift && shift.start && shift.end && clockInTime) {
      const reasons = calculateDiscrepancies(clockInTime, nowTime, shift);

      if (reasons.length === 0) {
        // 問題なし → 即退勤
        await executeClockOut(nowTime);
        return;
      }

      setDetectedReasons(reasons);

      setDiscrepancyInfo({
        shiftStart: shift.start,
        shiftEnd: shift.end,
        clockIn: clockInTime,
        clockOutTime: nowTime,
        shiftObj: shift
      });
      // 最初の理由を選択状態にする（後方互換性）
      setDiscrepancyReason(reasons.length === 1 ? reasons[0].type : reasons.map(r => r.type).join("+"));
      setDiscrepancySubReason("");
      setDiscrepancySubReasonText("");
      setDiscrepancyText("");
      // 打刻忘れの初期値として現在の打刻時間をセット
      setForgotClockActualIn(clockInTime);
      setForgotClockActualOut(nowTime);
      setIsForgotClockToggle(false);
      setDiscrepancyAppliedIn(roundTimeToHalfHour(clockInTime, "ceil"));
      setDiscrepancyAppliedOut(roundTimeToHalfHour(nowTime, "floor"));
      setDiscrepancyMode("clockOut");
      setDiscrepancyModalOpen(true);
      return;
    }

    // シフトなし → 乖離モーダルを表示（シフト未登録として理由入力を求める）
    const initialReasons = calculateDiscrepancies(clockInTime, nowTime, null);
    setDetectedReasons(initialReasons);
    setDiscrepancyInfo({
      shiftStart: null,
      shiftEnd: null,
      clockIn: clockInTime,
      clockOutTime: nowTime,
      shiftObj: null
    });
    setDiscrepancyReason("シフトなし");
    setDiscrepancySubReason("");
    setDiscrepancySubReasonText("");
    setDiscrepancyText("");
    setForgotClockActualIn(clockInTime);
    setForgotClockActualOut(nowTime);
    setIsForgotClockToggle(false);
    setDiscrepancyAppliedIn(roundTimeToHalfHour(clockInTime, "ceil"));
    setDiscrepancyAppliedOut(roundTimeToHalfHour(nowTime, "floor"));
    setDiscrepancyMode("clockOut");
    setDiscrepancyModalOpen(true);
  };

  // 実際の退勤処理（乖離なしの場合 or モーダル入力後に呼ばれる）
  const executeClockOut = async (clockOutTime, reasonStr = null, subReasonVal = null, subReasonTextVal = null, textVal = null, appliedInOverride = null, appliedOutOverride = null, reasonsDetail = null) => {
    setLoading(true);
    try {
      const payload = { userId: user.userId, workDate: activeItem.workDate };

      await fetch(ENDPOINTS.clockOut, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      alert("退勤しました！お疲れ様でした。");

      // IP取得+退勤ログをauditLogに追記
      const clientIp = await fetchClientIp();
      {
        const existingComment = parseComment(activeItem.comment);
        const clockOutLog = {
          action: "clock_out",
          by: user.userName || user.loginId || "スタッフ",
          at: new Date().toISOString(),
          detail: `退勤（${getLocationByIp(clientIp)}）`,
          ip: clientIp,
          location: getLocationByIp(clientIp)
        };
        const commentWithClockOut = {
          ...existingComment,
          auditLog: [...(existingComment.auditLog || []), clockOutLog]
        };
        // 退勤ログをまず保存（後続の処理で上書きされる場合もauditLogは引き継がれる）
        await fetch(ENDPOINTS.update, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: user.userId,
            workDate: activeItem.workDate,
            clockIn: activeItem.clockIn,
            clockOut: clockOutTime,
            breaks: activeItem.breaks || [],
            comment: JSON.stringify(commentWithClockOut)
          }),
        });
        // activeItemのcommentを更新して後続処理で引き継ぐ
        activeItem.comment = JSON.stringify(commentWithClockOut);
      }

      // Optimistic Update
      const newItems = [...items];
      const idx = newItems.findIndex(i => i.workDate === activeItem.workDate);
      if (idx >= 0) {
        newItems[idx].clockOut = clockOutTime;

        const lookupDate = newItems[idx].displayDate || newItems[idx].workDate;
        const shift = getShift(user.userName, lookupDate);
        const clockInTime = newItems[idx].clockIn;

        let appliedIn, appliedOut;
        let shouldAutoApply = false;

        if (shift && clockInTime && clockOutTime) {
          const shiftStartMin = toMin(shift.start);
          const shiftEndMin = toMin(shift.end);
          const clockInMin = toMin(clockInTime);
          const clockOutMin = toMin(clockOutTime);

          if (clockInMin < shiftStartMin && clockOutMin >= shiftEndMin && clockOutMin < shiftEndMin + 30) {
            appliedIn = shift.start;
            appliedOut = shift.end;
            shouldAutoApply = true;
          }
        }

        if (shouldAutoApply) {
          // シフト通り → 自動で承認待ちにする
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
              autoApplied: true
            },
            auditLog: [...(existingComment.auditLog || []), { action: "submitted", by: user.userName || user.loginId || "スタッフ", at: new Date().toISOString(), detail: "承認待ちになりました（自動申請）" }]
          };

          await fetch(ENDPOINTS.update, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              userId: user.userId,
              workDate: activeItem.workDate,
              clockIn: newItems[idx].clockIn,
              clockOut: clockOutTime,
              breaks: newItems[idx].breaks || [],
              comment: JSON.stringify(updatedComment),
              location: newItems[idx].location || "",
              department: newItems[idx].department || ""
            }),
          });
          newItems[idx].comment = JSON.stringify(updatedComment);
        } else if (reasonStr) {
          // 乖離あり＋理由入力済み → 理由付き申請として承認待ちにする
          // モーダルで入力された申請時間を使用（未入力の場合は自動30分丸め）
          const appliedInVal = appliedInOverride || roundTimeToHalfHour(clockInTime, "ceil");
          const appliedOutVal = appliedOutOverride || roundTimeToHalfHour(clockOutTime, "floor");
          const existingComment = parseComment(newItems[idx].comment);
          const updatedComment = {
            segments: existingComment.segments || [],
            text: existingComment.text || "",
            application: {
              status: "pending",
              reason: reasonStr,
              subReason: subReasonVal || null,
              subReasonText: subReasonTextVal || null,
              ...(reasonsDetail ? { reasonsDetail } : {}),
              ...(textVal ? { detailText: textVal } : {}),
              appliedIn: appliedInVal,
              appliedOut: appliedOutVal,
              submittedAt: new Date().toISOString(),
              autoApplied: false
            },
            auditLog: [...(existingComment.auditLog || []), { action: "submitted", by: user.userName || user.loginId || "スタッフ", at: new Date().toISOString(), detail: `承認待ちになりました（理由: ${reasonStr}）` }]
          };

          await fetch(ENDPOINTS.update, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              userId: user.userId,
              workDate: activeItem.workDate,
              clockIn: newItems[idx].clockIn,
              clockOut: clockOutTime,
              breaks: newItems[idx].breaks || [],
              comment: JSON.stringify(updatedComment),
              location: newItems[idx].location || "",
              department: newItems[idx].department || ""
            }),
          });
          newItems[idx].comment = JSON.stringify(updatedComment);
        } else {
          // シフトなし or その他 → 打刻時間を30分丸めで自動承認待ちにする（未申請を残さない）
          const existingComment = parseComment(newItems[idx].comment);
          if (existingComment.application && existingComment.application.status && !existingComment.application.appliedOut) {
            // 出勤時に打刻忘れ等で申請があるがappliedOutが未設定 → 退勤時間で補完
            const clockOutRounded = roundTimeToHalfHour(clockOutTime, "floor");
            const updatedApp = { ...existingComment.application, appliedOut: clockOutRounded };
            const updatedComment = {
              segments: existingComment.segments || [],
              text: existingComment.text || "",
              application: updatedApp,
              auditLog: [...(existingComment.auditLog || []), { action: "clock_out_updated", by: user.userName || user.loginId || "スタッフ", at: new Date().toISOString(), detail: `退勤時に申請退勤時間を補完（${clockOutRounded}）` }]
            };

            await fetch(ENDPOINTS.update, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                userId: user.userId,
                workDate: activeItem.workDate,
                clockIn: newItems[idx].clockIn,
                clockOut: clockOutTime,
                breaks: newItems[idx].breaks || [],
                comment: JSON.stringify(updatedComment),
                location: newItems[idx].location || "",
                department: newItems[idx].department || ""
              }),
            });
            newItems[idx].comment = JSON.stringify(updatedComment);
          } else if (!existingComment.application || !existingComment.application.status) {
            const clockInRounded = roundTimeToHalfHour(clockInTime, "ceil");
            const clockOutRounded = roundTimeToHalfHour(clockOutTime, "floor");
            const updatedComment = {
              segments: existingComment.segments || [],
              text: existingComment.text || "",
              application: {
                status: "pending",
                reason: "シフトなし",
                appliedIn: clockInRounded,
                appliedOut: clockOutRounded,
                submittedAt: new Date().toISOString(),
                autoApplied: true
              },
              auditLog: [...(existingComment.auditLog || []), { action: "submitted", by: user.userName || user.loginId || "スタッフ", at: new Date().toISOString(), detail: "承認待ちになりました（自動申請）" }]
            };

            await fetch(ENDPOINTS.update, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                userId: user.userId,
                workDate: activeItem.workDate,
                clockIn: newItems[idx].clockIn,
                clockOut: clockOutTime,
                breaks: newItems[idx].breaks || [],
                comment: JSON.stringify(updatedComment),
                location: newItems[idx].location || "",
                department: newItems[idx].department || ""
              }),
            });
            newItems[idx].comment = JSON.stringify(updatedComment);
          }
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

  // 乖離モーダルから送信
  const handleDiscrepancySubmit = async () => {
    // 退勤モード＋複数理由検出の場合
    if (discrepancyMode === "clockOut" && (detectedReasons.length > 0 || isForgotClockToggle) && detectedReasons[0]?.type !== "シフトなし") {
      // 打刻忘れのバリデーション
      if (isForgotClockToggle) {
        if (!forgotClockActualOut) {
          alert("実際の退勤時間を入力してください");
          return;
        }
      }

      // 各理由の詳細入力をバリデーション
      for (const r of detectedReasons) {
        if (r.type === "遅刻" || r.type === "早退") {
          if (!r.subReason) {
            alert(`${r.type}の詳細理由を選択してください`);
            return;
          }
          if (r.subReason === "その他" && !r.subReasonText.trim()) {
            alert(`${r.type}のその他理由を入力してください`);
            return;
          }
        }
        if (r.type === "残業" || r.type === "その他乖離") {
          if (!r.detail.trim()) {
            alert(r.type === "残業" ? "残業理由を入力してください" : "理由を入力してください");
            return;
          }
        }
      }

      // 理由文字列を構築
      const reasonArray = detectedReasons.map(r => r.type);
      if (isForgotClockToggle) {
        reasonArray.unshift("打刻忘れ");
      }
      const reasonStr = reasonArray.join("+");

      const reasonsDetail = detectedReasons.map(r => ({
        type: r.type,
        subReason: r.subReason || null,
        subReasonText: r.subReasonText || null,
        detail: r.detail || null
      }));

      // テキストまとめ
      const textParts = [];
      if (isForgotClockToggle) {
        textParts.push(`実際の出社: ${forgotClockActualIn || "-"} / 実際の退勤: ${forgotClockActualOut}`);
      }
      detectedReasons.forEach(r => {
        if (r.type === "遅刻" || r.type === "早退") {
          textParts.push(`${r.type}: ${r.subReason}${r.subReasonText ? `(${r.subReasonText})` : ""}`);
        } else if (r.type === "残業" || r.type === "その他乖離") {
          textParts.push(`${r.type}: ${r.detail}`);
        } else {
          textParts.push(r.type);
        }
      });
      const textVal = textParts.join(" / ");

      // 申請する打刻時間（打刻忘れなら入力値を丸めて適用）
      const finalAppliedIn = isForgotClockToggle && forgotClockActualIn ? roundTimeToHalfHour(forgotClockActualIn, "ceil") : (discrepancyAppliedIn || null);
      const finalAppliedOut = isForgotClockToggle && forgotClockActualOut ? roundTimeToHalfHour(forgotClockActualOut, "floor") : (discrepancyAppliedOut || null);

      setDiscrepancyModalOpen(false);
      // executeClockOutに渡す（後方互換: reasonStr=結合文字列, textVal=詳細テキスト）
      // reasonsDetailは追加引数として渡す
      await executeClockOut(discrepancyInfo.clockOutTime, reasonStr, null, null, textVal, finalAppliedIn, finalAppliedOut, reasonsDetail);
      return;
    }

    // 出勤モード or シフトなし or 従来の単一理由フロー
    if (!discrepancyReason) {
      alert("乖離理由を選択してください");
      return;
    }
    // サブ理由が必要なカテゴリで未入力チェック
    const subOptions = REASON_SUB_OPTIONS[discrepancyReason];
    if (subOptions && subOptions.length > 0 && !discrepancySubReason) {
      alert("詳細理由を選択してください");
      return;
    }
    if (discrepancySubReason === "その他" && !discrepancySubReasonText.trim()) {
      alert("その他の理由を入力してください");
      return;
    }
    if (discrepancyReason === "出張" && !discrepancyText.trim()) {
      alert("出張場所を入力してください");
      return;
    }
    if (discrepancyReason === "打刻間違い" && !discrepancyText.trim()) {
      alert("打刻間違いの詳細を入力してください");
      return;
    }
    if (discrepancyReason === "残業" && !discrepancyText.trim()) {
      alert("残業理由を入力してください");
      return;
    }
    if (discrepancyReason === "その他" && !discrepancyText.trim()) {
      alert("理由を入力してください");
      return;
    }
    if (discrepancyReason === "打刻忘れ") {
      if (!forgotClockActualOut) {
        alert("おおよその退勤時間を入力してください");
        return;
      }
    }

    // 理由文字列を構成（大枠のみ）
    let reasonStr = discrepancyReason;
    let subReasonVal = discrepancySubReason || null;
    let subReasonTextVal = discrepancySubReasonText || null;
    let textVal = discrepancyText || null;
    if (discrepancyReason === "打刻忘れ") {
      const parts = [];
      if (forgotClockActualIn) parts.push(`実際の出社: ${forgotClockActualIn}`);
      if (forgotClockActualOut) parts.push(`実際の退勤: ${forgotClockActualOut}`);
      textVal = parts.join(" / ");
    }

    setDiscrepancyModalOpen(false);
    await executeClockOut(discrepancyInfo.clockOutTime, reasonStr, subReasonVal, subReasonTextVal, textVal, discrepancyAppliedIn || null, discrepancyAppliedOut || null);
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

      // IP取得と休憩開始ログ記録
      const clientIp = await fetchClientIp();
      const nowTime = format(new Date(), "HH:mm");
      const updatedComment = addPunchLog(activeItem.comment, "break_start", user.userName || user.loginId, clientIp);
      const commentStr = JSON.stringify(updatedComment);

      // comment更新
      const newBreaks = [...(activeItem.breaks || []), { start: nowTime, end: "" }];
      await fetch(ENDPOINTS.update, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.userId,
          workDate: activeItem.workDate,
          clockIn: activeItem.clockIn,
          clockOut: activeItem.clockOut || "",
          breaks: newBreaks,
          comment: commentStr
        }),
      });

      // Optimistic
      const newItems = [...items];
      const idx = newItems.findIndex(i => i.workDate === activeItem.workDate);
      if (idx >= 0) {
        newItems[idx].breaks = newBreaks;
        newItems[idx].comment = commentStr;
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

      // IP取得と休憩終了ログ記録
      const clientIp = await fetchClientIp();
      const nowTime = format(new Date(), "HH:mm");
      const updatedComment = addPunchLog(activeItem.comment, "break_end", user.userName || user.loginId, clientIp);
      const commentStr = JSON.stringify(updatedComment);

      const newBreaks = [...(activeItem.breaks || [])];
      if (newBreaks.length > 0) {
        newBreaks[newBreaks.length - 1].end = nowTime;
      }

      // comment更新
      await fetch(ENDPOINTS.update, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.userId,
          workDate: activeItem.workDate,
          clockIn: activeItem.clockIn,
          clockOut: activeItem.clockOut || "",
          breaks: newBreaks,
          comment: commentStr
        }),
      });

      const newItems = [...items];
      const idx = newItems.findIndex(i => i.workDate === activeItem.workDate);
      if (idx >= 0) {
        newItems[idx].breaks = newBreaks;
        newItems[idx].comment = commentStr;
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
      // 同一loginIdの全userIdからデータ取得（重複userId対応）
      const loginId = localStorage.getItem("loginId") || "";
      let allUserIds = [user.userId];
      if (loginId) {
        try {
          const usersRes = await fetch(`${API_BASE}/users`);
          const usersData = await usersRes.json();
          const userList = usersData.items || usersData.Items || (Array.isArray(usersData) ? usersData : []);
          userList.forEach(u => {
            if ((u.loginId || "").toLowerCase() === loginId.toLowerCase() && u.userId !== user.userId) {
              allUserIds.push(u.userId);
            }
          });
        } catch (e) { /* フォールバック: 現在のIDのみ */ }
      }

      let allItems = [];
      for (const uid of [...new Set(allUserIds)]) {
        try {
          const res = await fetch(`${API_BASE}/attendance?userId=${uid}`);
          const data = await res.json();
          if (data.success && Array.isArray(data.items)) {
            allItems.push(...data.items);
          }
        } catch (e) { /* skip */ }
      }

      if (allItems.length > 0) {
        // workDateで重複排除（updatedAt優先）
        const dateMap = new Map();
        allItems.forEach(item => {
          const existing = dateMap.get(item.workDate);
          if (!existing) {
            dateMap.set(item.workDate, item);
          } else if ((item.updatedAt || "") > (existing.updatedAt || "")) {
            dateMap.set(item.workDate, item);
          }
        });

        // Normalize Items (Fix for mangled IDs: 202602-02-02 -> 2026-02-02)
        const normalized = Array.from(dateMap.values()).map(item => {
          let displayDate = item.workDate;
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

            if (clockInMin < shiftStartMin && clockOutMin >= shiftEndMin && clockOutMin < shiftEndMin + 30) {
              // シフト通り（退勤がシフト終了後30分未満）なのでシフト時間を申請時間とする
              appliedIn = shift.start;
              appliedOut = shift.end;
            } else {
              // シフトはあるが時間が合わない → 既存の未申請データを救済（30分丸めで承認待ちに変換）
              appliedIn = roundTimeToHalfHour(item.clockIn, "ceil");
              appliedOut = roundTimeToHalfHour(item.clockOut, "floor");
            }
          } else {
            // シフトがない場合 → 既存の未申請データを救済（30分丸めで承認待ちに変換）
            appliedIn = roundTimeToHalfHour(item.clockIn, "ceil");
            appliedOut = roundTimeToHalfHour(item.clockOut, "floor");
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
            },
            auditLog: [...(p.auditLog || []), { action: "submitted", by: user.userName || user.loginId || "スタッフ", at: new Date().toISOString(), detail: "承認待ちになりました（自動救済）" }]
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

  // レポートからの遷移: editDateパラメータで自動的に編集フォームを開く
  useEffect(() => {
    const editDate = searchParams.get("editDate");
    if (editDate && items.length > 0) {
      const item = items.find(i => (i.displayDate || i.workDate) === editDate);
      handleEdit(editDate, item || null);
      // パラメータをクリア（再表示防止）
      setSearchParams({}, { replace: true });
    }
  }, [items, searchParams]);
  const alerts = items.filter(item => {
    const p = parseComment(item.comment);
    const app = p.application || {};
    const isResubmit = app.status === "resubmission_requested";
    const isSaReturnStaff = app.status === "sa_return_staff";

    const workMin = calcWorkMin(item);
    const isError = (item.clockIn && item.clockOut && workMin <= 0);

    const today = format(new Date(), "yyyy-MM-dd");
    const isPast = item.workDate < today;
    const isIncomplete = (item.clockIn && !item.clockOut && isPast);

    return isResubmit || isSaReturnStaff || isError || isIncomplete;
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
      setFormBreakDuration(app.breakDuration || 0);

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
      if (app.reason && REASON_OPTIONS.includes(app.reason)) {
        setReason(app.reason);
        // サブ理由復元
        if (app.subReason) setSubReason(app.subReason);
        else setSubReason("");
        if (app.subReasonText) setSubReasonText(app.subReasonText);
        else setSubReasonText("");
      } else {
        setReason(REASON_OPTIONS[0]);
        setSubReason("");
        setSubReasonText("");
      }
      // 打刻忘れの実際の時間復元
      if (app.actualClockIn) setFormForgotActualIn(app.actualClockIn);
      else setFormForgotActualIn("");
      if (app.actualClockOut) setFormForgotActualOut(app.actualClockOut);
      else setFormForgotActualOut("");

    } else {
      setFormIn(shift?.start || "");
      setFormOut(shift?.end || "");
      setFormBreaks([]);
      setAdminFeedback("");
      setFormSegments([{ location: user.defaultLocation || LOCATIONS[0], department: user.defaultDepartment || DEPARTMENTS[0], hours: "" }]);
      setFormText("");
      setFormBreakDuration(0);
      setReason(REASON_OPTIONS[0]); // Default to "-"
      setSubReason("");
      setSubReasonText("");
      setFormForgotActualIn("");
      setFormForgotActualOut("");
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
      // 0. 未退勤チェック（欠勤・打刻忘れ・出張以外は退勤してから申請）
      if (reason !== "欠勤" && reason !== "打刻忘れ" && reason !== "出張" && originalItem && originalItem.clockIn && !originalItem.clockOut) {
        alert("退勤してから申請してください。\n未退勤の状態では申請できません。\n\n※ 打刻忘れの場合は理由を「打刻忘れ」に変更してください。");
        setLoading(false);
        return;
      }

      // 0b. Reason Required Check
      if (!reason || reason === "-") {
        alert("修正・申請理由を選択してください");
        setLoading(false);
        return;
      }

      // 1. サブ理由が必要なカテゴリのバリデーション
      const subOptions = REASON_SUB_OPTIONS[reason] || [];
      if (subOptions.length > 0 && !subReason) {
        alert(`${reason}の詳細理由を選択してください`);
        setLoading(false);
        return;
      }
      if (subReason === "その他" && (!subReasonText || !subReasonText.trim())) {
        alert("「その他」の場合は具体的な理由を入力してください");
        setLoading(false);
        return;
      }

      // 2. 出張・残業のテキスト入力バリデーション
      if (reason === "出張" && (!formText || !formText.trim())) {
        alert("出張場所を入力してください");
        setLoading(false);
        return;
      }
      if (reason === "残業" && !subReason && (!formText || !formText.trim())) {
        alert("残業理由を入力してください");
        setLoading(false);
        return;
      }
      if (reason === "打刻間違い" && (!formText || !formText.trim())) {
        alert("どのように間違えたか入力してください");
        setLoading(false);
        return;
      }
      if (reason === "その他" && (!formText || !formText.trim())) {
        alert("理由を入力してください");
        setLoading(false);
        return;
      }
      if (reason === "打刻忘れ" && !formForgotActualIn) {
        alert("おおよその出社時間を入力してください");
        setLoading(false);
        return;
      }

      // --- VALIDATION END ---

      // 最終的な理由文字列を組み立て（大枠のみ、詳細は付け足さない）
      let finalReason = reason;
      // subReason/subReasonTextは別フィールドで保存するので、finalReasonには含めない
      // 出張・残業・打刻間違いのテキストもtextフィールドに保存済みなのでreasonには含めない

      const p = parseComment(originalItem?.comment);

      const application = {
        status: reason === "欠勤" ? "absent" : "pending",
        appliedAt: new Date().toISOString(),
        appliedIn: reason === "欠勤" ? "" : formIn,
        appliedOut: reason === "欠勤" ? "" : formOut,
        reason: finalReason,
        subReason: subReason || null,
        subReasonText: subReasonText || null,
        detailText: formText || null,
        breakDuration: formBreakDuration || 0,
        adminComment: null,
        actualClockIn: reason === "打刻忘れ" ? formForgotActualIn : null,
        actualClockOut: reason === "打刻忘れ" ? formForgotActualOut : null
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

    // 理由バリデーション
    const finalAbsentReason = absentReason === "その他" ? absentReasonText.trim() : absentReason;
    if (!finalAbsentReason) {
      alert("欠勤理由を入力してください");
      return;
    }

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
          text: `スタッフによる欠勤申請（理由: ${finalAbsentReason}）`,
          application: { status: "absent", reason: "欠勤", absentReason: finalAbsentReason }
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
      setAbsentReason(ABSENT_REASONS[0]);
      setAbsentReasonText("");
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
            const breakDur = p.application?.breakDuration || 0;
            wm = Math.max(0, outMin - inMin - breakDur);
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

            // 派遣区間の計算（派遣は固定契約のためフルレンジで計算）
            if (s.dispatchRange) {
              const dispStart = toMin(s.dispatchRange.start);
              const dispEnd = toMin(s.dispatchRange.end);
              dispatchMin += (dispEnd - dispStart);
            }

            // バイト区間の計算
            if (s.partTimeRange) {
              const partStart = toMin(s.partTimeRange.start);
              const partEnd = toMin(s.partTimeRange.end);
              // 実際の出勤時刻とバイト区間の重なりを計算
              const overlapStart = Math.max(actualIn, partStart);
              const overlapEnd = Math.min(actualOut, partEnd);
              if (overlapStart < overlapEnd) {
                let partOverlap = overlapEnd - overlapStart;
                // ※遅刻ペナルティは30分丸め(ceil)で既に反映済みのため、追加削減は行わない
                partTimeMin += partOverlap;
              }
            }

            // partTimeRangeがない場合（派遣のみの日）で、派遣終了後も働いている場合
            if (!s.partTimeRange && s.dispatchRange) {
              const dispEnd = toMin(s.dispatchRange.end);
              if (actualOut > dispEnd) {
                // 派遣終了後はバイト時間として計算
                let extraPart = actualOut - dispEnd;
                partTimeMin += extraPart;
              }
            }
          } else if (s && s.isDispatch) {
            // dispatchRange/partTimeRangeがない旧データの場合のフォールバック
            // Dispatch Logic: First 8h is Dispatch, Rest is PartTime
            const disp = Math.min(wm, 8 * 60);
            let part = Math.max(0, wm - 8 * 60);
            dispatchMin += disp;
            partTimeMin += part;
          } else {
            // All PartTime
            let adjustedWm = wm;
            partTimeMin += adjustedWm;
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
    const totalH = Math.floor(totalMin / 60);
    const totalM = totalMin % 60;

    return { days, dispH, dispM, partH, partM, totalH, totalM, avgHours };
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

  // 再提出依頼のカウントと日付リスト
  const resubmissionItems = items.filter(i => {
    const p = parseComment(i.comment);
    return p.application?.status === "resubmission_requested" || p.application?.status === "sa_return_staff";
  });
  const resubmissionCount = resubmissionItems.length;
  const resubmissionDates = resubmissionItems.map(i => {
    const workDate = i.displayDate || i.workDate;
    const baseDate = workDate.split("_")[0];
    const d = new Date(baseDate);
    const dayNames = ["日", "月", "火", "水", "木", "金", "土"];
    const p = parseComment(i.comment);
    const adminComment = p.application?.adminComment || "";
    const superAdminComment = p.application?.superAdminComment || "";
    const isSaReturn = p.application?.status === "sa_return_staff";
    return {
      label: `${d.getMonth() + 1}/${d.getDate()}(${dayNames[d.getDay()]})`,
      adminComment,
      superAdminComment,
      isSaReturn
    };
  });

  // 未退勤の日付リスト（今月・出勤しているが退勤していない、本日を除く）
  const currentMonth = format(currentDate, "yyyy-MM");
  const notClockedOutDates = items.filter(i => {
    const workDate = i.displayDate || i.workDate;
    // 本日は除外（出勤中のため）
    if (workDate === todayStr) return false;
    return workDate.startsWith(currentMonth) && i.clockIn && !i.clockOut;
  }).map(i => {
    const workDate = i.displayDate || i.workDate;
    const baseDate = workDate.split("_")[0];
    const d = new Date(baseDate);
    const dayNames = ["日", "月", "火", "水", "木", "金", "土"];
    return `${d.getMonth() + 1}/${d.getDate()}(${dayNames[d.getDay()]})`;
  });
  const notClockedOutCount = notClockedOutDates.length;

  // 日付フォーマットヘルパー
  const formatDateShort = (dateStr) => {
    const d = new Date(dateStr);
    const dayNames = ["日", "月", "火", "水", "木", "金", "土"];
    return `${d.getMonth() + 1}/${d.getDate()}(${dayNames[d.getDay()]})`;
  };

  // 遅刻のカウント＋日付リスト（今月・シフト開始より遅く出勤した場合）
  const lateData = useMemo(() => {
    if (!user || !shiftMap) return { count: 0, dates: [] };
    const dates = [];
    items.forEach(item => {
      const dDate = item.displayDate || item.workDate;
      if (!dDate.startsWith(currentMonth)) return;
      if (!item.clockIn) return;

      const shift = getShift(user.userName, dDate);

      if (shift && shift.start && toMin(item.clockIn) >= toMin(shift.start)) {
        const p = parseComment(item.comment);
        if (p.application?.lateCancelled) return;
        dates.push(formatDateShort(dDate));
      }
    });
    return { count: dates.length, dates };
  }, [items, user, shiftMap, currentMonth]);
  const lateCount = lateData.count;

  // 欠勤のカウント＋日付リスト（今月）
  const absentData = useMemo(() => {
    const dates = [];
    const reasons = {};
    items.forEach(item => {
      const dDate = item.displayDate || item.workDate;
      if (!dDate.startsWith(currentMonth)) return;
      const p = parseComment(item.comment);
      if (p.application?.status === "absent") {
        dates.push(formatDateShort(dDate));
        const r = p.application?.absentReason || "欠勤";
        reasons[r] = (reasons[r] || 0) + 1;
      }
    });
    return { count: dates.length, dates, reasons };
  }, [items, currentMonth]);

  // 早退のカウント＋日付リスト（今月）
  const earlyData = useMemo(() => {
    const dates = [];
    const reasons = {};
    items.forEach(item => {
      const dDate = item.displayDate || item.workDate;
      if (!dDate.startsWith(currentMonth)) return;
      const p = parseComment(item.comment);
      const app = p.application || {};
      if (app.earlyCancelled) return;
      if (app.reason && app.reason.includes("早退")) {
        dates.push(formatDateShort(dDate));
        const r = app.reason || "早退";
        reasons[r] = (reasons[r] || 0) + 1;
      }
    });
    return { count: dates.length, dates, reasons };
  }, [items, currentMonth]);

  // 申請漏れ・再提出のカウント（今月）
  const missingAppData = useMemo(() => {
    if (!user || !shiftMap) return { count: 0 };
    const todayStr2 = format(new Date(), "yyyy-MM-dd");
    const s = startOfMonth(currentDate);
    const e = endOfMonth(currentDate);
    const allDays2 = eachDayOfInterval({ start: s, end: e });
    const itemDateSet = new Set(items.map(i => i.displayDate || i.workDate));
    let count = 0;
    // 1. シフトがあるのに申請がない過去日
    allDays2.forEach(day => {
      const ds = format(day, "yyyy-MM-dd");
      if (ds >= todayStr2) return;
      const shift = getShift(user.userName, ds);
      if (!shift || shift.isOff) return;
      if (!itemDateSet.has(ds)) {
        count++;
        return;
      }
      const dayItem = items.find(i => (i.displayDate || i.workDate) === ds);
      if (dayItem) {
        const p = parseComment(dayItem.comment);
        const app = p?.application;
        if (!app || (!app.status && !app.appliedIn)) count++;
      }
    });
    // 2. 再提出ステータス
    items.forEach(i => {
      const dDate = i.displayDate || i.workDate;
      if (!dDate.startsWith(currentMonth)) return;
      const p = parseComment(i.comment);
      if (p?.application?.status === "resubmission_requested") count++;
    });
    return { count };
  }, [items, user, shiftMap, currentMonth, currentDate]);

  // 締日と最終出勤日の計算
  const closingInfo = useMemo(() => {
    if (!currentDate || !user) return { closingDate: null, lastShiftDate: null };
    const eom = endOfMonth(currentDate);
    const closingDate = addDays(eom, -1);
    
    let lastShiftDate = null;
    if (shiftLoaded) {
      const startOfM = startOfMonth(currentDate);
      let curr = closingDate;
      while (curr >= startOfM) {
        const dStr = format(curr, "yyyy-MM-dd");
        const shift = getShift(user.userName, dStr);
        if (shift && !shift.isOff) {
          lastShiftDate = dStr;
          break;
        }
        curr = addDays(curr, -1);
      }
    }
    return { closingDate, lastShiftDate };
  }, [currentDate, user, shiftMap, shiftLoaded]);

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
              ({format(currentDate, "M")}月の規定日数: {user?.employmentType === "学生バイト" ? 16 : (() => { const s = startOfMonth(currentDate); const e = endOfMonth(currentDate); return eachDayOfInterval({ start: s, end: e }).filter(d => !isSaturday(d) && !isSunday(d) && !HOLIDAYS.includes(format(d, "yyyy-MM-dd"))).length; })()}日)
              <span style={{ marginLeft: "12px", borderLeft: "1px solid #d1d5db", paddingLeft: "12px" }}>
                締日: <strong style={{ color: "#374151" }}>{closingInfo.closingDate ? format(closingInfo.closingDate, "M/d") : "-"}</strong>
                <span style={{ marginLeft: "8px", fontSize: "0.85rem" }}>
                  (締日前最終出勤: <strong style={{ color: "#374151" }}>{closingInfo.lastShiftDate ? format(new Date(closingInfo.lastShiftDate), "M/d") : "-"}</strong>)
                </span>
              </span>
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

        {/* 申請漏れ・再提出アラート */}
        {missingAppData.count > 0 && (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
            background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "8px",
            padding: "10px 16px", marginBottom: "16px", color: "#dc2626", fontSize: "0.9rem", fontWeight: "bold"
          }}>
            ⚠️ 申請漏れ・再提出が {missingAppData.count}件 あります。下の勤怠一覧から申請してください。
          </div>
        )}

        {/* 本日すでに履歴がある場合の注意喚起（誤打刻防止） */}
        {(!activeItem && todayItems.some(i => i.clockIn && i.clockOut)) && (
          <div style={{ textAlign: "center", marginBottom: "12px", color: "#d97706", fontSize: "0.9rem", fontWeight: "bold" }}>
            ⚠️ 本日すでに勤怠履歴があります（2回目の出勤を開始する場合は「出勤」を押してください）
          </div>
        )}

        {/* Buttons Center */}
        <div style={{ display: "flex", justifyContent: "center", gap: "24px", marginBottom: "16px", flexWrap: "wrap" }}>
          {/* Clock In */}
          <button
            onClick={handleClockIn}
            disabled={loading || !!activeItem || hasClockedOut}
            style={{
              width: "160px", height: "64px",
              borderRadius: "8px", border: "none",
              background: (activeItem || hasClockedOut) ? "#d1d5db" : "#22c55e",
              color: "#fff",
              fontSize: "1.1rem", fontWeight: "bold",
              cursor: (activeItem || hasClockedOut) ? "default" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
              boxShadow: (activeItem || hasClockedOut) ? "none" : "0 4px 6px rgba(34,197,94,0.3)"
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

        {/* 乖離理由入力モーダル */}
        {discrepancyModalOpen && discrepancyInfo && (
          <div style={{
            position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
            background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 9999
          }}>
            <div style={{
              background: "#fff", borderRadius: "16px", padding: "28px", width: "90%", maxWidth: "440px",
              maxHeight: "90vh", overflowY: "auto",
              boxShadow: "0 20px 60px rgba(0,0,0,0.3)"
            }}>
              <h3 style={{ margin: "0 0 8px", fontSize: "1.1rem", color: "#1f2937" }}>
                {discrepancyInfo.shiftStart ? "⚠️ シフトとの乖離が検出されました" : "📋 退勤申請"}
              </h3>
              <p style={{ margin: "0 0 16px", fontSize: "0.85rem", color: "#6b7280" }}>
                {discrepancyInfo.shiftStart
                  ? "退勤前に乖離理由を入力してください。"
                  : "シフトが未登録のため、退勤時に理由を入力してください。"}
              </p>
              <div style={{ background: discrepancyInfo.shiftStart ? "#fef3c7" : "#e0e7ff", borderRadius: "8px", padding: "12px", marginBottom: "16px", fontSize: "0.85rem" }}>
                {discrepancyInfo.shiftStart ? (
                  <>
                    <div><strong>シフト:</strong> {discrepancyInfo.shiftStart} 〜 {discrepancyInfo.shiftEnd}</div>
                    <div><strong>実打刻:</strong> {discrepancyInfo.clockIn} 〜 {discrepancyInfo.clockOutTime}</div>
                  </>
                ) : (
                  <>
                    <div><strong>シフト:</strong> <span style={{ color: "#6366f1" }}>未登録</span></div>
                    <div><strong>実打刻:</strong> {discrepancyInfo.clockIn} 〜 {discrepancyInfo.clockOutTime}</div>
                  </>
                )}
              </div>

              {/* 申請する勤務時間入力（30分単位） */}
              <div style={{ background: "#ecfdf5", borderRadius: "8px", padding: "16px", marginBottom: "16px" }}>
                <div style={{ fontSize: "0.85rem", fontWeight: "bold", color: "#065f46", marginBottom: "12px" }}>
                  ⏰ 申請する勤務時間（30分単位）
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "0.8rem", color: "#6b7280", marginBottom: "4px" }}>出勤時間</label>
                    <select
                      value={discrepancyAppliedIn}
                      onChange={e => setDiscrepancyAppliedIn(e.target.value)}
                      style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid #d1d5db", fontSize: "0.95rem", background: "#fff" }}
                    >
                      <option value="">--:--</option>
                      {Array.from({ length: 48 }, (_, i) => {
                        const h = String(Math.floor(i / 2)).padStart(2, "0");
                        const m = (i % 2 === 0) ? "00" : "30";
                        return <option key={i} value={`${h}:${m}`}>{`${h}:${m}`}</option>;
                      })}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "0.8rem", color: "#6b7280", marginBottom: "4px" }}>退勤時間</label>
                    <select
                      value={discrepancyAppliedOut}
                      onChange={e => setDiscrepancyAppliedOut(e.target.value)}
                      style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid #d1d5db", fontSize: "0.95rem", background: "#fff" }}
                    >
                      <option value="">--:--</option>
                      {Array.from({ length: 48 }, (_, i) => {
                        const h = String(Math.floor(i / 2)).padStart(2, "0");
                        const m = (i % 2 === 0) ? "00" : "30";
                        return <option key={i} value={`${h}:${m}`}>{`${h}:${m}`}</option>;
                      })}
                    </select>
                  </div>
                </div>
              </div>

              {/* 理由選択 */}
              {discrepancyMode === "clockOut" && (detectedReasons.length > 0 || isForgotClockToggle) && detectedReasons[0]?.type !== "シフトなし" ? (
                /* 退勤時の新UI（複数理由＋打刻忘れ） */
                <div style={{ marginBottom: "12px" }}>
                  {detectedReasons.length > 0 ? (
                    <>
                      <label style={{ display: "block", fontSize: "0.85rem", fontWeight: "bold", color: "#374151", marginBottom: "8px" }}>⚠ 検出された乖離 *</label>
                      {detectedReasons.map((r, idx) => (
                        <div key={idx} style={{ background: r.type === "遅刻" ? "#fef2f2" : "#fffbeb", border: r.type === "遅刻" ? "1px solid #fca5a5" : "1px solid #fcd34d", borderRadius: "8px", padding: "14px", marginBottom: "10px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                            <input type="checkbox" checked disabled style={{ width: "18px", height: "18px", accentColor: r.type === "遅刻" ? "#ef4444" : "#f59e0b" }} />
                            <span style={{ fontWeight: "bold", fontSize: "0.9rem", color: r.type === "遅刻" ? "#dc2626" : "#d97706" }}>
                              {r.label}
                            </span>
                          </div>
                          
                          {/* 遅刻 または 早退 */}
                          {(r.type === "遅刻" || r.type === "早退") && (
                            <div style={{ marginLeft: "26px" }}>
                              <label style={{ display: "block", fontSize: "0.8rem", color: "#6b7280", marginBottom: "4px" }}>{r.type}理由 *</label>
                              <select
                                value={r.subReason}
                                onChange={e => {
                                  const newReasons = [...detectedReasons];
                                  newReasons[idx] = { ...newReasons[idx], subReason: e.target.value, subReasonText: "" };
                                  setDetectedReasons(newReasons);
                                }}
                                style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "0.9rem", marginBottom: "6px" }}
                              >
                                <option value="">-- 選択してください --</option>
                                {(REASON_SUB_OPTIONS[r.type] || []).map(s => <option key={s} value={s}>{s}</option>)}
                              </select>
                              {r.subReason === "その他" && (
                                <textarea
                                  placeholder="理由を入力してください"
                                  value={r.subReasonText}
                                  onChange={e => {
                                    const newReasons = [...detectedReasons];
                                    newReasons[idx] = { ...newReasons[idx], subReasonText: e.target.value };
                                    setDetectedReasons(newReasons);
                                  }}
                                  style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "0.85rem", minHeight: "50px", resize: "vertical" }}
                                />
                              )}
                            </div>
                          )}

                          {/* 残業 または その他乖離 */}
                          {(r.type === "残業" || r.type === "その他乖離") && (
                            <div style={{ marginLeft: "26px" }}>
                              <label style={{ display: "block", fontSize: "0.8rem", color: "#6b7280", marginBottom: "4px" }}>{r.type === "残業" ? "残業理由 *" : "理由 *"}</label>
                              <textarea
                                placeholder={r.type === "残業" ? "残業理由を入力してください" : "理由を入力してください"}
                                value={r.detail}
                                onChange={e => {
                                  const newReasons = [...detectedReasons];
                                  newReasons[idx] = { ...newReasons[idx], detail: e.target.value };
                                  setDetectedReasons(newReasons);
                                }}
                                style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "0.85rem", minHeight: "50px", resize: "vertical" }}
                              />
                            </div>
                          )}
                        </div>
                      ))}
                    </>
                  ) : (
                    <div style={{ background: "#dcfce7", border: "1px solid #86efac", borderRadius: "8px", padding: "14px", marginBottom: "10px", color: "#166534", fontWeight: "bold" }}>
                      ✅ シフトとの時間乖離はありません
                    </div>
                  )}

                  {/* 打刻忘れトグルと時間入力 */}
                  <div style={{ background: "#f3f4f6", borderRadius: "8px", padding: "14px", marginTop: "16px" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontWeight: "bold", color: "#4b5563" }}>
                      <input 
                        type="checkbox" 
                        checked={isForgotClockToggle} 
                        onChange={(e) => setIsForgotClockToggle(e.target.checked)}
                        style={{ width: "18px", height: "18px", accentColor: "#4f46e5", cursor: "pointer" }}
                      />
                      ☑ 打刻忘れである
                    </label>
                    
                    {isForgotClockToggle && (
                      <div style={{ marginTop: "12px", background: "#fef3c7", borderRadius: "8px", padding: "12px", border: "1px solid #fde68a" }}>
                        <div style={{ fontSize: "0.85rem", fontWeight: "bold", color: "#92400e", marginBottom: "12px" }}>
                          ⏰ 実際の時間を入力してください（再計算されます）
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                          <div>
                            <label style={{ display: "block", fontSize: "0.8rem", color: "#6b7280", marginBottom: "4px" }}>実際の出社時間</label>
                            <input 
                              type="time" 
                              value={forgotClockActualIn} 
                              onChange={e => setForgotClockActualIn(e.target.value)}
                              style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "0.9rem" }}
                            />
                          </div>
                          <div>
                            <label style={{ display: "block", fontSize: "0.8rem", color: "#6b7280", marginBottom: "4px" }}>実際の退勤時間 *</label>
                            <input 
                              type="time" 
                              value={forgotClockActualOut} 
                              onChange={e => setForgotClockActualOut(e.target.value)}
                              style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "0.9rem" }}
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* 従来の単一理由セレクトUI（出勤時・シフトなし・打刻編集など） */
                <>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: "bold", color: "#374151", marginBottom: "6px" }}>乖離理由 *</label>
                  <select
                    value={discrepancyReason}
                    onChange={e => { setDiscrepancyReason(e.target.value); setDiscrepancySubReason(""); setDiscrepancySubReasonText(""); setDiscrepancyText(""); }}
                    style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid #d1d5db", marginBottom: "12px", fontSize: "0.95rem" }}
                  >
                    <option value="">-- 選択してください --</option>
                    {REASON_OPTIONS.filter(r => r !== "-").map(r => <option key={r} value={r}>{r}</option>)}
                  </select>

                  {/* サブ理由（遅刻/早退/欠勤の場合） */}
                  {discrepancyReason && REASON_SUB_OPTIONS[discrepancyReason] && REASON_SUB_OPTIONS[discrepancyReason].length > 0 && (
                    <>
                      <label style={{ display: "block", fontSize: "0.85rem", fontWeight: "bold", color: "#374151", marginBottom: "6px" }}>詳細理由 *</label>
                      <select
                        value={discrepancySubReason}
                        onChange={e => { setDiscrepancySubReason(e.target.value); setDiscrepancySubReasonText(""); }}
                        style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid #d1d5db", marginBottom: "12px", fontSize: "0.95rem" }}
                      >
                        <option value="">-- 選択してください --</option>
                        {REASON_SUB_OPTIONS[discrepancyReason].map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                      {discrepancySubReason === "その他" && (
                        <textarea
                          placeholder="理由を入力してください"
                          value={discrepancySubReasonText}
                          onChange={e => setDiscrepancySubReasonText(e.target.value)}
                          style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid #d1d5db", marginBottom: "12px", fontSize: "0.9rem", minHeight: "60px", resize: "vertical" }}
                        />
                      )}
                    </>
                  )}

                  {/* 出張場所 / 残業理由 / 打刻間違い詳細 / その他理由 */}
                  {(discrepancyReason === "出張" || discrepancyReason === "残業" || discrepancyReason === "打刻間違い" || discrepancyReason === "その他") && (
                    <>
                      <label style={{ display: "block", fontSize: "0.85rem", fontWeight: "bold", color: "#374151", marginBottom: "6px" }}>
                        {discrepancyReason === "出張" ? "出張場所 *" : discrepancyReason === "打刻間違い" ? "詳細 *" : discrepancyReason === "その他" ? "理由 *" : "残業理由 *"}
                      </label>
                      <textarea
                        placeholder={discrepancyReason === "出張" ? "出張場所を入力" : discrepancyReason === "打刻間違い" ? "どのように間違えたか入力" : discrepancyReason === "その他" ? "理由を入力してください" : "残業理由を入力"}
                        value={discrepancyText}
                        onChange={e => setDiscrepancyText(e.target.value)}
                        style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid #d1d5db", marginBottom: "12px", fontSize: "0.9rem", minHeight: "60px", resize: "vertical" }}
                      />
                    </>
                  )}
                </>
              )}

              {/* 打刻忘れ: 実際の出社/退勤時間入力 */}
              {discrepancyReason === "打刻忘れ" && (
                <div style={{ background: "#fef3c7", borderRadius: "8px", padding: "16px", marginBottom: "12px" }}>
                  <div style={{ fontSize: "0.85rem", fontWeight: "bold", color: "#92400e", marginBottom: "12px" }}>
                    ⏰ おおよその実際の時間を入力してください（5分単位）
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                    <div>
                      <label style={{ display: "block", fontSize: "0.8rem", color: "#6b7280", marginBottom: "4px" }}>実際の出社時間 *</label>
                      <select
                        value={forgotClockActualIn}
                        onChange={e => setForgotClockActualIn(e.target.value)}
                        style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid #d1d5db", fontSize: "0.95rem" }}
                      >
                        <option value="">--:--</option>
                        {(() => {
                          const base = discrepancyAppliedIn || discrepancyInfo?.clockIn || "09:00";
                          const [bh, bm] = base.split(":").map(Number);
                          const baseMin = bh * 60 + bm;
                          const start = Math.max(0, baseMin - 30);
                          const end = Math.min(24 * 60 - 1, baseMin + 30);
                          const opts = [];
                          for (let t = start; t <= end; t += 5) {
                            const h = String(Math.floor(t / 60)).padStart(2, "0");
                            const m = String(t % 60).padStart(2, "0");
                            opts.push(`${h}:${m}`);
                          }
                          return opts.map(t => <option key={t} value={t}>{t}</option>);
                        })()}
                      </select>
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: "0.8rem", color: "#6b7280", marginBottom: "4px" }}>実際の退勤時間</label>
                      <select
                        value={forgotClockActualOut}
                        onChange={e => setForgotClockActualOut(e.target.value)}
                        style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid #d1d5db", fontSize: "0.95rem" }}
                      >
                        <option value="">--:--</option>
                        {(() => {
                          const base = discrepancyAppliedOut || discrepancyInfo?.clockOutTime || "18:00";
                          const [bh, bm] = base.split(":").map(Number);
                          const baseMin = bh * 60 + bm;
                          const start = Math.max(0, baseMin - 30);
                          const end = Math.min(24 * 60 - 1, baseMin + 30);
                          const opts = [];
                          for (let t = start; t <= end; t += 5) {
                            const h = String(Math.floor(t / 60)).padStart(2, "0");
                            const m = String(t % 60).padStart(2, "0");
                            opts.push(`${h}:${m}`);
                          }
                          return opts.map(t => <option key={t} value={t}>{t}</option>);
                        })()}
                      </select>
                    </div>
                  </div>
                </div>
              )}

              <div style={{ display: "flex", gap: "12px", marginTop: "8px" }}>
                <button
                  onClick={() => setDiscrepancyModalOpen(false)}
                  style={{
                    flex: 1, padding: "12px", borderRadius: "8px", border: "1px solid #d1d5db",
                    background: "#fff", color: "#374151", fontSize: "0.95rem", cursor: "pointer", fontWeight: "bold"
                  }}
                >
                  キャンセル
                </button>
                <button
                  onClick={handleDiscrepancySubmit}
                  disabled={loading}
                  style={{
                    flex: 1, padding: "12px", borderRadius: "8px", border: "none",
                    background: "#ef4444", color: "#fff", fontSize: "0.95rem", cursor: "pointer", fontWeight: "bold",
                    boxShadow: "0 4px 6px rgba(239,68,68,0.3)"
                  }}
                >
                  退勤して申請
                </button>
              </div>
            </div>
          </div>
        )}

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

        {resubmissionCount > 0 && (
          <div style={{ background: "#faf5ff", color: "#7c3aed", padding: "12px 16px", borderRadius: "8px", marginBottom: "8px", border: "1px solid #e9d5ff" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.9rem", marginBottom: "8px" }}>
              <AlertCircle size={18} />
              <span>⚠️ <strong>再提出依頼: {resubmissionCount}件</strong></span>
            </div>
            <div style={{ marginLeft: "26px", fontSize: "0.85rem" }}>
              {resubmissionDates.map((rd, idx) => (
                <div key={idx} style={{ marginBottom: "4px", padding: "4px 8px", background: rd.isSaReturn ? "#fff7ed" : "#f3e8ff", borderRadius: "4px", border: rd.isSaReturn ? "1px solid #fed7aa" : "none" }}>
                  <strong>{rd.label}</strong>
                  {rd.isSaReturn && <span style={{ marginLeft: "6px", padding: "1px 6px", background: "#c2410c", color: "#fff", borderRadius: "3px", fontSize: "10px", fontWeight: "bold" }}>上位管理者</span>}
                  {rd.superAdminComment && <div style={{ marginTop: "2px", color: "#c2410c", fontSize: "0.82rem" }}>📝 {rd.superAdminComment}</div>}
                  {rd.adminComment && !rd.isSaReturn && <span style={{ marginLeft: "8px", color: "#6b21a8" }}>— {rd.adminComment}</span>}
                </div>
              ))}
              <div style={{ marginTop: "6px", fontSize: "0.8rem", color: "#9333ea" }}>
                <a href="/report" style={{ color: "#7c3aed", fontWeight: "bold", textDecoration: "underline" }}>
                  レポートタブ
                </a>
                から該当日を確認し、再申請してください。
              </div>
            </div>
          </div>
        )}

        {notClockedOutCount > 0 && (
          <div style={{ background: "#fffbeb", color: "#b45309", padding: "12px 16px", borderRadius: "8px", marginBottom: "8px", display: "flex", alignItems: "flex-start", gap: "8px", fontSize: "0.9rem", border: "1px solid #fde68a" }}>
            <AlertCircle size={18} style={{ flexShrink: 0, marginTop: "2px" }} />
            <span>⏰ <strong>未退勤: {notClockedOutDates.join("、")}</strong> — 退勤打刻を忘れずに。</span>
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
      <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", marginBottom: "32px" }}>
        <div className="card" style={{ padding: "20px", flex: "1 1 150px", minWidth: "140px" }}>
          <div style={{ fontSize: "0.85rem", color: "#6b7280", marginBottom: "8px" }}>今月の出勤日数</div>
          <div style={{ fontSize: "1.5rem", fontWeight: "bold" }}>{stats.days} 日</div>
        </div>
        <div className="card" style={{ padding: "20px", flex: "1 1 150px", minWidth: "140px" }}>
          <div style={{ fontSize: "0.85rem", color: "#6b7280", marginBottom: "8px" }}>今月の勤務時間</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            {user?.employmentType === "派遣" ? (
              <>
                <div style={{ fontSize: "1rem", fontWeight: "bold", color: "#2563eb" }}>派遣: {stats.dispH}h {stats.dispM}m</div>
                <div style={{ fontSize: "1rem", fontWeight: "bold", color: "#16a34a" }}>バイト: {stats.partH}h {stats.partM}m</div>
              </>
            ) : (
              <div style={{ fontSize: "1.5rem", fontWeight: "bold" }}>{stats.totalH}h {stats.totalM}m</div>
            )}
          </div>
        </div>
        <div className="card" style={{ padding: "20px", flex: "1 1 100px", minWidth: "100px", background: lateCount > 0 ? "#fef2f2" : undefined }}>
          <div style={{ fontSize: "0.85rem", color: lateCount > 0 ? "#b91c1c" : "#6b7280", marginBottom: "8px" }}>遅刻</div>
          <div style={{ fontSize: "1.5rem", fontWeight: "bold", color: lateCount > 0 ? "#dc2626" : "#374151" }}>{lateCount} 件</div>
          {lateData.dates.length > 0 && (
            <div style={{ marginTop: "8px", fontSize: "0.7rem", color: "#b91c1c" }}>
              {lateData.dates.join("、")}
            </div>
          )}
        </div>
        <div className="card" style={{ padding: "20px", flex: "1 1 100px", minWidth: "100px", background: absentData.count > 0 ? "#fef2f2" : undefined }}>
          <div style={{ fontSize: "0.85rem", color: absentData.count > 0 ? "#b91c1c" : "#6b7280", marginBottom: "8px" }}>欠勤</div>
          <div style={{ fontSize: "1.5rem", fontWeight: "bold", color: absentData.count > 0 ? "#dc2626" : "#374151" }}>{absentData.count} 件</div>
          {absentData.dates.length > 0 && (
            <div style={{ marginTop: "8px", fontSize: "0.7rem", color: "#b91c1c" }}>
              {absentData.dates.join("、")}
            </div>
          )}
        </div>
        <div className="card" style={{ padding: "20px", flex: "1 1 100px", minWidth: "100px", background: earlyData.count > 0 ? "#fffbeb" : undefined }}>
          <div style={{ fontSize: "0.85rem", color: earlyData.count > 0 ? "#b45309" : "#6b7280", marginBottom: "8px" }}>早退</div>
          <div style={{ fontSize: "1.5rem", fontWeight: "bold", color: earlyData.count > 0 ? "#f59e0b" : "#374151" }}>{earlyData.count} 件</div>
          {earlyData.dates.length > 0 && (
            <div style={{ marginTop: "8px", fontSize: "0.7rem", color: "#b45309" }}>
              {earlyData.dates.join("、")}
            </div>
          )}
        </div>
      </div>


      {/* 4. MANUAL SECTION */}
      <StaffManual />

      {/* --- EDIT FORM (Rendered when expandedDate is set) --- */}
      {expandedDate && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 1000, backdropFilter: "blur(2px)"
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setExpandedDate(null); }}
        >
          <div
            style={{
              width: "90%", maxWidth: "600px",
              background: "#fff", padding: "24px", borderRadius: "16px",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
              maxHeight: "90vh", overflowY: "auto", border: "1px solid #e5e7eb"
            }}
            onClick={(e) => e.stopPropagation()}
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

            {/* BREAK DURATION */}
            <div style={{ background: "#f9fafb", padding: "16px", borderRadius: "12px", border: "1px solid #e5e7eb", marginBottom: "24px" }}>
              <label style={{ display: "block", fontSize: "0.85rem", fontWeight: "bold", color: "#374151", marginBottom: "6px" }}>
                <Coffee size={16} style={{ verticalAlign: "middle", marginRight: "6px" }} />
                休憩時間
              </label>
              <select
                value={formBreakDuration}
                onChange={e => setFormBreakDuration(Number(e.target.value))}
                style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid #d1d5db", fontSize: "1rem" }}
              >
                <option value={0}>なし</option>
                <option value={30}>0.5H</option>
                <option value={60}>1H</option>
                <option value={90}>1.5H</option>
                <option value={120}>2H</option>
                <option value={150}>2.5H</option>
                <option value={180}>3H</option>
              </select>
              {formBreakDuration > 0 && formIn && formOut && (() => {
                const totalMin = Math.max(0, toMin(formOut) - toMin(formIn));
                const workMin = Math.max(0, totalMin - formBreakDuration);
                const wH = Math.floor(workMin / 60);
                const wM = workMin % 60;
                return (
                  <div style={{ marginTop: "8px", fontSize: "0.8rem", color: "#6b7280" }}>
                    実働見込: {wH}h{wM > 0 ? `${wM}m` : ''}  (総{Math.floor(totalMin / 60)}h{totalMin % 60 > 0 ? `${totalMin % 60}m` : ''} - 休憩{formBreakDuration >= 60 ? `${Math.floor(formBreakDuration / 60)}h` : ''}{formBreakDuration % 60 > 0 ? `${formBreakDuration % 60}m` : ''})
                  </div>
                );
              })()}
            </div>

            {/* REASON */}
            <div style={{ marginBottom: "24px" }}>
              <label style={{ display: "block", fontSize: "0.9rem", fontWeight: "bold", marginBottom: "8px", color: "#374151" }}>
                修正・申請理由
                {((formIn && getShift(user.userName, expandedDate)?.start && toMin(formIn) > toMin(getShift(user.userName, expandedDate)?.start)) || (formOut && getShift(user.userName, expandedDate)?.end && toMin(formOut) < toMin(getShift(user.userName, expandedDate)?.end))) &&
                  <span style={{ color: "#ef4444", fontSize: "0.8rem", marginLeft: "6px", background: "#fef2f2", padding: "2px 6px", borderRadius: "4px", border: "1px solid #fecaca" }}>遅刻/早退 (必須)</span>
                }
              </label>

              {/* カテゴリ選択 */}
              <select
                value={reason}
                onChange={e => { setReason(e.target.value); setSubReason(""); setSubReasonText(""); setFormText(""); setFormForgotActualIn(""); setFormForgotActualOut(""); }}
                style={{ width: "100%", padding: "12px", borderRadius: "8px", border: "1px solid #d1d5db", marginBottom: "12px", fontSize: "0.95rem" }}
              >
                <option value="">理由を選択してください</option>
                {REASON_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>

              {/* サブ理由: 早退/欠勤/遅刻 */}
              {reason && REASON_SUB_OPTIONS[reason] && REASON_SUB_OPTIONS[reason].length > 0 && (
                <div style={{ background: "#f0f9ff", padding: "12px", borderRadius: "8px", border: "1px solid #bae6fd", marginBottom: "12px" }}>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: "bold", color: "#0369a1", marginBottom: "6px" }}>
                    {reason}の詳細理由
                  </label>
                  <select
                    value={subReason}
                    onChange={e => { setSubReason(e.target.value); setSubReasonText(""); }}
                    style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "0.9rem", marginBottom: subReason === "その他" ? "8px" : "0" }}
                  >
                    <option value="">選択してください</option>
                    {REASON_SUB_OPTIONS[reason].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  {subReason === "その他" && (
                    <input
                      type="text"
                      placeholder="具体的な理由を入力してください"
                      value={subReasonText}
                      onChange={e => setSubReasonText(e.target.value)}
                      style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "0.9rem", boxSizing: "border-box" }}
                    />
                  )}
                </div>
              )}

              {/* 出張: 場所入力 */}
              {reason === "出張" && (
                <div style={{ background: "#f5f3ff", padding: "12px", borderRadius: "8px", border: "1px solid #ddd6fe", marginBottom: "12px" }}>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: "bold", color: "#6d28d9", marginBottom: "6px" }}>
                    出張場所
                  </label>
                  <input
                    type="text"
                    placeholder="出張場所を入力してください"
                    value={formText}
                    onChange={e => setFormText(e.target.value)}
                    style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "0.9rem", boxSizing: "border-box" }}
                  />
                </div>
              )}

              {/* 残業: サブ理由選択後に補足入力（サブ理由セクションで処理） */}

              {/* 打刻間違い: 詳細入力 */}
              {reason === "打刻間違い" && (
                <div style={{ background: "#fef3c7", padding: "12px", borderRadius: "8px", border: "1px solid #fcd34d", marginBottom: "12px" }}>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: "bold", color: "#92400e", marginBottom: "6px" }}>
                    どのように間違えたか
                  </label>
                  <textarea
                    placeholder="例：出勤打刻と退勤打刻を間違えて押してしまいました"
                    value={formText}
                    onChange={e => setFormText(e.target.value)}
                    style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "0.9rem", minHeight: "60px", boxSizing: "border-box" }}
                  />
                </div>
              )}

              {/* その他: 理由入力 */}
              {reason === "その他" && (
                <div style={{ background: "#f0f9ff", padding: "12px", borderRadius: "8px", border: "1px solid #bae6fd", marginBottom: "12px" }}>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: "bold", color: "#0369a1", marginBottom: "6px" }}>
                    理由を入力してください *
                  </label>
                  <textarea
                    placeholder="具体的な理由を入力してください"
                    value={formText}
                    onChange={e => setFormText(e.target.value)}
                    style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "0.9rem", minHeight: "60px", boxSizing: "border-box" }}
                  />
                </div>
              )}

              {/* 打刻忘れ: 実際の出社/退勤時間入力 */}
              {reason === "打刻忘れ" && (
                <div style={{ background: "#fef3c7", padding: "16px", borderRadius: "8px", border: "1px solid #fcd34d", marginBottom: "12px" }}>
                  <div style={{ fontSize: "0.85rem", fontWeight: "bold", color: "#92400e", marginBottom: "12px" }}>
                    ⏰ おおよその実際の時間を入力してください（5分単位）
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                    <div>
                      <label style={{ display: "block", fontSize: "0.8rem", color: "#6b7280", marginBottom: "4px" }}>実際の出社時間 *</label>
                      <select
                        value={formForgotActualIn}
                        onChange={e => setFormForgotActualIn(e.target.value)}
                        style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid #d1d5db", fontSize: "0.95rem" }}
                      >
                        <option value="">--:--</option>
                        {(() => {
                          const base = formIn || "09:00";
                          const [bh, bm] = base.split(":").map(Number);
                          const baseMin = bh * 60 + bm;
                          const start = Math.max(0, baseMin - 30);
                          const end = Math.min(24 * 60 - 1, baseMin + 30);
                          const opts = [];
                          for (let t = start; t <= end; t += 5) {
                            const h = String(Math.floor(t / 60)).padStart(2, "0");
                            const m = String(t % 60).padStart(2, "0");
                            opts.push(`${h}:${m}`);
                          }
                          return opts.map(t => <option key={t} value={t}>{t}</option>);
                        })()}
                      </select>
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: "0.8rem", color: "#6b7280", marginBottom: "4px" }}>実際の退勤時間</label>
                      <select
                        value={formForgotActualOut}
                        onChange={e => setFormForgotActualOut(e.target.value)}
                        style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid #d1d5db", fontSize: "0.95rem" }}
                      >
                        <option value="">--:--</option>
                        {(() => {
                          const base = formOut || "18:00";
                          const [bh, bm] = base.split(":").map(Number);
                          const baseMin = bh * 60 + bm;
                          const start = Math.max(0, baseMin - 30);
                          const end = Math.min(24 * 60 - 1, baseMin + 30);
                          const opts = [];
                          for (let t = start; t <= end; t += 5) {
                            const h = String(Math.floor(t / 60)).padStart(2, "0");
                            const m = String(t % 60).padStart(2, "0");
                            opts.push(`${h}:${m}`);
                          }
                          return opts.map(t => <option key={t} value={t}>{t}</option>);
                        })()}
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* 欠勤選択時の注意表示 */}
              {reason === "欠勤" && (
                <div style={{ fontSize: "0.8rem", color: "#991b1b", background: "#fef2f2", padding: "8px 12px", borderRadius: "6px", border: "1px solid #fecaca" }}>
                  ⚠ 欠勤申請として処理されます（出退勤時刻は空で送信されます）
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: "12px", paddingTop: "12px", borderTop: "1px solid #f3f4f6" }}>
              <button onClick={() => setExpandedDate(null)} style={{ flex: 1, padding: "14px", borderRadius: "8px", border: "none", background: "#f3f4f6", color: "#4b5563", fontWeight: "bold", cursor: "pointer" }}>キャンセル</button>
              {(() => {
                const itm = items.find(i => i.workDate === expandedDate);
                const app = itm ? parseComment(itm.comment).application : null;
                return app?.status === "pending" || app?.status === "absent";
              })() && (
                  <button
                    type="button"
                    onClick={() => handleWithdraw()}
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

              {(() => {
                const currentItem = items.find(i => i.workDate === expandedDate);
                const isUnclocked = currentItem && currentItem.clockIn && !currentItem.clockOut && reason !== "欠勤" && reason !== "打刻忘れ" && reason !== "出張";
                return (
                  <>
                    {isUnclocked && (
                      <div style={{ width: "100%", padding: "10px", background: "#fef3c7", borderRadius: "8px", textAlign: "center", fontSize: "13px", color: "#92400e", fontWeight: "bold" }}>
                        ⚠️ 退勤してから申請してください
                      </div>
                    )}
                    <button
                      onClick={handleUpdate}
                      disabled={loading || isUnclocked}
                      style={{
                        flex: 2, padding: "14px", borderRadius: "8px", border: "none",
                        background: isUnclocked ? "#d1d5db" : loading ? "#93c5fd" : reason === "欠勤" ? "#ef4444" : "#2563eb",
                        color: "#fff", fontWeight: "bold", cursor: (loading || isUnclocked) ? "default" : "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
                        boxShadow: isUnclocked ? "none" : reason === "欠勤" ? "0 4px 6px rgba(239, 68, 68, 0.2)" : "0 4px 6px rgba(37, 99, 235, 0.2)"
                      }}
                    >
                      {loading ? "送信中..." : <><CheckCircle size={20} /> {isUnclocked ? "退勤後に申請可能" : reason === "欠勤" ? "欠勤申請" : "申請を保存"}</>}
                    </button>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
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
