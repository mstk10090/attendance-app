import React, { useEffect, useState, useMemo } from "react";
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addDays, addMonths, subMonths, startOfYear, endOfYear, isSaturday, isSunday } from "date-fns";
import { ja } from "date-fns/locale";
import { Search, Filter, AlertTriangle, CheckCircle, XCircle, Clock, MapPin, Download, Save, X, Briefcase, FileText, Send, PieChart, BarChart, ClipboardCheck } from "lucide-react";
import "../../App.css";
import { LOCATIONS, DEPARTMENTS, EMPLOYMENT_TYPES, HOLIDAYS } from "../../constants";
import { fetchShiftData, normalizeName } from "../../utils/shiftParser";


const API_BASE = "https://lfsu60xvw7.execute-api.ap-northeast-1.amazonaws.com";
const API_USER_URL = "https://lfsu60xvw7.execute-api.ap-northeast-1.amazonaws.com/users";

// --- Utilities ---
const parseComment = (raw) => {
  try {
    if (!raw) return { segments: [], text: "" };
    if (typeof raw === "object") {
      if (Array.isArray(raw)) return { segments: raw, text: "" };
      return { segments: raw.segments || [], text: raw.text || "", application: raw.application || null };
    }
    const parsed = JSON.parse(raw);
    if (!parsed) return { segments: [], text: raw };

    if (Array.isArray(parsed)) {
      return { segments: parsed, text: "" };
    }
    if (typeof parsed === 'object') {
      const segs = Array.isArray(parsed.segments) ? parsed.segments : [];
      return {
        segments: segs,
        text: parsed.text || "",
        application: parsed.application || null
      };
    }
    return { segments: [], text: raw };
  } catch (e) {
    return { segments: [], text: raw || "" };
  }
};

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
  if (!e.clockIn || !e.clockOut) return 0;
  // 出勤は30分切り上げ、退勤は30分切り捨てしてから実動時間を算出
  const roundedIn = Math.ceil(toMin(e.clockIn) / 30) * 30;
  const roundedOut = Math.floor(toMin(e.clockOut) / 30) * 30;
  const brk = calcBreakTime(e);
  return Math.max(0, roundedOut - roundedIn - brk);
};

const hasNightWork = (e) => {
  if (!e.clockIn || !e.clockOut) return false;
  const outMin = toMin(e.clockOut);
  return outMin > 1320; // 22:00
};

const isLongWork = (item) => {
  if (!item.clockIn || !item.clockOut) return false;
  if (item.clockIn && !item.clockOut) {
    const start = new Date(`${item.workDate}T${item.clockIn}`);
    const now = new Date();
    return (now - start) > (24 * 3600 * 1000);
  }
  return false;
};

const isWorkDay = (dateStr) => {
  const d = new Date(dateStr);
  if (isSaturday(d) || isSunday(d)) return false;
  if (HOLIDAYS.includes(dateStr)) return false;
  return true;
};

const calcSplitDisplay = (item, shift) => {
  if (!item.clockIn) return "-";
  if (!item.clockOut) return `${item.clockIn} ~ (勤務中)`;

  // 申請時間がある場合はそちらを優先使用（承認済み・承認待ちなど）
  const p = parseComment(item.comment);
  const app = p.application || {};
  const effectiveIn = app.appliedIn || item.clockIn;
  const effectiveOut = app.appliedOut || item.clockOut;

  const totalWork = Math.max(0, toMin(effectiveOut) - toMin(effectiveIn));
  let dispatchMin = 0;
  let partTimeMin = 0;

  // Dispatch Check
  // "朝","早","遅","中" imply Dispatch if matched.
  // Also shift.location === "派遣"
  const isDispatch = shift?.isDispatch || shift?.location === "派遣" || ["朝", "早", "遅", "中"].includes(shift?.type || "");

  if (isDispatch && shift && shift.start && shift.end) {
    const shiftStart = toMin(shift.start);
    const shiftEnd = toMin(shift.end);
    const actualIn = toMin(effectiveIn);
    const actualOut = toMin(effectiveOut);

    const start = Math.max(shiftStart, actualIn);
    const end = Math.min(shiftEnd, actualOut);

    if (start < end) {
      // Intersection Exists
      const breaks = item.breaks || [];
      let breakInOverlap = 0;

      breaks.forEach(b => {
        if (b.start && b.end) {
          const bStart = toMin(b.start);
          const bEnd = toMin(b.end);
          const bOverlapStart = Math.max(start, bStart);
          const bOverlapEnd = Math.min(end, bEnd);
          if (bOverlapStart < bOverlapEnd) {
            breakInOverlap += (bOverlapEnd - bOverlapStart);
          }
        }
      });

      dispatchMin = Math.min(Math.max(0, (end - start) - breakInOverlap), 8 * 60); // 派遣は最大8時間
    }
    partTimeMin = Math.max(0, totalWork - dispatchMin);

  } else {
    // Not dispatch, return standard
    return <div>{item.clockIn} - {item.clockOut}</div>;
  }

  // Visual Display Logic
  const splitPointMin = Math.min(toMin(shift.end), toMin(effectiveOut));
  const splitPoint = minToTime(splitPointMin);

  return (
    <div style={{ fontSize: "0.85rem", lineHeight: "1.4" }}>
      {dispatchMin > 0 && (
        <div>{effectiveIn.slice(0, 5)} - {splitPoint} (派遣)</div>
      )}
      {partTimeMin > 0 && (
        <div style={{ color: "#16a34a" }}>{splitPoint} - {effectiveOut.slice(0, 5)} (バイト)</div>
      )}
      {dispatchMin === 0 && partTimeMin === 0 && (
        <div>{effectiveIn.slice(0, 5)} - {effectiveOut.slice(0, 5)} (派遣)</div>
      )}
    </div>
  );
};


export default function AdminAttendance() {
  /* State */
  const [viewMode, setViewMode] = useState("daily"); // daily, weekly, monthly, report, current
  const [baseDate, setBaseDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [items, setItems] = useState([]);
  const [shiftMap, setShiftMap] = useState({}); // Stores shift data
  const [users, setUsers] = useState([]); // For report
  const [loading, setLoading] = useState(false);

  // 確認モーダル用ステート（window.confirmの代わり）
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    message: "",
    onConfirm: null,
    onCancel: null
  });

  // 確認モーダルを表示する関数
  const showConfirm = (msg) => {
    return new Promise((resolve) => {
      setConfirmModal({
        isOpen: true,
        message: msg,
        onConfirm: () => {
          setConfirmModal({ isOpen: false, message: "", onConfirm: null, onCancel: null });
          resolve(true);
        },
        onCancel: () => {
          setConfirmModal({ isOpen: false, message: "", onConfirm: null, onCancel: null });
          resolve(false);
        }
      });
    });
  };

  // Filter States
  const [filterName, setFilterName] = useState("");
  const [filterStatus, setFilterStatus] = useState(new Set());
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const statusDropdownRef = React.useRef(null);
  const [filterLocation, setFilterLocation] = useState("all");
  const [filterDepartment, setFilterDepartment] = useState("all");

  // 外クリックでステータスドロップダウンを閉じる
  React.useEffect(() => {
    const handleClickOutside = (e) => {
      if (statusDropdownRef.current && !statusDropdownRef.current.contains(e.target)) {
        setShowStatusDropdown(false);
      }
    };
    if (showStatusDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showStatusDropdown]);

  const [editingItem, setEditingItem] = useState(null);
  const [resubmitReason, setResubmitReason] = useState("");

  // 再提出理由選択用
  const RESUBMIT_REASONS = [
    "乖離理由を教えてください",
    "正しい勤怠時間で申請してください",
  ];
  const [resubmitTarget, setResubmitTarget] = useState(null); // テーブルから再提出するアイテム
  const [selectedResubmitReason, setSelectedResubmitReason] = useState("");
  const [customResubmitReason, setCustomResubmitReason] = useState("");

  // 取消理由選択用
  const CANCEL_REASONS = ["tapo確認済", "遅延証確認済"];
  const [cancelTarget, setCancelTarget] = useState(null); // { item, type }
  const [selectedCancelReason, setSelectedCancelReason] = useState("");
  const [customCancelReason, setCustomCancelReason] = useState("");

  // 乖離理由展開用
  const [expandedReasonId, setExpandedReasonId] = useState(null);




  useEffect(() => {
    fetchUsers();
    fetchShiftData().then(setShiftMap);
  }, []);

  const fetchUsers = async () => {
    try {
      const token = localStorage.getItem("token");
      const headers = {};
      if (token) headers["Authorization"] = token;

      const res = await fetch(API_USER_URL, { headers });
      if (res.ok) {
        const text = await res.text();
        const outer = JSON.parse(text);
        const data = (outer.body && typeof outer.body === "string") ? JSON.parse(outer.body) : outer;
        const list = Array.isArray(data) ? data : (data.items || []);
        setUsers(list);
      }
    } catch (e) { console.error(e); }
  }

  /* Data Fetching */
  const fetchRange = useMemo(() => {
    const d = new Date(baseDate);
    if (viewMode === "current") return { start: baseDate, end: baseDate };

    if (viewMode === "daily") {
      return { start: baseDate, end: baseDate };
    } else if (viewMode === "weekly") {
      return {
        start: format(startOfWeek(d, { weekStartsOn: 1 }), "yyyy-MM-dd"),
        end: format(endOfWeek(d, { weekStartsOn: 1 }), "yyyy-MM-dd"),
      };
    } else {
      // Monthly
      return {
        start: format(startOfMonth(d), "yyyy-MM-dd"),
        end: format(endOfMonth(d), "yyyy-MM-dd"),
      };
    }
  }, [viewMode, baseDate]);

  /* Currently Working Logic */
  const currentlyWorkingData = useMemo(() => {
    if (viewMode !== "current") return {};

    // items should contain Today's records
    const activeItems = items.filter(item => item.clockIn && !item.clockOut);

    const groups = {};
    activeItems.forEach(item => {
      let loc = item.segments?.[0]?.location || item.location;

      // Fallback to User Default
      if (!loc || loc === "未設定") {
        const u = users.find(u => u.userId === item.userId);
        if (u && u.defaultLocation) {
          loc = u.defaultLocation;
        } else {
          loc = "未設定";
        }
      }

      if (!groups[loc]) groups[loc] = [];
      groups[loc].push(item);
    });
    return groups;
  }, [items, viewMode, users]); // Added users dependency

  const fetchAttendances = async () => {
    setLoading(true);
    try {
      const start = new Date(fetchRange.start);
      const end = new Date(fetchRange.end);
      const days = eachDayOfInterval({ start, end });

      // Chunking requests
      const results = [];
      const CHUNK_SIZE = 5;
      for (let i = 0; i < days.length; i += CHUNK_SIZE) {
        const chunk = days.slice(i, i + CHUNK_SIZE);
        const chunkResults = await Promise.all(chunk.map(day =>
          fetch(`${API_BASE}/admin/attendance?date=${format(day, "yyyy-MM-dd")}`)
            .then(r => r.json())
            .then(d => (d.success ? d.items : []))
        ));
        results.push(...chunkResults);
        await new Promise(r => setTimeout(r, 50));
      }

      const allItems = results.flat();
      // userId + workDate で重複排除
      const uniqueByUserId = Array.from(new Map(allItems.map(item => [item.userId + item.workDate, item])).values());
      // userName + workDate でも重複排除（同一人物が異なるuserIdで存在するケース対応）
      const nameMap = new Map();
      uniqueByUserId.forEach(item => {
        const key = (item.userName || item.userId) + item.workDate;
        const existing = nameMap.get(key);
        if (!existing) {
          nameMap.set(key, item);
        } else {
          // より情報が充実しているレコードを優先（clockInがある方）
          if (!existing.clockIn && item.clockIn) {
            nameMap.set(key, item);
          }
        }
      });
      const uniqueItems = Array.from(nameMap.values());

      const processedItems = uniqueItems.map(item => {
        const p = parseComment(item.comment);
        const segments = (item.segments && item.segments.length > 0) ? item.segments : p.segments;
        return {
          ...item,
          segments,
          _parsedHtmlComment: p.text,
          _application: p.application // { status, reason, originalIn... }
        };
      });

      // Sort
      processedItems.sort((a, b) => {
        if (a.workDate !== b.workDate) return a.workDate.localeCompare(b.workDate);
        return a.userId.localeCompare(b.userId);
      });

      // シフト予定者の仮レコード追加（出勤前でもシフトがあれば表示）
      if (shiftMap && Object.keys(shiftMap).length > 0) {
        const existingKeys = new Set(processedItems.map(i => `${normalizeName(i.userName)}_${i.workDate}`));
        for (const day of days) {
          const dateStr = format(day, "yyyy-MM-dd");
          for (const shiftUserName of Object.keys(shiftMap)) {
            const shiftData = shiftMap[shiftUserName]?.[dateStr];
            if (!shiftData || shiftData.isOff) continue;
            const normalizedShiftName = normalizeName(shiftUserName);
            if (existingKeys.has(`${normalizedShiftName}_${dateStr}`)) continue;
            // ユーザー情報をusersから検索
            const matchedUser = users.find(u => normalizeName((u.lastName || "") + (u.firstName || "")) === normalizedShiftName);
            processedItems.push({
              userId: matchedUser?.userId || `shift_${shiftUserName}_${dateStr}`,
              userName: shiftUserName,
              workDate: dateStr,
              clockIn: "",
              clockOut: "",
              breaks: [],
              comment: "",
              location: shiftData.location || "",
              department: matchedUser?.department || "",
              segments: [],
              _parsedHtmlComment: "",
              _application: null,
              _shiftOnly: true // シフトのみフラグ
            });
            existingKeys.add(`${normalizedShiftName}_${dateStr}`);
          }
        }
        // 再ソート
        processedItems.sort((a, b) => {
          if (a.workDate !== b.workDate) return a.workDate.localeCompare(b.workDate);
          return (a.userName || "").localeCompare(b.userName || "");
        });
      }

      setItems(processedItems);
    } catch (e) {
      console.error(e);
      alert("データの取得に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAttendances();
  }, [fetchRange.start, fetchRange.end]);

  // shiftMapがロードされたらシフト予定者を追加するために再取得
  useEffect(() => {
    if (shiftMap && Object.keys(shiftMap).length > 0) {
      fetchAttendances();
    }
  }, [shiftMap]);

  // アイテムのステータスカテゴリを返す
  const getItemCategory = (item) => {
    const appStatus = item._application?.status;
    const isToday = item.workDate === format(new Date(), "yyyy-MM-dd");
    if (appStatus === "pending") return "pending";
    if (appStatus === "approved") return "approved";
    if (appStatus === "resubmission_requested") return "resubmission";
    if (appStatus === "absent") return "absent";
    if (item.clockIn && item.clockOut) {
      if (toMin(item.clockIn) > toMin(item.clockOut)) return "error";
      if (calcWorkMin(item) <= 0) return "error";
    }
    if (item.clockIn && !item.clockOut && !isToday) return "incomplete";
    if (item.clockIn && !item.clockOut && isToday) return "working";
    if (hasNightWork(item)) return "night";
    const app = item._application || {};
    if (app.reason && (app.reason === "寝坊" || app.reason.includes("早退"))) return "discrepancy";
    if (item.clockIn && app.appliedIn && toMin(item.clockIn) > toMin(app.appliedIn)) return "discrepancy";
    if (item.clockOut && app.appliedOut && toMin(item.clockOut) < toMin(app.appliedOut)) return "discrepancy";
    if (!item.clockIn) return "noshift";
    return "other";
  };

  /* Filtering Logic */
  const filteredItems = useMemo(() => {
    return items.filter(item => {
      if (filterName && !item.userName.includes(filterName)) return false;

      if (filterLocation !== "all") {
        const hasLoc =
          item.location === filterLocation ||
          (item.segments || []).some(s => s.location === filterLocation);
        if (!hasLoc) return false;
      }

      if (filterDepartment !== "all") {
        const hasDept =
          item.department === filterDepartment ||
          (item.segments || []).some(s => s.department === filterDepartment);
        if (!hasDept) return false;
      }

      // Set-based filter: empty = all, otherwise check category
      if (filterStatus.size > 0) {
        const cat = getItemCategory(item);
        if (!filterStatus.has(cat)) return false;
      }

      return true;
    });
  }, [items, filterName, filterStatus, filterLocation, filterDepartment]);




  const [searchQuery, setSearchQuery] = useState("");

  const filteredShiftCheckUsers = useMemo(() => {
    if (!searchQuery) return users;
    return users.filter(u => {
      const fullName = (u.lastName || "") + (u.firstName || "");
      return fullName.includes(searchQuery);
    });
  }, [users, searchQuery]);

  /* Mark Absent Logic */
  const handleMarkAbsent = async (userId, userName, dateStr) => {
    if (!await showConfirm(`${userName}さんを「欠勤」として登録しますか？`)) return;

    try {
      const payload = {
        userId: userId,
        workDate: dateStr,
        clockIn: "",
        clockOut: "",
        breaks: [],
        comment: JSON.stringify({
          segments: [],
          text: "管理者による欠勤登録",
          application: { status: "absent", reason: "欠勤" }
        })
      };

      await fetch(`${API_BASE}/attendance/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      alert("欠勤登録しました");
      window.location.reload();
    } catch (e) {
      console.error(e);
      alert("エラーが発生しました");
    }
  };

  /* --- ACTIONS --- */
  // モーダル用シフト検索（variant対応）
  const findShiftForItem = (item) => {
    if (!shiftMap || !item) return null;
    // 正規化キーで検索
    let s = shiftMap[normalizeName(item.userName)]?.[item.workDate] || null;
    if (!s) {
      const user = users.find(u => u.userId === item.userId);
      if (user) {
        const normalized = normalizeName((user.lastName || "") + (user.firstName || ""));
        s = shiftMap[normalized]?.[item.workDate] || null;
      }
    }
    return s;
  };

  const openEdit = (item) => {
    setEditingItem(item);
    setResubmitReason("");
  };

  const handleRequestResubmission = async () => {
    if (!resubmitReason.trim()) {
      alert("再提出依頼の理由を入力してください");
      return;
    }
    // 確認ダイアログなしで即座に再提出状態にする

    setLoading(true);
    try {
      const p = parseComment(editingItem.comment);
      const app = p.application || {};
      const newApp = {
        ...app,
        status: "resubmission_requested",
        reason: app.reason,
        adminComment: resubmitReason
      };

      const finalComment = JSON.stringify({
        segments: p.segments,
        text: (p.text || "") + `\n[再提出依頼]: ${resubmitReason}`,
        application: newApp
      });

      await fetch(`${API_BASE}/attendance/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: editingItem.userId,
          workDate: editingItem.workDate,
          clockIn: editingItem.clockIn,
          clockOut: editingItem.clockOut,
          breaks: editingItem.breaks || [],
          comment: finalComment
        }),
      });

      // 成功時は即座に閉じてリフレッシュ
      setEditingItem(null);
      fetchAttendances();

    } catch (e) {
      alert("エラーが発生しました");
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (targetItem = null, approveReason = null) => {
    // 確認ダイアログなし・ポップアップなしで即時承認
    const scrollY = window.scrollY;
    setLoading(true);
    try {
      const item = targetItem || editingItem;
      const p = parseComment(item.comment);

      // 申請がない場合（未申請）でも承認できるように、新規にapplicationを作成
      const existingApp = p.application || {};

      // 未申請の場合、打刻時間を30分単位に丸めて申請時間とする
      let appliedIn = existingApp.appliedIn || '';
      let appliedOut = existingApp.appliedOut || '';
      if (!existingApp.appliedIn && item.clockIn) {
        // 出勤は30分切り上げ
        const inMin = Math.ceil(toMin(item.clockIn) / 30) * 30;
        const inH = String(Math.floor(inMin / 60)).padStart(2, '0');
        const inM = String(inMin % 60).padStart(2, '0');
        appliedIn = `${inH}:${inM}`;
      }
      if (!existingApp.appliedOut && item.clockOut) {
        // 退勤は30分切り捨て
        const outMin = Math.floor(toMin(item.clockOut) / 30) * 30;
        const outH = String(Math.floor(outMin / 60)).padStart(2, '0');
        const outM = String(outMin % 60).padStart(2, '0');
        appliedOut = `${outH}:${outM}`;
      }

      const newApp = {
        ...existingApp,
        status: 'approved',
        appliedIn,
        appliedOut,
        appliedAt: existingApp.appliedAt || new Date().toISOString(),
        reason: existingApp.reason || '-',
        adminComment: approveReason || existingApp.adminComment || null
      };

      const finalComment = JSON.stringify({
        segments: p.segments,
        text: p.text,
        application: newApp
      });

      await fetch(`${API_BASE}/attendance/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: item.userId,
          workDate: item.workDate,
          clockIn: item.clockIn,
          clockOut: item.clockOut,
          breaks: item.breaks || [],
          comment: finalComment
        }),
      });

      setEditingItem(null);
      // ローカルstateを即時更新（スクロールリセット防止）
      setItems(prev => prev.map(i =>
        (i.userId === item.userId && i.workDate === item.workDate)
          ? { ...i, comment: finalComment, _application: newApp }
          : i
      ));
      // バックグラウンドでデータ再取得（スクロール位置を維持）
      fetchAttendances().then(() => {
        requestAnimationFrame(() => window.scrollTo(0, scrollY));
      });
      requestAnimationFrame(() => window.scrollTo(0, scrollY));
    } catch (e) {
      alert("処理に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  const handleCancelAbsent = async (item) => {
    if (!await showConfirm("欠勤を取り消しますか？\n(未申請状態に戻ります)")) return;
    setLoading(true);
    try {
      const payload = {
        userId: item.userId,
        workDate: item.workDate,
        clockIn: "",
        clockOut: "",
        breaks: [],
        comment: ""
      };
      await fetch(`${API_BASE}/attendance/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      alert("欠勤を取り消しました");
      setEditingItem(null);
      fetchAttendances();
    } catch (e) {
      alert("エラーが発生しました");
    } finally {
      setLoading(false);
    }
  };

  // 遅刻取消ハンドラ（モーダルを開く）
  const openCancelModal = (item, type = "late") => {
    setCancelTarget({ item, type });
    setSelectedCancelReason("");
    setCustomCancelReason("");
  };

  const handleCancelLate = async (item, type = "late", reason = "") => {
    const typeLabel = type === "late" ? "遅刻" : type === "early" ? "早退" : "遅刻+早退";

    if (!reason.trim()) {
      alert("理由を入力してください");
      return;
    }

    if (!await showConfirm(`${typeLabel}を取り消しますか？\n理由: ${reason}\n（理由があり問題ない出勤として扱います）`)) return;
    setLoading(true);
    try {
      const p = parseComment(item.comment);
      const newApp = {
        ...p.application,
        lateCancelled: type === "late" || type === "both" ? true : (p.application?.lateCancelled || false),
        earlyCancelled: type === "early" || type === "both" ? true : (p.application?.earlyCancelled || false),
        lateCancelledAt: new Date().toISOString(),
        lateCancelReason: type === "late" || type === "both" ? reason : (p.application?.lateCancelReason || ""),
        earlyCancelReason: type === "early" || type === "both" ? reason : (p.application?.earlyCancelReason || ""),
      };

      const finalComment = JSON.stringify({
        segments: p.segments,
        text: p.text,
        application: newApp
      });

      await fetch(`${API_BASE}/attendance/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: item.userId,
          workDate: item.workDate,
          clockIn: item.clockIn,
          clockOut: item.clockOut,
          breaks: item.breaks || [],
          comment: finalComment,
          location: item.location || "",
          department: item.department || ""
        }),
      });

      alert(`${typeLabel}を取り消しました`);
      fetchAttendances();
    } catch (e) {
      alert("エラーが発生しました");
    } finally {
      setLoading(false);
    }
  };  /* JSX */
  return (
    <div className="admin-container" style={{ paddingBottom: "100px" }}>
      {/* Header & Controls */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <h2 style={{ fontSize: "1.2rem", fontWeight: "bold", display: "flex", alignItems: "center", gap: "8px" }}>
            <Clock size={24} /> 勤怠管理ダッシュボード
          </h2>
          <div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "10px" }}>
              {/* Attendance Tabs */}
              <div style={{ display: "flex", background: "#f3f4f6", padding: "4px", borderRadius: "8px" }}>
                {[
                  { id: "current", icon: <CheckCircle size={14} />, label: "現在" },
                  { id: "daily", icon: null, label: "日次" },
                  { id: "weekly", icon: null, label: "週次" },
                  { id: "monthly", icon: null, label: "月次" }
                ].map(mode => (
                  <button
                    key={mode.id}
                    onClick={() => setViewMode(mode.id)}
                    style={{
                      display: "flex", alignItems: "center", gap: "6px",
                      padding: "6px 12px",
                      fontSize: "13px", fontWeight: "500",
                      borderRadius: "6px",
                      border: "none",
                      cursor: "pointer",
                      background: viewMode === mode.id ? "#fff" : "transparent",
                      color: viewMode === mode.id ? "#2563eb" : "#6b7280",
                      boxShadow: viewMode === mode.id ? "0 1px 2px rgba(0,0,0,0.1)" : "none",
                      transition: "all 0.2s"
                    }}
                  >
                    {mode.icon}
                    {mode.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Date Navigator */}
        {viewMode !== "current" && (
          <div style={{ display: "flex", gap: "16px", marginBottom: "16px", alignItems: "center" }}>
            <button className="icon-btn" onClick={() => {
              const d = new Date(baseDate);
              if (viewMode === "daily") setBaseDate(format(addDays(d, -1), "yyyy-MM-dd"));
              if (viewMode === "weekly") setBaseDate(format(addDays(d, -7), "yyyy-MM-dd"));
              if (viewMode === "monthly" || viewMode === "report") setBaseDate(format(subMonths(d, 1), "yyyy-MM-dd"));
            }}>{"<"}</button>

            <span style={{ fontWeight: "bold", fontSize: "1.1rem" }}>
              {viewMode === "daily" && format(new Date(baseDate), "yyyy年M月d日 (E)", { locale: ja })}
              {viewMode !== "daily" && `${fetchRange.start} 〜 ${fetchRange.end}`}
            </span>

            <button className="icon-btn" onClick={() => {
              const d = new Date(baseDate);
              if (viewMode === "daily") setBaseDate(format(addDays(d, 1), "yyyy-MM-dd"));
              if (viewMode === "weekly") setBaseDate(format(addDays(d, 7), "yyyy-MM-dd"));
              if (viewMode === "monthly" || viewMode === "report") setBaseDate(format(addMonths(d, 1), "yyyy-MM-dd"));
            }}>{">"}</button>

            {/* 今日ボタン */}
            {baseDate !== format(new Date(), "yyyy-MM-dd") && (
              <button
                onClick={() => setBaseDate(format(new Date(), "yyyy-MM-dd"))}
                style={{
                  padding: "6px 14px", borderRadius: "6px", border: "1px solid #3b82f6",
                  background: "#eff6ff", color: "#2563eb", fontSize: "13px", fontWeight: "bold",
                  cursor: "pointer", display: "flex", alignItems: "center", gap: "4px"
                }}
              >
                今日
              </button>
            )}
          </div>
        )}

        {/* Filters */}
        {viewMode !== "report" && viewMode !== "current" && viewMode !== "shift_check" && (
          <div className="filter-bar">
            {/* Same Filters ... */}
            <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <Search size={16} color="#6b7280" />
              <input
                type="text"
                placeholder="スタッフ名検索"
                className="input"
                value={filterName}
                onChange={e => setFilterName(e.target.value)}
              />
            </div>

            <div ref={statusDropdownRef} style={{ position: "relative", display: "flex", alignItems: "center", gap: "4px" }}>
              <Filter size={16} color="#6b7280" />
              <button
                className="input"
                onClick={() => setShowStatusDropdown(!showStatusDropdown)}
                style={{ cursor: "pointer", textAlign: "left", minWidth: "130px", background: "#fff", border: "1px solid #d1d5db", borderRadius: "6px", padding: "6px 10px", fontSize: "0.85rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "220px" }}
              >
                {(() => {
                  if (filterStatus.size === 0) return "全ステータス ▼";
                  const labels = { pending: "承認待ち", approved: "承認済み", working: "勤務中", incomplete: "未退勤", discrepancy: "時間ずれ", resubmission: "再提出", error: "時間異常", night: "深夜勤務", noshift: "未出勤" };
                  const selected = [...filterStatus].map(k => labels[k] || k);
                  return selected.join(", ") + " ▼";
                })()}
              </button>
              {showStatusDropdown && (
                <div style={{
                  position: "absolute", top: "100%", left: 0, zIndex: 1000,
                  background: "#fff", border: "1px solid #d1d5db", borderRadius: "8px",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.1)", minWidth: "180px", padding: "8px 0"
                }}>
                  {[{ key: "pending", label: "承認待ち" }, { key: "approved", label: "承認済み" }, { key: "working", label: "勤務中" }, { key: "incomplete", label: "未退勤" }, { key: "discrepancy", label: "時間ずれ" }, { key: "resubmission", label: "再提出" }, { key: "error", label: "時間異常" }, { key: "night", label: "深夜勤務" }, { key: "noshift", label: "未出勤" }].map(opt => (
                    <label key={opt.key} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 12px", cursor: "pointer", fontSize: "0.85rem" }}
                      onMouseOver={e => e.currentTarget.style.background = '#f3f4f6'}
                      onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
                      <input type="checkbox" checked={filterStatus.has(opt.key)} onChange={() => {
                        setFilterStatus(prev => {
                          const next = new Set(prev);
                          if (next.has(opt.key)) next.delete(opt.key); else next.add(opt.key);
                          return next;
                        });
                      }} />
                      {opt.label}
                    </label>
                  ))}
                  <div style={{ borderTop: "1px solid #e5e7eb", marginTop: "4px", paddingTop: "4px" }}>
                    <button onClick={() => setFilterStatus(new Set())} style={{ width: "100%", padding: "6px", background: "none", border: "none", color: "#6b7280", cursor: "pointer", fontSize: "0.8rem" }}>クリア</button>
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <MapPin size={16} color="#6b7280" />
              <select className="input" value={filterLocation} onChange={e => setFilterLocation(e.target.value)}>
                <option value="all">全勤務地</option>
                {LOCATIONS.filter(l => l !== "未記載").map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <Briefcase size={16} color="#6b7280" />
              <select className="input" value={filterDepartment} onChange={e => setFilterDepartment(e.target.value)}>
                <option value="all">全部署</option>
                {DEPARTMENTS.filter(d => d !== "未記載").map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>
        )}
      </div>

      {viewMode === "current" ? (
        /* --- CURRENTLY WORKING VIEW --- */
        <div className="card" style={{ background: "#f8fafc" }}>
          <h3 style={{ fontSize: "1.1rem", fontWeight: "bold", marginBottom: "16px", color: "#4b5563", display: "flex", alignItems: "center", gap: "8px" }}>
            <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#10b981", boxShadow: "0 0 0 3px #d1fae5" }} />
            現在の出勤状況 ({format(new Date(), "MM/dd HH:mm")} 時点)
          </h3>

          {loading ? (
            <div style={{ padding: "40px", textAlign: "center" }}>読み込み中...</div>
          ) : Object.keys(currentlyWorkingData).length === 0 ? (
            <div style={{ padding: "40px", textAlign: "center", color: "#6b7280", background: "#fff", borderRadius: "8px" }}>
              現在出勤中のスタッフはいません
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
              {Object.entries(currentlyWorkingData).map(([loc, people]) => (
                <div key={loc} style={{ background: "#fff", borderRadius: "12px", border: "1px solid #e5e7eb", overflow: "hidden" }}>
                  <div style={{ background: "#f1f5f9", padding: "10px 16px", borderBottom: "1px solid #e2e8f0", fontWeight: "bold", color: "#334155", display: "flex", justifyContent: "space-between" }}>
                    <span>📍 {loc}</span>
                    <span style={{ fontSize: "0.9rem", color: "#64748b" }}>{people.length}名</span>
                  </div>
                  <div style={{ maxHeight: "300px", overflowY: "auto" }}>
                    <table className="admin-table" style={{ width: "100%", margin: 0 }}>
                      <tbody>
                        {people.map(p => (
                          <tr key={p.userId} style={{ borderBottom: "1px solid #f8fafc" }}>
                            <td style={{ padding: "12px 16px", width: "200px" }}>
                              <div style={{ fontWeight: "bold", color: "#1e293b" }}>{p.userName}</div>
                              <div style={{ fontSize: "0.75rem", color: "#cbd5e1" }}>{p.department || "-"}</div>
                            </td>
                            <td style={{ padding: "12px 16px" }}>
                              <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                                <Clock size={14} color="#10b981" />
                                <span style={{ fontWeight: "bold", fontFamily: "monospace", fontSize: "1.1rem" }}>{p.clockIn}</span>
                                <span style={{ color: "#94a3b8", fontSize: "0.85rem" }}>出社</span>
                              </div>
                            </td>
                            <td style={{ padding: "12px 16px" }}>
                              {/* Duration so far */}
                              {(() => {
                                const now = new Date();
                                const start = new Date(`${format(now, "yyyy-MM-dd")}T${p.clockIn}`);
                                const diffMin = Math.max(0, Math.floor((now - start) / 60000));
                                const h = Math.floor(diffMin / 60);
                                const m = diffMin % 60;
                                return <span style={{ color: "#64748b", fontSize: "0.9rem" }}>経過: {h}時間{m}分</span>
                              })()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* --- DASHBOARD VIEW (Daily/Weekly/Monthly) --- */
        <div className="card">
          {loading ? (
            <div style={{ padding: "20px", textAlign: "center" }}>読み込み中...</div>
          ) : filteredItems.length === 0 ? (
            <div className="empty-text">該当するデータがありません</div>

          ) : viewMode === "monthly" ? (
            /* Calendar View */
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "1px", background: "#ddd", border: "1px solid #ddd" }}>
              {["月", "火", "水", "木", "金", "土", "日"].map(d => (
                <div key={d} style={{ background: "#f3f4f6", padding: "8px", textAlign: "center", fontWeight: "bold", fontSize: "14px" }}>{d}</div>
              ))}
              {(() => {
                const start = new Date(fetchRange.start);
                const end = new Date(fetchRange.end);
                const gridStart = startOfWeek(start, { weekStartsOn: 1 });
                const gridEnd = endOfWeek(end, { weekStartsOn: 1 });
                const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

                return days.map(d => {
                  const dayStr = format(d, "yyyy-MM-dd");
                  const dayItems = filteredItems.filter(i => i.workDate === dayStr);
                  const isCurrentMonth = format(d, "yyyy-MM") === format(start, "yyyy-MM");

                  const hasError = dayItems.some(i => (i.clockIn && i.clockOut && calcWorkMin(i) <= 0));
                  const pendingCount = dayItems.filter(i => i._application?.status === "pending").length;
                  const resubmitCount = dayItems.filter(i => i._application?.status === "resubmission_requested").length;

                  let bg = isCurrentMonth ? "#fff" : "#f9fafb";
                  if (hasError) bg = "#fef2f2";
                  else if (pendingCount > 0) bg = "#fff7ed";
                  else if (resubmitCount > 0) bg = "#f3e8ff"; // Purpleish for resubmit

                  return (
                    <div
                      key={dayStr}
                      onClick={() => { setBaseDate(dayStr); setViewMode("daily"); }}
                      style={{ background: bg, minHeight: "100px", padding: "8px", display: "flex", flexDirection: "column", cursor: "pointer" }}
                      className="calendar-cell"
                    >
                      <div style={{ fontSize: "14px", fontWeight: "bold", color: !isCurrentMonth ? "#aaa" : "#333" }}>
                        {format(d, "d")}
                      </div>
                      {dayItems.length > 0 && (
                        <div style={{ marginTop: "auto", fontSize: "11px" }}>
                          <div>{dayItems.length}名</div>
                          {pendingCount > 0 && <div style={{ color: "#ea580c" }}>待: {pendingCount}</div>}
                          {resubmitCount > 0 && <div style={{ color: "#7c3aed" }}>戻: {resubmitCount}</div>}
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          ) : (
            /* Table View */
            <div className="table-wrap" style={{ width: "100%" }}>
              <table className="admin-table" style={{ width: "100%", tableLayout: "fixed" }}>
                <thead>
                  <tr>
                    <th style={{ padding: "12px", fontSize: "14px", width: "90px" }}>日付</th>
                    <th style={{ padding: "12px", fontSize: "14px", width: "110px" }}>氏名</th>
                    <th style={{ padding: "12px", fontSize: "14px", width: "100px" }}>シフト</th>
                    <th style={{ padding: "12px", fontSize: "14px", width: "120px" }}>実績</th>
                    <th style={{ padding: "12px", fontSize: "14px", width: "100px" }}>申請時間</th>
                    <th style={{ padding: "12px", fontSize: "14px", width: "80px" }}>状態</th>
                    <th style={{ padding: "12px", fontSize: "14px", width: "70px" }}>実働</th>
                    <th style={{ padding: "12px", fontSize: "14px", width: "100px" }}>判定</th>
                    <th style={{ padding: "12px", fontSize: "14px", width: "120px" }}>理由</th>
                    <th style={{ padding: "12px", fontSize: "14px", width: "180px" }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map(item => {
                    const rowAppStatus = item._application?.status;
                    const isToday = isSameDay(new Date(item.workDate), new Date());
                    const isWorking = item.clockIn && !item.clockOut && isToday;
                    const isUnapplied = item.clockIn && item.clockOut && !rowAppStatus;
                    const isIncomplete = item.clockIn && !item.clockOut && !isToday;

                    // シフト情報を取得（正規化済みキーで検索）
                    let shift = shiftMap?.[normalizeName(item.userName)]?.[item.workDate] || null;

                    // 見つからない場合は、姓名連結で検索
                    if (!shift) {
                      const user = users.find(u => u.userId === item.userId);
                      if (user) {
                        const normalized = normalizeName((user.lastName || "") + (user.firstName || ""));
                        shift = shiftMap?.[normalized]?.[item.workDate] || null;
                      }
                    }

                    // シフトとの比較判定
                    let shiftCheck = null; // null=判定不可, "ok"=問題なし, "late"=遅刻, "early"=早退, "both"=遅刻+早退, "overtime"=残業, "late_overtime"=遅刻+残業
                    if (shift && !shift.isOff && item.clockIn && item.clockOut) {
                      const shiftStartMin = toMin(shift.start);
                      const shiftEndMin = toMin(shift.end);
                      const actualInMin = toMin(item.clockIn);
                      const actualOutMin = toMin(item.clockOut);

                      const isLate = actualInMin >= shiftStartMin;
                      const isEarly = actualOutMin < shiftEndMin;
                      const isOvertime = actualOutMin >= shiftEndMin + 30; // シフト終了30分以上で残業判定

                      if (isLate && isEarly) shiftCheck = "both";
                      else if (isLate && isOvertime) shiftCheck = "late_overtime";
                      else if (isLate) shiftCheck = "late";
                      else if (isEarly) shiftCheck = "early";
                      else if (isOvertime) shiftCheck = "overtime";
                      else shiftCheck = "ok";
                    }

                    const isShiftOnly = item._shiftOnly && !item.clockIn;

                    let bg = "#fff";
                    if (isShiftOnly) bg = "#fef2f2"; // Red (未出勤)
                    else if (rowAppStatus === "approved") bg = "#d1fae5"; // Stronger green for approved
                    else if (rowAppStatus === "pending") bg = "#fff7ed"; // Orange
                    else if (rowAppStatus === "resubmission_requested") bg = "#fcf4ff"; // Purple
                    else if (isIncomplete) bg = "#fee2e2"; // Red (Forgot Clockout)
                    else if ((shiftCheck === "overtime" || shiftCheck === "late_overtime") && isUnapplied) bg = "#eff6ff"; // Light blue for overtime unapplied
                    else if (shiftCheck === "ok" && isUnapplied) bg = "#f0fdf4"; // Light green for auto-approvable
                    else if (isUnapplied) bg = "#fef2f2"; // Red (Unapplied)
                    else if (isWorking) bg = "#ffffff"; // White (Working)

                    return (
                      <tr key={item.userId + item.workDate} style={{ background: bg, borderBottom: "1px solid #f3f4f6" }}>
                        <td style={{ fontSize: "13px", color: "#374151", padding: "10px 8px" }}>
                          {format(new Date(item.workDate), "MM/dd(E)", { locale: ja })}
                        </td>
                        <td style={{ fontWeight: "bold", fontSize: "14px", padding: "10px 8px" }}>
                          {item.userName}
                          <div style={{ fontSize: "10px", color: "#aaa" }}>{item.employmentType || ""}</div>
                        </td>
                        <td style={{ padding: "10px 8px", fontSize: "13px" }}>
                          {shift ? (
                            shift.isOff ? (
                              <span style={{ color: "#ef4444", fontWeight: "bold" }}>休み</span>
                            ) : (shift.dispatchRange || shift.partTimeRange) ? (
                              <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
                                {shift.dispatchRange && (
                                  <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                                    <span style={{ padding: "0px 4px", borderRadius: "3px", fontSize: "9px", fontWeight: "bold", background: "#dbeafe", color: "#1d4ed8" }}>派遣</span>
                                    <span style={{ color: "#1d4ed8", fontFamily: "monospace", fontSize: "12px" }}>{shift.dispatchRange.start}-{shift.dispatchRange.end}</span>
                                  </div>
                                )}
                                {shift.partTimeRange && (
                                  <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                                    <span style={{ padding: "0px 4px", borderRadius: "3px", fontSize: "9px", fontWeight: "bold", background: "#dcfce7", color: "#15803d" }}>バイト</span>
                                    <span style={{ color: "#15803d", fontFamily: "monospace", fontSize: "12px" }}>{shift.partTimeRange.start}-{shift.partTimeRange.end}</span>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span style={{ color: "#2563eb", fontFamily: "monospace" }}>{shift.start}-{shift.end}</span>
                            )
                          ) : (
                            <span style={{ color: "#9ca3af" }}>-</span>
                          )}
                        </td>
                        <td style={{ padding: "10px 8px", fontSize: "13px" }}>
                          {item.clockIn ? (
                            <span style={{ fontFamily: "monospace" }}>
                              {item.clockIn.slice(0, 5)}-{item.clockOut ? item.clockOut.slice(0, 5) : "..."}
                            </span>
                          ) : (
                            <span style={{ color: "#9ca3af" }}>-</span>
                          )}
                        </td>
                        <td style={{ padding: "10px 8px", fontSize: "13px" }}>
                          {(() => {
                            const app = item._application;
                            if (app?.appliedIn && app?.appliedOut) {
                              const breakDur = app.breakDuration || 0;
                              const adminEdited = app?.adminEdited;
                              return (
                                <>
                                  <span style={{ fontFamily: "monospace", color: "#2563eb" }}>
                                    {app.appliedIn.slice(0, 5)}-{app.appliedOut.slice(0, 5)}
                                  </span>
                                  {breakDur > 0 && (
                                    <div style={{ fontSize: "10px", color: "#9ca3af" }}>
                                      休憩{breakDur >= 60 ? `${Math.floor(breakDur / 60)}h` : ''}{breakDur % 60 > 0 ? `${breakDur % 60}m` : ''}
                                    </div>
                                  )}
                                  {adminEdited && (
                                    <div style={{ fontSize: "9px", color: "#f59e0b", fontWeight: "bold" }}>✏️ 管理者編集</div>
                                  )}
                                </>
                              );
                            }
                            return <span style={{ color: "#9ca3af" }}>-</span>;
                          })()}
                        </td>
                        <td style={{ padding: "10px 8px" }}>
                          {isShiftOnly && <span className="status-badge" style={{ background: "#fee2e2", color: "#991b1b", border: "1px solid #fca5a5", fontSize: "11px", fontWeight: "bold" }}>未出勤</span>}
                          {!isShiftOnly && isWorking && <span className="status-badge green" style={{ background: "#dcfce7", color: "#166534", border: "1px solid #bbf7d0", fontSize: "11px" }}>出勤中</span>}
                          {!isShiftOnly && isIncomplete && <span className="status-badge red" style={{ fontSize: "11px" }}>未退勤</span>}
                          {!isShiftOnly && rowAppStatus === "pending" && <span className="status-badge orange" style={{ fontSize: "11px" }}>承認待</span>}
                          {!isShiftOnly && rowAppStatus === "approved" && <span className="status-badge" style={{ background: "#059669", color: "#fff", fontSize: "11px", fontWeight: "bold", padding: "3px 8px" }}>✅ 承認済{item._application?.adminEdited && <span style={{ fontSize: "9px", opacity: 0.8 }}> (管理者)</span>}</span>}
                          {!isShiftOnly && rowAppStatus === "resubmission_requested" && <span className="status-badge purple" style={{ fontSize: "11px" }}>再提出</span>}
                          {!isShiftOnly && isUnapplied && !isWorking && !isIncomplete && <span className="status-badge orange" style={{ fontSize: "11px" }}>承認待</span>}
                        </td>
                        <td style={{ padding: "10px 8px", fontSize: "14px", fontFamily: "monospace", fontWeight: "bold" }}>
                          {(() => {
                            // 申請時間がある場合はそちらを使用、なければ打刻時間
                            const app = item._application || {};
                            const effectiveIn = app.appliedIn || item.clockIn;
                            const effectiveOut = app.appliedOut || item.clockOut;

                            if (!effectiveIn || !effectiveOut) return "-";

                            const effInMin = toMin(effectiveIn);
                            const effOutMin = toMin(effectiveOut);
                            const totalDuration = Math.max(0, effOutMin - effInMin);

                            // 申請に休憩時間がある場合はそれを差し引く
                            const breakDuration = app.breakDuration || 0;
                            const netDuration = Math.max(0, totalDuration - breakDuration);

                            // 30分単位に丸める
                            let min = Math.floor(netDuration / 30) * 30;
                            if (min <= 0) return "-";

                            // 遅刻ペナルティ判定: 遅刻時は30分削り（遅刻取消済みの場合は除外）
                            const lateCancelled = item._application?.lateCancelled;
                            const isLateForPenalty = (shiftCheck === "late" || shiftCheck === "both" || shiftCheck === "late_overtime") && !lateCancelled;

                            // 派遣ユーザーの場合は派遣/バイト分離表示
                            const isDispatch = shift?.isDispatch || shift?.location === "派遣" || ["朝", "早", "遅", "中"].includes(shift?.type || "");
                            if (isDispatch && shift && effectiveIn && effectiveOut) {
                              // dispatchRangeがあればそれを使用（派遣は固定契約のためフルレンジ）
                              let dMin = 0;
                              if (shift.dispatchRange) {
                                const dispStart = toMin(shift.dispatchRange.start);
                                const dispEnd = toMin(shift.dispatchRange.end);
                                dMin = dispEnd - dispStart;
                              } else {
                                // フォールバック: 最大8時間
                                dMin = Math.min(min, 8 * 60);
                              }
                              let pMin = Math.max(0, min - dMin);
                              // 派遣の遅刻ペナルティ: バイト分から30分削り
                              if (isLateForPenalty) {
                                pMin = Math.max(0, pMin - 30);
                              }
                              const dH = Math.floor(dMin / 60);
                              const dM = (dMin % 60) >= 30 ? 5 : 0;
                              const pH = Math.floor(pMin / 60);
                              const pM = (pMin % 60) >= 30 ? 5 : 0;

                              // シフトコード判定（朝/早/中/遅/深）
                              const SHIFT_CODE_MAP = {
                                "07:00": "朝", "09:00": "早", "10:00": "中",
                                "12:00": "遅", "13:00": "遅", "17:00": "深"
                              };
                              const codeColors = {
                                "朝": "#d97706", "早": "#059669", "中": "#2563eb",
                                "遅": "#db2777", "深": "#6d28d9", "派遣": "#2563eb"
                              };
                              const dispatchStartTime = shift.dispatchRange?.start || shift.start;
                              const shiftCodeLabel = SHIFT_CODE_MAP[dispatchStartTime] || "派遣";
                              const dispatchColor = codeColors[shiftCodeLabel] || "#2563eb";

                              return (
                                <div style={{ fontSize: "12px", lineHeight: "1.3" }}>
                                  {dMin > 0 ? (
                                    <div style={{ color: dispatchColor }}>{shiftCodeLabel}{dH}.{dM}H</div>
                                  ) : (
                                    <div style={{ color: "#9ca3af", fontSize: "11px" }}>派遣なし</div>
                                  )}
                                  {pMin > 0 ? (
                                    <div style={{ color: "#16a34a" }}>バイト{pH}.{pM}H</div>
                                  ) : (
                                    <div style={{ color: "#9ca3af", fontSize: "11px" }}>バイトなし</div>
                                  )}
                                </div>
                              );
                            }

                            // 非派遣の遅刻ペナルティ: minから30分削り
                            if (isLateForPenalty) {
                              min = Math.max(0, min - 30);
                              if (min <= 0) return "-";
                            }
                            const h = Math.floor(min / 60);
                            const m = (min % 60) === 30 ? 5 : 0;
                            return `${h}.${m}H`;
                          })()}
                        </td>
                        <td style={{ padding: "10px 8px" }}>
                          {(() => {
                            const lateCancelled = item._application?.lateCancelled;
                            const earlyCancelled = item._application?.earlyCancelled;

                            if (shiftCheck === "ok") {
                              return (
                                <span style={{ color: "#16a34a", fontWeight: "bold", fontSize: "12px", display: "flex", alignItems: "center", gap: "4px" }}>
                                  <CheckCircle size={14} /> 問題なし
                                </span>
                              );
                            }
                            if (shiftCheck === "late") {
                              if (lateCancelled) {
                                const reason = item._application?.lateCancelReason;
                                return <span style={{ color: "#6b7280", fontSize: "11px" }} title={reason ? `理由: ${reason}` : ""}>遅刻取消済{reason ? ` (${reason})` : ""}</span>;
                              }
                              return (
                                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                                  <span style={{ color: "#f59e0b", fontWeight: "bold", fontSize: "12px" }}>⚠️ 遅刻</span>
                                  <button
                                    onClick={() => openCancelModal(item, "late")}
                                    style={{ fontSize: "10px", padding: "2px 6px", background: "#f3f4f6", border: "1px solid #d1d5db", borderRadius: "4px", cursor: "pointer" }}
                                  >取消</button>
                                </div>
                              );
                            }
                            if (shiftCheck === "early") {
                              if (earlyCancelled) {
                                const reason = item._application?.earlyCancelReason;
                                return <span style={{ color: "#6b7280", fontSize: "11px" }} title={reason ? `理由: ${reason}` : ""}>早退取消済{reason ? ` (${reason})` : ""}</span>;
                              }
                              return (
                                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                                  <span style={{ color: "#f59e0b", fontWeight: "bold", fontSize: "12px" }}>⚠️ 早退</span>
                                  <button
                                    onClick={() => openCancelModal(item, "early")}
                                    style={{ fontSize: "10px", padding: "2px 6px", background: "#f3f4f6", border: "1px solid #d1d5db", borderRadius: "4px", cursor: "pointer" }}
                                  >取消</button>
                                </div>
                              );
                            }
                            if (shiftCheck === "both") {
                              if (lateCancelled && earlyCancelled) {
                                const lReason = item._application?.lateCancelReason;
                                const eReason = item._application?.earlyCancelReason;
                                const reasons = [lReason, eReason].filter(Boolean).join(" / ");
                                return <span style={{ color: "#6b7280", fontSize: "11px" }} title={reasons ? `理由: ${reasons}` : ""}>遅刻+早退取消済{reasons ? ` (${reasons})` : ""}</span>;
                              }
                              return (
                                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                                  <span style={{ color: "#ef4444", fontWeight: "bold", fontSize: "12px" }}>⚠️ 遅刻+早退</span>
                                  <button
                                    onClick={() => openCancelModal(item, "both")}
                                    style={{ fontSize: "10px", padding: "2px 6px", background: "#f3f4f6", border: "1px solid #d1d5db", borderRadius: "4px", cursor: "pointer" }}
                                  >取消</button>
                                </div>
                              );
                            }
                            if (shiftCheck === "overtime") {
                              return (
                                <span style={{ color: "#2563eb", fontWeight: "bold", fontSize: "12px", display: "flex", alignItems: "center", gap: "4px" }}>
                                  🕐 残業
                                </span>
                              );
                            }
                            if (shiftCheck === "late_overtime") {
                              if (lateCancelled) {
                                return (
                                  <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                                    <span style={{ color: "#6b7280", fontSize: "11px" }}>遅刻取消済</span>
                                    <span style={{ color: "#2563eb", fontWeight: "bold", fontSize: "12px" }}>🕐 残業</span>
                                  </div>
                                );
                              }
                              return (
                                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                                  <span style={{ color: "#f59e0b", fontWeight: "bold", fontSize: "12px" }}>⚠️ 遅刻+残業</span>
                                  <button
                                    onClick={() => openCancelModal(item, "late")}
                                    style={{ fontSize: "10px", padding: "2px 6px", background: "#f3f4f6", border: "1px solid #d1d5db", borderRadius: "4px", cursor: "pointer" }}
                                  >遅刻取消</button>
                                </div>
                              );
                            }
                            if (!shiftCheck && item.clockIn && item.clockOut && !shift) {
                              return <span style={{ color: "#9ca3af", fontSize: "11px" }}>シフト未登録</span>;
                            }
                            return null;
                          })()}
                        </td>
                        <td style={{ padding: "10px 8px", fontSize: "12px", color: "#374151", maxWidth: "160px" }}>
                          {(() => {
                            const appReason = item._application?.reason;
                            if (!appReason || appReason === "-") {
                              return <span style={{ color: "#d1d5db" }}>-</span>;
                            }
                            // 大枠のみ（括弧部分を除去）
                            let mainReason = appReason;
                            const parenIdx = appReason.indexOf('（');
                            if (parenIdx > 0) mainReason = appReason.substring(0, parenIdx);
                            const parenIdx2 = appReason.indexOf('(');
                            if (parenIdx2 > 0 && parenIdx <= 0) mainReason = appReason.substring(0, parenIdx2).trim();

                            // 詳細を取得
                            const parts = [];
                            const subR = item._application?.subReason;
                            if (subR && subR !== '-') {
                              if (subR === 'その他' && item._application?.subReasonText) {
                                parts.push(item._application.subReasonText);
                              } else {
                                parts.push(subR);
                              }
                            }
                            // 既存データ: reasonに括弧が含まれている場合
                            if (parts.length === 0) {
                              const match = appReason.match(/[（(](.+?)[）)]/);
                              if (match) parts.push(match[1]);
                            }
                            // textフィールド
                            const comment = item._parsedHtmlComment;
                            if (comment && comment.trim() && !parts.includes(comment.trim())) {
                              parts.push(comment.trim());
                            }
                            const detail = parts.join(' / ');

                            const itemKey = `${item.userId}-${item.workDate}`;
                            const isExpanded = expandedReasonId === itemKey;
                            return (
                              <div
                                style={{ display: "flex", alignItems: "flex-start", gap: "6px", lineHeight: "1.3", cursor: detail ? "pointer" : "default" }}
                                onClick={() => detail && setExpandedReasonId(isExpanded ? null : itemKey)}
                              >
                                <span style={{ fontWeight: "bold", color: "#ef4444", flexShrink: 0 }}>{mainReason}</span>
                                {detail && (
                                  <span style={{
                                    color: "#6b7280", fontSize: "11px",
                                    ...(isExpanded
                                      ? { whiteSpace: "pre-wrap", wordBreak: "break-word" }
                                      : { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100px" })
                                  }}>
                                    {detail}
                                  </span>
                                )}
                              </div>
                            );
                          })()}
                        </td>
                        <td style={{ fontSize: "13px", padding: "10px 8px" }}>
                          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                            {/* 承認済み → 承認取消のみ */}
                            {rowAppStatus === "approved" && (
                              <button
                                className="btn"
                                onClick={async () => {
                                  if (!await showConfirm(`${item.userName}さんの承認を取り消しますか？`)) return;
                                  try {
                                    const p = parseComment(item.comment);
                                    const app = p.application || {};
                                    const newApp = { ...app, status: "pending", approvedAt: null };
                                    const finalComment = JSON.stringify({ segments: p.segments, text: p.text, application: newApp });
                                    await fetch(`${API_BASE}/attendance/update`, {
                                      method: "POST",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ userId: item.userId, workDate: item.workDate, comment: finalComment })
                                    });
                                    fetchAttendances();
                                  } catch (e) { console.error(e); alert("承認取消に失敗しました"); }
                                }}
                                style={{
                                  fontSize: "11px", padding: "4px 10px",
                                  background: "#fee2e2", color: "#991b1b", border: "1px solid #fca5a5", borderRadius: "4px",
                                  cursor: "pointer", fontWeight: "bold", display: "flex", alignItems: "center", gap: "4px"
                                }}
                              >
                                <XCircle size={12} /> 承認取消
                              </button>
                            )}

                            {/* 未承認（clockInあり）→ 承認 + 修正 + 再提出 */}
                            {!isShiftOnly && rowAppStatus !== "approved" && (
                              <>
                                <button
                                  className="btn"
                                  onClick={() => handleApprove(item)}
                                  style={{
                                    fontSize: "11px", padding: "4px 10px",
                                    background: "#10b981", color: "#fff", border: "none", borderRadius: "4px",
                                    cursor: "pointer", fontWeight: "bold", display: "flex", alignItems: "center", gap: "4px"
                                  }}
                                >
                                  <CheckCircle size={12} /> 承認
                                </button>
                                <button
                                  className="btn"
                                  onClick={() => openEdit(item)}
                                  style={{
                                    fontSize: "11px", padding: "4px 10px",
                                    background: "#3b82f6", color: "#fff", border: "none", borderRadius: "4px",
                                    cursor: "pointer", fontWeight: "bold"
                                  }}
                                >
                                  修正
                                </button>
                                {rowAppStatus !== "resubmission_requested" && (
                                  <button
                                    className="btn"
                                    onClick={() => { setResubmitTarget(item); setSelectedResubmitReason(""); setCustomResubmitReason(""); }}
                                    style={{
                                      fontSize: "11px", padding: "4px 10px",
                                      background: "#f59e0b", color: "#fff", border: "none", borderRadius: "4px",
                                      cursor: "pointer", fontWeight: "bold"
                                    }}
                                  >
                                    再提出
                                  </button>
                                )}
                              </>
                            )}

                            {/* 未出勤 → 修正 + 欠勤登録 */}
                            {isShiftOnly && (
                              <>
                                <button
                                  className="btn"
                                  onClick={() => openEdit(item)}
                                  style={{
                                    fontSize: "11px", padding: "4px 10px",
                                    background: "#3b82f6", color: "#fff", border: "none", borderRadius: "4px",
                                    cursor: "pointer", fontWeight: "bold"
                                  }}
                                >
                                  修正
                                </button>
                                <button
                                  className="btn"
                                  onClick={() => handleMarkAbsent(item.userId, item.userName, item.workDate)}
                                  style={{
                                    fontSize: "11px", padding: "4px 10px",
                                    background: "#6b7280", color: "#fff", border: "none", borderRadius: "4px",
                                    cursor: "pointer", fontWeight: "bold"
                                  }}
                                >
                                  欠勤登録
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {
        editingItem && (
          <div className="modal-overlay">
            <div className="modal-content" style={{ maxWidth: "700px", position: "relative" }}>
              {/* 閉じるボタン（右上×） */}
              <button
                onClick={() => setEditingItem(null)}
                style={{
                  position: "absolute", top: "12px", right: "12px",
                  background: "none", border: "none", cursor: "pointer",
                  fontSize: "24px", color: "#dc2626", lineHeight: 1,
                  padding: "4px 8px", borderRadius: "6px", fontWeight: "bold"
                }}
                onMouseOver={e => e.currentTarget.style.background = '#fee2e2'}
                onMouseOut={e => e.currentTarget.style.background = 'none'}
              >×</button>
              <h3>申請内容の確認・操作</h3>

              <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "8px", overflow: "hidden", marginBottom: "20px" }}>
                <div style={{ padding: "12px 16px", background: "#f9fafb", borderBottom: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: "bold", fontSize: "16px" }}>{editingItem.userName}</span>
                  <span style={{ fontSize: "14px", color: "#6b7280" }}>{editingItem.workDate}</span>
                </div>

                <div style={{ padding: "16px" }}>
                  {/* Comparison Grid */}
                  <div style={{ display: "grid", gridTemplateColumns: "100px 1fr 1fr", gap: "12px", alignItems: "center", marginBottom: "16px" }}>
                    <div style={{ fontSize: "12px", color: "#6b7280", fontWeight: "bold" }}></div>
                    <div style={{ fontSize: "12px", color: "#6b7280", fontWeight: "bold", textAlign: "center" }}>打刻時間</div>
                    <div style={{ fontSize: "12px", color: "#6b7280", fontWeight: "bold", textAlign: "center" }}>実働時間(30分単位)</div>

                    {/* Shift Row */}
                    <div style={{ fontWeight: "bold", fontSize: "14px", color: "#059669" }}>シフト予定</div>
                    <div style={{ fontFamily: "monospace", textAlign: "center", fontSize: "15px", color: "#059669" }}>
                      {(() => {
                        const s = findShiftForItem(editingItem);
                        if (!s) return <span style={{ color: "#9ca3af" }}>未登録</span>;
                        if (s.isOff) return "休み";
                        return `${s.start} - ${s.end}`;
                      })()}
                    </div>
                    <div style={{ textAlign: "center", fontSize: "12px", color: "#6b7280" }}>
                      {(() => {
                        const s = findShiftForItem(editingItem);
                        return s ? s.location : "-";
                      })()}
                    </div>

                    {/* Actual Row */}
                    <div style={{ fontWeight: "bold", fontSize: "14px", color: "#374151" }}>実績</div>
                    <div style={{ fontFamily: "monospace", textAlign: "center", fontSize: "15px" }}>
                      {(() => {
                        const s = findShiftForItem(editingItem);
                        return calcSplitDisplay(editingItem, s);
                      })()}
                    </div>
                    <div style={{ fontFamily: "monospace", textAlign: "center", fontSize: "15px", fontWeight: "bold" }}>
                      {(() => {
                        const min = calcRoundedWorkMin(editingItem);
                        const h = Math.floor(min / 60);
                        const m = (min % 60) === 30 ? 5 : 0;
                        return `${h}.${m}H`;
                      })()}
                    </div>

                    {/* Applied Row */}
                    <div style={{ fontWeight: "bold", fontSize: "14px", color: "#2563eb" }}>申請</div>
                    <div style={{ fontFamily: "monospace", textAlign: "center", fontSize: "15px", color: "#2563eb" }}>
                      {editingItem._application?.appliedIn || "-"} ~ {editingItem._application?.appliedOut || "-"}
                    </div>
                    <div style={{ fontFamily: "monospace", textAlign: "center", fontSize: "15px", fontWeight: "bold", color: "#2563eb" }}>
                      {(() => {
                        const app = editingItem._application;
                        if (!app?.appliedIn || !app?.appliedOut) return "-";
                        const dummy = { ...editingItem, clockIn: app.appliedIn, clockOut: app.appliedOut };
                        const min = calcRoundedWorkMin(dummy);
                        const h = Math.floor(min / 60);
                        const m = (min % 60) === 30 ? 5 : 0;
                        return `${h}.${m}H`;
                      })()}
                    </div>
                  </div>

                  <div style={{ background: "#f3f4f6", padding: "10px", borderRadius: "6px" }}>
                    <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "4px" }}>申請理由</div>
                    <div style={{ fontWeight: "bold", color: "#ef4444" }}>{editingItem._application?.reason || "なし"}</div>
                  </div>
                </div>
              </div>

              {editingItem._application?.status === "pending" && (
                <div style={{ marginBottom: "24px", textAlign: "center" }}>
                  <p style={{ fontSize: "13px", color: "#6b7280", marginBottom: "8px" }}>
                    内容に問題がなければ承認してください。<br />
                    相違がある場合は、下のフォームから再提出を依頼してください。
                  </p>
                  <button className="btn btn-green" onClick={() => handleApprove(null)} style={{ width: "100%", padding: "12px", fontSize: "16px" }}>
                    <CheckCircle size={20} style={{ marginRight: 6 }} /> 承認する
                  </button>
                </div>
              )}

              {editingItem._application?.status === "absent" && (
                <div style={{ marginBottom: "24px", textAlign: "center" }}>
                  <p style={{ fontSize: "13px", color: "#6b7280", marginBottom: "8px" }}>
                    現在は「欠勤」として登録されています。
                  </p>
                  <button className="btn" onClick={() => handleCancelAbsent(editingItem)} style={{ width: "100%", padding: "12px", fontSize: "16px", background: "#6b7280", color: "#fff", border: "none", borderRadius: "8px" }}>
                    欠勤を取り消す
                  </button>
                </div>
              )}

              {/* 管理者による申請時間の編集 */}
              <div style={{ marginBottom: "20px", padding: "20px", background: "#fff", border: "1px solid #3b82f6", borderRadius: "8px" }}>
                <h4 style={{ margin: "0 0 12px 0", fontSize: "1rem", color: "#1d4ed8", display: "flex", alignItems: "center", gap: "6px" }}>
                  ✏️ 申請時間の編集 (管理者)
                </h4>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", marginBottom: "12px" }}>
                  <div>
                    <label style={{ fontSize: "12px", color: "#6b7280", display: "block", marginBottom: "4px" }}>出勤時間</label>
                    <select
                      id="adminEditIn"
                      defaultValue={editingItem._application?.appliedIn || editingItem.clockIn || ""}
                      className="input"
                      style={{ width: "100%", padding: "8px", border: "1px solid #d1d5db", borderRadius: "6px" }}
                    >
                      <option value="">--</option>
                      {Array.from({ length: 48 }, (_, i) => {
                        const h = String(Math.floor(i / 2)).padStart(2, "0");
                        const m = i % 2 === 0 ? "00" : "30";
                        return <option key={i} value={`${h}:${m}`}>{`${h}:${m}`}</option>;
                      })}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: "12px", color: "#6b7280", display: "block", marginBottom: "4px" }}>退勤時間</label>
                    <select
                      id="adminEditOut"
                      defaultValue={editingItem._application?.appliedOut || editingItem.clockOut || ""}
                      className="input"
                      style={{ width: "100%", padding: "8px", border: "1px solid #d1d5db", borderRadius: "6px" }}
                    >
                      <option value="">--</option>
                      {Array.from({ length: 48 }, (_, i) => {
                        const h = String(Math.floor(i / 2)).padStart(2, "0");
                        const m = i % 2 === 0 ? "00" : "30";
                        return <option key={i} value={`${h}:${m}`}>{`${h}:${m}`}</option>;
                      })}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: "12px", color: "#6b7280", display: "block", marginBottom: "4px" }}>休憩(分)</label>
                    <select
                      id="adminEditBreak"
                      defaultValue={editingItem._application?.breakDuration || 0}
                      className="input"
                      style={{ width: "100%", padding: "8px", border: "1px solid #d1d5db", borderRadius: "6px" }}
                    >
                      {[0, 30, 60, 90, 120].map(v => <option key={v} value={v}>{v}分</option>)}
                    </select>
                  </div>
                </div>
                <button
                  className="btn"
                  onClick={async () => {
                    const newIn = document.getElementById("adminEditIn").value;
                    const newOut = document.getElementById("adminEditOut").value;
                    const newBreak = parseInt(document.getElementById("adminEditBreak").value) || 0;
                    if (!newIn || !newOut) { alert("出勤・退勤時間を入力してください"); return; }

                    // 遅刻・残業の自動判定
                    const lookupDate = editingItem.displayDate || editingItem.workDate;
                    const shift = getShift(editingItem.userName, lookupDate);
                    let autoReason = null;
                    if (shift && shift.start && shift.end) {
                      const shiftStartMin = toMin(shift.start);
                      const shiftEndMin = toMin(shift.end);
                      const editInMin = toMin(newIn);
                      const editOutMin = toMin(newOut);
                      const isLate = editInMin >= shiftStartMin;
                      const isOvertime = editOutMin >= shiftEndMin + 30;
                      const isEarly = editOutMin < shiftEndMin;
                      if (isLate && isOvertime) autoReason = "遅刻・残業";
                      else if (isLate) autoReason = "遅刻";
                      else if (isOvertime) autoReason = "残業";
                      else if (isEarly) autoReason = "早退";
                    }

                    const confirmMsg = `申請時間を管理者が編集します。\n出勤: ${newIn}\n退勤: ${newOut}\n休憩: ${newBreak}分${autoReason ? `\n\n⚠️ 判定: ${autoReason}` : "\n\n✅ 判定: 問題なし"}\n\nよろしいですか？`;
                    if (!await showConfirm(confirmMsg)) return;
                    setLoading(true);
                    try {
                      const p = parseComment(editingItem.comment);
                      const existingApp = p.application || {};
                      const newApp = {
                        ...existingApp,
                        appliedIn: newIn,
                        appliedOut: newOut,
                        breakDuration: newBreak,
                        adminEdited: true,
                        adminEditedAt: new Date().toISOString(),
                        status: existingApp.status || "pending",
                        reason: autoReason || existingApp.reason || "-",
                        appliedAt: existingApp.appliedAt || new Date().toISOString()
                      };
                      const finalComment = JSON.stringify({ segments: p.segments, text: p.text, application: newApp });
                      await fetch(`${API_BASE}/attendance/update`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          userId: editingItem.userId,
                          workDate: editingItem.workDate,
                          clockIn: editingItem.clockIn,
                          clockOut: editingItem.clockOut,
                          breaks: editingItem.breaks || [],
                          comment: finalComment
                        })
                      });
                      setEditingItem(null);
                      fetchAttendances();
                    } catch (e) { console.error(e); alert("保存に失敗しました"); }
                    finally { setLoading(false); }
                  }}
                  style={{
                    width: "100%", padding: "10px", fontSize: "0.95rem", fontWeight: "bold",
                    background: "#3b82f6", color: "#fff", border: "none", borderRadius: "6px",
                    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px"
                  }}
                >
                  <Save size={16} /> 申請時間を保存
                </button>
              </div>

              <div style={{ marginTop: "20px", padding: "20px", background: "#fff", border: "1px solid #e5e7eb", borderRadius: "8px" }}>
                <h4 style={{ margin: "0 0 8px 0", fontSize: "1rem", color: "#374151" }}>再提出依頼 (修正願い)</h4>
                <p style={{ fontSize: "0.85rem", color: "#374151", marginBottom: "12px" }}>
                  承認できない場合は、理由を入力して再提出を依頼してください。
                </p>
                <textarea
                  className="input"
                  placeholder="例: 退勤時間の入力が間違っているようです"
                  value={resubmitReason}
                  onChange={e => setResubmitReason(e.target.value)}
                  style={{ width: "100%", height: "80px", marginBottom: "12px", background: "#fff", border: "1px solid #d1d5db", borderRadius: "6px", padding: "10px", fontSize: "0.9rem" }}
                />
                <button className="btn btn-outline" onClick={handleRequestResubmission} style={{ width: "100%", color: "#7c3aed", borderColor: "#7c3aed", padding: "10px", fontSize: "0.95rem", fontWeight: "bold" }}>
                  <Send size={18} style={{ marginRight: 6 }} /> 再提出を依頼する
                </button>
              </div>

              <button
                onClick={() => setEditingItem(null)}
                style={{
                  width: "100%", marginTop: "16px", padding: "12px",
                  background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: "8px",
                  cursor: "pointer", fontSize: "1rem", fontWeight: "bold", color: "#dc2626"
                }}
              >
                閉じる
              </button>
            </div>
          </div>
        )
      }

      {/* 確認モーダル */}
      {confirmModal.isOpen && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(0,0,0,0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 10000
        }}>
          <div style={{
            background: "#fff",
            borderRadius: "12px",
            padding: "24px",
            maxWidth: "400px",
            width: "90%",
            boxShadow: "0 4px 20px rgba(0,0,0,0.2)"
          }}>
            <h3 style={{ marginBottom: "16px", fontSize: "1.1rem" }}>確認</h3>
            <p style={{ marginBottom: "24px", whiteSpace: "pre-wrap", color: "#374151" }}>
              {confirmModal.message}
            </p>
            <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
              <button
                onClick={confirmModal.onCancel}
                style={{
                  padding: "10px 20px",
                  borderRadius: "8px",
                  border: "1px solid #d1d5db",
                  background: "#fff",
                  cursor: "pointer",
                  fontSize: "0.95rem"
                }}
              >
                キャンセル
              </button>
              <button
                onClick={confirmModal.onConfirm}
                style={{
                  padding: "10px 20px",
                  borderRadius: "8px",
                  border: "none",
                  background: "#2563eb",
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: "0.95rem"
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 再提出理由選択モーダル */}
      {resubmitTarget && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0,0,0,0.5)", zIndex: 9999,
          display: "flex", alignItems: "center", justifyContent: "center"
        }}>
          <div style={{
            background: "#fff", borderRadius: "12px", padding: "24px",
            maxWidth: "420px", width: "90%", boxShadow: "0 8px 32px rgba(0,0,0,0.2)"
          }}>
            <h3 style={{ margin: "0 0 8px", fontSize: "16px" }}>再提出依頼</h3>
            <div style={{ fontSize: "13px", color: "#6b7280", marginBottom: "16px" }}>
              {resubmitTarget.userName} ({format(new Date(resubmitTarget.workDate), "MM/dd")}) への再提出理由を選択してください
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "16px" }}>
              {RESUBMIT_REASONS.map(r => (
                <button
                  key={r}
                  onClick={() => { setSelectedResubmitReason(r); setCustomResubmitReason(""); }}
                  style={{
                    padding: "10px 14px", borderRadius: "8px", cursor: "pointer",
                    border: selectedResubmitReason === r ? "2px solid #f59e0b" : "1px solid #d1d5db",
                    background: selectedResubmitReason === r ? "#fffbeb" : "#fff",
                    fontWeight: selectedResubmitReason === r ? "bold" : "normal",
                    fontSize: "14px", textAlign: "left"
                  }}
                >
                  {r}
                </button>
              ))}
              <button
                onClick={() => { setSelectedResubmitReason("その他"); }}
                style={{
                  padding: "10px 14px", borderRadius: "8px", cursor: "pointer",
                  border: selectedResubmitReason === "その他" ? "2px solid #f59e0b" : "1px solid #d1d5db",
                  background: selectedResubmitReason === "その他" ? "#fffbeb" : "#fff",
                  fontWeight: selectedResubmitReason === "その他" ? "bold" : "normal",
                  fontSize: "14px", textAlign: "left"
                }}
              >
                その他
              </button>
            </div>

            {selectedResubmitReason === "その他" && (
              <textarea
                value={customResubmitReason}
                onChange={e => setCustomResubmitReason(e.target.value)}
                placeholder="理由を入力してください"
                style={{
                  width: "100%", padding: "8px", borderRadius: "6px",
                  border: "1px solid #d1d5db", fontSize: "14px",
                  marginBottom: "16px", minHeight: "60px", resize: "vertical",
                  boxSizing: "border-box"
                }}
              />
            )}

            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button
                onClick={() => setResubmitTarget(null)}
                style={{
                  padding: "8px 16px", borderRadius: "8px",
                  border: "1px solid #d1d5db", background: "#fff",
                  cursor: "pointer", fontSize: "14px"
                }}
              >
                キャンセル
              </button>
              <button
                disabled={!selectedResubmitReason || (selectedResubmitReason === "その他" && !customResubmitReason.trim())}
                onClick={async () => {
                  const finalReason = selectedResubmitReason === "その他" ? customResubmitReason.trim() : selectedResubmitReason;
                  setLoading(true);
                  try {
                    const p = parseComment(resubmitTarget.comment);
                    const app = p.application || {};
                    const newApp = {
                      ...app,
                      status: "resubmission_requested",
                      reason: app.reason,
                      adminComment: finalReason
                    };
                    const finalComment = JSON.stringify({
                      segments: p.segments,
                      text: (p.text || "") + `\n[再提出依頼]: ${finalReason}`,
                      application: newApp
                    });
                    await fetch(`${API_BASE}/attendance/update`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        userId: resubmitTarget.userId,
                        workDate: resubmitTarget.workDate,
                        clockIn: resubmitTarget.clockIn,
                        clockOut: resubmitTarget.clockOut,
                        breaks: resubmitTarget.breaks || [],
                        comment: finalComment
                      }),
                    });
                    setResubmitTarget(null);
                    fetchAttendances();
                  } catch (e) {
                    alert("エラーが発生しました");
                  } finally {
                    setLoading(false);
                  }
                }}
                style={{
                  padding: "8px 16px", borderRadius: "8px",
                  border: "none", background: (!selectedResubmitReason || (selectedResubmitReason === "その他" && !customResubmitReason.trim())) ? "#d1d5db" : "#f59e0b",
                  color: "#fff", cursor: "pointer", fontSize: "14px", fontWeight: "bold"
                }}
              >
                再提出を依頼
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 取消理由選択モーダル */}
      {cancelTarget && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0,0,0,0.5)", zIndex: 9999,
          display: "flex", alignItems: "center", justifyContent: "center"
        }}>
          <div style={{
            background: "#fff", borderRadius: "12px", padding: "24px",
            maxWidth: "420px", width: "90%", boxShadow: "0 8px 32px rgba(0,0,0,0.2)"
          }}>
            <h3 style={{ margin: "0 0 8px", fontSize: "16px" }}>
              {cancelTarget.type === "late" ? "遅刻" : cancelTarget.type === "early" ? "早退" : "遅刻+早退"}取消
            </h3>
            <div style={{ fontSize: "13px", color: "#6b7280", marginBottom: "16px" }}>
              取消理由を選択してください
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "16px" }}>
              {CANCEL_REASONS.map(r => (
                <button
                  key={r}
                  onClick={() => { setSelectedCancelReason(r); setCustomCancelReason(""); }}
                  style={{
                    padding: "10px 14px", borderRadius: "8px", cursor: "pointer",
                    border: selectedCancelReason === r ? "2px solid #6b7280" : "1px solid #d1d5db",
                    background: selectedCancelReason === r ? "#f3f4f6" : "#fff",
                    fontWeight: selectedCancelReason === r ? "bold" : "normal",
                    fontSize: "14px", textAlign: "left"
                  }}
                >
                  {r}
                </button>
              ))}
              <button
                onClick={() => { setSelectedCancelReason("その他"); }}
                style={{
                  padding: "10px 14px", borderRadius: "8px", cursor: "pointer",
                  border: selectedCancelReason === "その他" ? "2px solid #6b7280" : "1px solid #d1d5db",
                  background: selectedCancelReason === "その他" ? "#f3f4f6" : "#fff",
                  fontWeight: selectedCancelReason === "その他" ? "bold" : "normal",
                  fontSize: "14px", textAlign: "left"
                }}
              >
                その他（記述式）
              </button>
            </div>

            {selectedCancelReason === "その他" && (
              <textarea
                value={customCancelReason}
                onChange={e => setCustomCancelReason(e.target.value)}
                placeholder="理由を入力してください"
                style={{
                  width: "100%", padding: "8px", borderRadius: "6px",
                  border: "1px solid #d1d5db", fontSize: "14px",
                  marginBottom: "16px", minHeight: "60px", resize: "vertical",
                  boxSizing: "border-box"
                }}
              />
            )}

            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button
                onClick={() => setCancelTarget(null)}
                style={{
                  padding: "8px 16px", borderRadius: "8px",
                  border: "1px solid #d1d5db", background: "#fff",
                  cursor: "pointer", fontSize: "14px"
                }}
              >
                キャンセル
              </button>
              <button
                disabled={!selectedCancelReason || (selectedCancelReason === "その他" && !customCancelReason.trim())}
                onClick={async () => {
                  const finalReason = selectedCancelReason === "その他" ? customCancelReason.trim() : selectedCancelReason;
                  await handleCancelLate(cancelTarget.item, cancelTarget.type, finalReason);
                  setCancelTarget(null);
                }}
                style={{
                  padding: "8px 16px", borderRadius: "8px",
                  border: "none",
                  background: (!selectedCancelReason || (selectedCancelReason === "その他" && !customCancelReason.trim())) ? "#d1d5db" : "#6b7280",
                  color: "#fff", cursor: "pointer", fontSize: "14px", fontWeight: "bold"
                }}
              >
                取消を実行
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
          .status-badge.purple { background: #f3e8ff; color: #7c3aed; border: 1px solid #d8b4fe; }
          .row-purple { background: #fcf4ff; }
          .toggle-btn { margin-right: 4px; padding: 4px 8px; border: 1px solid #ddd; background: #fff; cursor: pointer; }
      `}</style>
    </div >
  );
}
