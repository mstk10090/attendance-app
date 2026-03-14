import React, { useEffect, useState, useMemo, useRef } from "react";
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addDays, addMonths, subMonths, startOfYear, endOfYear, isSaturday, isSunday } from "date-fns";
import { ja } from "date-fns/locale";
import { Search, Filter, AlertTriangle, CheckCircle, XCircle, Clock, MapPin, Download, Save, X, Briefcase, FileText, Send, PieChart, BarChart, ClipboardCheck, Trash2, MessageSquare } from "lucide-react";
import "../../App.css";
import { LOCATIONS, DEPARTMENTS, EMPLOYMENT_TYPES, HOLIDAYS } from "../../constants";
import { fetchShiftData, normalizeName } from "../../utils/shiftParser";


const API_BASE = "https://lfsu60xvw7.execute-api.ap-northeast-1.amazonaws.com";
const API_USER_URL = "https://lfsu60xvw7.execute-api.ap-northeast-1.amazonaws.com/users";

// --- Utilities ---
const parseComment = (raw) => {
  try {
    if (!raw) return { segments: [], text: "", auditLog: [] };
    if (typeof raw === "object") {
      if (Array.isArray(raw)) return { segments: raw, text: "", auditLog: [] };
      return { segments: raw.segments || [], text: raw.text || "", application: raw.application || null, auditLog: raw.auditLog || [] };
    }
    const parsed = JSON.parse(raw);
    if (!parsed) return { segments: [], text: raw, auditLog: [] };

    if (Array.isArray(parsed)) {
      return { segments: parsed, text: "", auditLog: [] };
    }
    if (typeof parsed === 'object') {
      const segs = Array.isArray(parsed.segments) ? parsed.segments : [];
      return {
        segments: segs,
        text: parsed.text || "",
        application: parsed.application || null,
        auditLog: parsed.auditLog || []
      };
    }
    return { segments: [], text: raw, auditLog: [] };
  } catch (e) {
    return { segments: [], text: raw || "", auditLog: [] };
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
  /* URL Params */
  const urlParams = new URLSearchParams(window.location.search);
  const urlUserId = urlParams.get('userId');
  const urlDate = urlParams.get('date');
  /* State */
  const [viewMode, setViewMode] = useState("custom"); // daily, weekly, monthly, report, current, custom
  const isSuperAdmin = localStorage.getItem("role") === "super_admin";
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

  // カスタム検索用State
  const [customDateFrom, setCustomDateFrom] = useState(format(new Date(), "yyyy-MM-dd"));
  const [customDateTo, setCustomDateTo] = useState(format(new Date(), "yyyy-MM-dd"));
  const [customStatuses, setCustomStatuses] = useState(new Set([
    "pending", "approved", "working", "incomplete", "discrepancy", "resubmission", "error", "night", "noshift", "no_shift_day", "absent", "sa_return_admin", "sa_return_staff"
  ]));
  const [customSearchTriggered, setCustomSearchTriggered] = useState(false);

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
  const [editingItemId, setEditingItemId] = useState(0);
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
  const CANCEL_REASONS = ["tapo確認済"];
  const [cancelTarget, setCancelTarget] = useState(null); // { item, type }
  const [selectedCancelReason, setSelectedCancelReason] = useState("");
  const [customCancelReason, setCustomCancelReason] = useState("");

  // 上位管理者アクション用
  const [saActionModal, setSaActionModal] = useState(null); // { item, type: 'return_admin'|'return_staff'|'cancel' }
  const [saActionComment, setSaActionComment] = useState("");

  // 乖離理由展開用
  const [expandedReasonId, setExpandedReasonId] = useState(null);

  // 操作ログモーダル用
  const [logModalItem, setLogModalItem] = useState(null);

  // 承認確認モーダル用
  const [approveConfirmItem, setApproveConfirmItem] = useState(null);

  // auditLog記録用ヘルパー
  const addAuditLog = (commentStr, action, detail) => {
    const p = parseComment(commentStr);
    const log = p.auditLog || [];
    log.push({
      action,
      by: "管理者",
      at: new Date().toISOString(),
      detail
    });
    return { ...p, auditLog: log };
  };

  const buildCommentWithLog = (commentStr, action, detail, overrides = {}) => {
    const withLog = addAuditLog(commentStr, action, detail);
    return JSON.stringify({ ...withLog, ...overrides });
  };




  useEffect(() => {
    fetchUsers();
    fetchShiftData().then(setShiftMap);
  }, []);

  // URLパラメータからuserIdが指定されている場合、ユーザー名でフィルタリング
  useEffect(() => {
    if (urlUserId && users.length > 0) {
      const targetUser = users.find(u => u.userId === urlUserId);
      if (targetUser) {
        const name = targetUser.lastName && targetUser.firstName
          ? `${targetUser.lastName} ${targetUser.firstName}`
          : targetUser.userName || targetUser.loginId || "";
        setFilterName(name.trim());
      }
    }
    // URLパラメータで日付が指定されている場合、日付範囲を設定して自動検索
    if (urlDate) {
      setCustomDateFrom(urlDate);
      setCustomDateTo(urlDate);
      setCustomSearchTriggered(true);
    }
  }, [users, urlUserId, urlDate]);

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
        let list = Array.isArray(data) ? data : (data.items || []);
        // テストユーザーを除外
        const EXCLUDED_NAMES = new Set(["bb", "テスト", "テストユーザー", "不明"]);
        list = list.filter(u => {
          const name = ((u.lastName || "") + (u.firstName || "")).replace(/\s+/g, "").trim();
          return !EXCLUDED_NAMES.has(name);
        });
        setUsers(list);
      }
    } catch (e) { console.error(e); }
  }

  /* Data Fetching */
  // カスタム日付のRefを保持（fetchRange再計算の抑制用）
  const customDateFromRef = useRef(customDateFrom);
  const customDateToRef = useRef(customDateTo);
  useEffect(() => { customDateFromRef.current = customDateFrom; }, [customDateFrom]);
  useEffect(() => { customDateToRef.current = customDateTo; }, [customDateTo]);

  const fetchRange = useMemo(() => {
    const d = new Date(baseDate);
    if (viewMode === "current") return { start: baseDate, end: baseDate };

    if (viewMode === "custom") {
      // customSearchTriggeredが変わった時のみ最新の日付を使う
      return { start: customDateFromRef.current, end: customDateToRef.current };
    } else if (viewMode === "daily") {
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
  }, [viewMode, baseDate, customSearchTriggered]);

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

      // ユーザーマスタを確実に取得（usersステートが空の場合はAPIから直接取得）
      let allUsers = users;
      if (allUsers.length === 0) {
        try {
          const token = localStorage.getItem("token");
          const headers = {};
          if (token) headers["Authorization"] = token;
          const uRes = await fetch(API_USER_URL, { headers });
          if (uRes.ok) {
            const uText = await uRes.text();
            const uOuter = JSON.parse(uText);
            const uData = (uOuter.body && typeof uOuter.body === "string") ? JSON.parse(uOuter.body) : uOuter;
            allUsers = Array.isArray(uData) ? uData : (uData.items || []);
          }
        } catch (e) { console.warn("Failed to fetch users for staff list:", e); }
      }
      // loginIdベースで重複排除（新ID=user-2026...を優先、旧ID=user-177...を除外）
      {
        const byLogin = new Map();
        for (const u of allUsers) {
          const lid = u.loginId || u.userId;
          const existing = byLogin.get(lid);
          if (!existing || (u.userId || "").localeCompare(existing.userId || "") > 0) {
            byLogin.set(lid, u);
          }
        }
        allUsers = Array.from(byLogin.values());
      }
      // 除外対象をフィルタ
      const EXCLUDED_FULL_NAMES = new Set(["不明", "bb", "テスト", "テストユーザー"]);
      allUsers = allUsers.filter(u => {
        const name = ((u.lastName || "") + (u.firstName || "")).replace(/\s+/g, "").trim();
        return name && !EXCLUDED_FULL_NAMES.has(name);
      });

      const processedItems = uniqueItems.map(item => {
        const p = parseComment(item.comment);
        const segments = (item.segments && item.segments.length > 0) ? item.segments : p.segments;
        // DBユーザーマスタの名前で上書き（正式な漢字を使用）
        let displayName = item.userName;
        const allU = allUsers.length > 0 ? allUsers : users;
        if (allU.length > 0) {
          const normalizedItemName = normalizeName(item.userName || "");
          const matchedUser = allU.find(u => {
            const fullName = (u.lastName || "") + (u.firstName || "");
            return normalizeName(fullName) === normalizedItemName;
          });
          if (matchedUser) {
            displayName = (matchedUser.lastName || "") + (matchedUser.firstName || "");
          }
        }
        // 不明・空名のレコードを除外
        return {
          ...item,
          userName: displayName,
          segments,
          _parsedHtmlComment: p.text,
          _application: p.application
        };
      }).filter(item => {
        const name = (item.userName || "").replace(/\s+/g, "").trim();
        return name && name !== "不明" && name !== "-" && name !== "不明-";
      });

      // Sort
      processedItems.sort((a, b) => {
        if (a.workDate !== b.workDate) return a.workDate.localeCompare(b.workDate);
        return a.userId.localeCompare(b.userId);
      });
      // DynamoDB APIからシフト予定者を直接取得（スプシ読み込みを待たない高速表示）
      try {
        const CONFIRMED_API = "https://lfsu60xvw7.execute-api.ap-northeast-1.amazonaws.com/shift/confirmed";
        const dateFrom = format(start, "yyyy-MM-dd");
        const dateTo = format(end, "yyyy-MM-dd");
        const shiftRes = await fetch(`${CONFIRMED_API}?dateFrom=${dateFrom}&dateTo=${dateTo}`);
        if (shiftRes.ok) {
          const shiftData = await shiftRes.json();
          const confirmedShifts = shiftData.shifts || {};
          const existingKeys = new Set(processedItems.map(i => `${normalizeName(i.userName)}_${i.workDate}`));
          for (const shiftUserName of Object.keys(confirmedShifts)) {
            for (const dateKey of Object.keys(confirmedShifts[shiftUserName])) {
              const sd = confirmedShifts[shiftUserName][dateKey];
              if (sd.isOff) continue;
              if (!sd.start && !sd.end) continue; // シフトデータが空の場合スキップ
              const normalizedShiftName = normalizeName(shiftUserName);
              if (existingKeys.has(`${normalizedShiftName}_${dateKey}`)) continue;
              const matchedUser = allUsers.find(u => normalizeName((u.lastName || "") + (u.firstName || "")) === normalizedShiftName) || users.find(u => normalizeName((u.lastName || "") + (u.firstName || "")) === normalizedShiftName);
              const correctName = matchedUser ? (matchedUser.lastName || "") + (matchedUser.firstName || "") : shiftUserName;
              processedItems.push({
                userId: matchedUser?.userId || `shift_${shiftUserName}_${dateKey}`,
                userName: correctName,
                workDate: dateKey,
                clockIn: "",
                clockOut: "",
                breaks: [],
                comment: "",
                location: sd.location || "",
                department: matchedUser?.department || "",
                segments: [],
                _parsedHtmlComment: "",
                _application: null,
                _shiftOnly: true
              });
              existingKeys.add(`${normalizedShiftName}_${dateKey}`);
            }
          }
          // 再ソート
          processedItems.sort((a, b) => {
            if (a.workDate !== b.workDate) return a.workDate.localeCompare(b.workDate);
            return (a.userName || "").localeCompare(b.userName || "");
          });
        }
      } catch (e) {
        console.warn("Failed to fetch confirmed shifts for admin:", e.message);
      }

      // シフトも勤怠もないユーザーを空行として追加（管理者が修正・欠勤登録可能にする）
      if (allUsers.length > 0) {
        const EXCLUDED_NAMES = new Set(["bb", "テスト", "テストユーザー", "不明"]);
        const staffUsers = allUsers.filter(u => {
          const name = ((u.lastName || "") + (u.firstName || "")).replace(/\s+/g, "").trim();
          return !EXCLUDED_NAMES.has(name) && u.role !== "admin" && u.role !== "super_admin";
        });

        const existingKeys = new Set(processedItems.map(i => {
          const normalizedName = normalizeName(i.userName || "");
          return `${normalizedName}_${i.workDate}`;
        }));

        const days = eachDayOfInterval({ start, end });
        for (const day of days) {
          const dateStr = format(day, "yyyy-MM-dd");
          for (const u of staffUsers) {
            const fullName = (u.lastName || "") + (u.firstName || "");
            const normalizedName = normalizeName(fullName);
            const key = `${normalizedName}_${dateStr}`;
            if (existingKeys.has(key)) continue;

            processedItems.push({
              userId: u.userId,
              userName: fullName,
              workDate: dateStr,
              clockIn: "",
              clockOut: "",
              breaks: [],
              comment: "",
              location: u.defaultLocation || "",
              department: u.defaultDepartment || "",
              segments: [],
              _parsedHtmlComment: "",
              _application: null,
              _shiftOnly: true,
              _noShift: true
            });
            existingKeys.add(key);
          }
        }

        // 最終ソート
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


  // アイテムのステータスカテゴリを返す
  const getItemCategory = (item) => {
    const appStatus = item._application?.status;
    const isToday = item.workDate === format(new Date(), "yyyy-MM-dd");
    if (appStatus === "pending") return "pending";
    if (appStatus === "approved") return "approved";
    if (appStatus === "resubmission_requested") return "resubmission";
    if (appStatus === "sa_return_admin") return "sa_return_admin";
    if (appStatus === "sa_return_staff") return "sa_return_staff";
    if (appStatus === "absent") return "absent";
    // approved でも欠勤理由のレコードは欠勤扱い
    if (appStatus === "approved" && item._application?.reason === "欠勤") return "absent";
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
    if (!item.clockIn) {
      // シフトがあるのに打刻なし → 未出勤、シフトもなし → シフトなし
      if (item._noShift) return "no_shift_day";
      if (item._shiftOnly) return "noshift";
      // APIから来たレコードだがclockInなし → シフト有無を確認
      return "noshift";
    }
    return "other";
  };

  /* Filtering Logic */
  const filteredItems = useMemo(() => {
    return items.filter(item => {
      if (filterName && !normalizeName(item.userName).includes(normalizeName(filterName))) return false;

      if (filterLocation !== "all") {
        // item.location → segments → ユーザーマスタのdefaultLocationの順でフォールバック
        const matchedUser = users.find(u => u.userId === item.userId);
        const hasLoc =
          item.location === filterLocation ||
          (item.segments || []).some(s => s.location === filterLocation) ||
          (!item.location && matchedUser?.defaultLocation === filterLocation);
        if (!hasLoc) return false;
      }

      if (filterDepartment !== "all") {
        // item.department → segments → ユーザーマスタのdefaultDepartmentの順でフォールバック
        const matchedUser = users.find(u => u.userId === item.userId);
        const hasDept =
          item.department === filterDepartment ||
          (item.segments || []).some(s => s.department === filterDepartment) ||
          (!item.department && matchedUser?.defaultDepartment === filterDepartment);
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
    setLoading(true);
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

      const res = await fetch(`${API_BASE}/attendance/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        alert(`欠勤登録に失敗しました: ${res.status}`);
        return;
      }

      alert("欠勤登録しました");
      fetchAttendances();
    } catch (e) {
      console.error(e);
      alert("エラーが発生しました");
    } finally {
      setLoading(false);
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
    setEditingItemId(prev => prev + 1);
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
        application: newApp,
        auditLog: [...(p.auditLog || []), { action: "resubmission_requested", by: "管理者", at: new Date().toISOString(), detail: `再提出を依頼しました: ${resubmitReason}` }]
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

      // 欠勤レコードは承認フローに入らない
      if (existingApp.status === "absent" || existingApp.reason === "欠勤") {
        alert("欠勤レコードは承認対象ではありません");
        setLoading(false);
        return;
      }

      // 管理者がモーダルで時間を編集した場合はそちらを優先
      const adminEditIn = document.getElementById('adminEditIn')?.value || '';
      const adminEditOut = document.getElementById('adminEditOut')?.value || '';

      // 未申請または申請時間が空の場合、管理者編集→打刻時間の順で補完
      let appliedIn = existingApp.appliedIn || '';
      let appliedOut = existingApp.appliedOut || '';

      // appliedInが空の場合: 管理者編集 → 打刻の30分丸め
      if (!appliedIn) {
        if (adminEditIn) {
          appliedIn = adminEditIn;
        } else if (item.clockIn) {
          const inMin = Math.ceil(toMin(item.clockIn) / 30) * 30;
          const inH = String(Math.floor(inMin / 60)).padStart(2, '0');
          const inM = String(inMin % 60).padStart(2, '0');
          appliedIn = `${inH}:${inM}`;
        }
      }
      // appliedOutが空の場合: 管理者編集 → 打刻の30分丸め
      if (!appliedOut) {
        if (adminEditOut) {
          appliedOut = adminEditOut;
        } else if (item.clockOut) {
          const outMin = Math.floor(toMin(item.clockOut) / 30) * 30;
          const outH = String(Math.floor(outMin / 60)).padStart(2, '0');
          const outM = String(outMin % 60).padStart(2, '0');
          appliedOut = `${outH}:${outM}`;
        }
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
        application: newApp,
        auditLog: [...(p.auditLog || []), { action: "approved", by: "管理者", at: new Date().toISOString(), detail: `承認しました${approveReason ? ` (${approveReason})` : ""}` }]
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

  // 管理者による承認取消（approved → pending に戻す）
  const handleRevokeApproval = async (item) => {
    if (!await showConfirm("この勤怠の承認を取り消しますか？\n承認待ち状態に戻ります。")) return;
    const scrollY = window.scrollY;
    setLoading(true);
    try {
      const p = parseComment(item.comment);
      const existingApp = p.application || {};
      const newApp = {
        ...existingApp,
        status: 'pending',
      };
      // confirmedByがあれば削除
      delete newApp.confirmedBy;
      delete newApp.confirmedAt;

      const finalComment = JSON.stringify({
        segments: p.segments,
        text: p.text,
        application: newApp,
        auditLog: [...(p.auditLog || []), { action: "revoke_approval", by: "管理者", at: new Date().toISOString(), detail: "管理者が承認を取り消しました" }]
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

      setItems(prev => prev.map(i =>
        (i.userId === item.userId && i.workDate === item.workDate)
          ? { ...i, comment: finalComment, _application: newApp }
          : i
      ));
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
      // 元のcommentからapplication以外の情報を保持
      const parsed = parseComment(item.comment);
      const newComment = JSON.stringify({
        segments: parsed.segments || [],
        text: "",
        application: null,
        auditLog: [
          ...(parsed.auditLog || []),
          {
            action: "absent_cancelled",
            by: localStorage.getItem("loginId") || "admin",
            at: new Date().toISOString(),
            note: "管理者が欠勤を取り消し"
          }
        ]
      });

      const payload = {
        userId: item.userId,
        workDate: item.workDate,
        clockIn: "",
        clockOut: "",
        breaks: [],
        comment: newComment
      };
      const res = await fetch(`${API_BASE}/attendance/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        alert(`欠勤取消に失敗しました: ${res.status}`);
        return;
      }

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
              if (viewMode === "daily" || viewMode === "custom") setBaseDate(format(addDays(d, -1), "yyyy-MM-dd"));
              if (viewMode === "weekly") setBaseDate(format(addDays(d, -7), "yyyy-MM-dd"));
              if (viewMode === "monthly" || viewMode === "report") setBaseDate(format(subMonths(d, 1), "yyyy-MM-dd"));
            }}>{"<"}</button>

            <span style={{ fontWeight: "bold", fontSize: "1.1rem" }}>
              {viewMode === "daily" && format(new Date(baseDate), "yyyy年M月d日 (E)", { locale: ja })}
              {viewMode === "custom" && `${fetchRange.start} 〜 ${fetchRange.end}`}
              {viewMode !== "daily" && viewMode !== "custom" && `${fetchRange.start} 〜 ${fetchRange.end}`}
            </span>

            <button className="icon-btn" onClick={() => {
              const d = new Date(baseDate);
              if (viewMode === "daily" || viewMode === "custom") setBaseDate(format(addDays(d, 1), "yyyy-MM-dd"));
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

        {/* 検索パネル（カスタム含む全モードで表示、current除く） */}
        {viewMode !== "current" && (
          <div style={{
            background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "10px",
            padding: "20px", marginBottom: "16px"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px", borderBottom: "1px solid #e2e8f0", paddingBottom: "12px" }}>
              <Search size={18} color="#3b82f6" />
              <span style={{ fontWeight: "bold", fontSize: "1rem", color: "#1e40af" }}>検索条件</span>
            </div>

            {/* 期間指定 */}
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px", flexWrap: "wrap" }}>
              <span style={{ fontWeight: "600", fontSize: "0.9rem", color: "#374151", minWidth: "70px" }}>期間指定:</span>
              <input
                type="date"
                value={customDateFrom}
                onChange={e => setCustomDateFrom(e.target.value)}
                style={{
                  padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: "6px",
                  fontSize: "0.9rem", background: "#fff", outline: "none"
                }}
              />
              <span style={{ color: "#6b7280", fontWeight: "500" }}>～</span>
              <input
                type="date"
                value={customDateTo}
                onChange={e => setCustomDateTo(e.target.value)}
                style={{
                  padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: "6px",
                  fontSize: "0.9rem", background: "#fff", outline: "none"
                }}
              />
            </div>

            {/* ステータスチェックボックス */}
            <div style={{ marginBottom: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                <span style={{ fontWeight: "600", fontSize: "0.9rem", color: "#374151", minWidth: "70px" }}>ステータス:</span>
                <button
                  onClick={() => {
                    const allKeys = ["pending", "approved", "working", "incomplete", "discrepancy", "resubmission", "error", "night", "noshift", "no_shift_day", "absent", "sa_return_admin", "sa_return_staff"];
                    setCustomStatuses(prev => prev.size === allKeys.length ? new Set() : new Set(allKeys));
                  }}
                  style={{
                    padding: "3px 10px", border: "1px solid #d1d5db", borderRadius: "4px",
                    background: "#fff", fontSize: "0.75rem", cursor: "pointer", color: "#6b7280"
                  }}
                >
                  {customStatuses.size === 12 ? "全解除" : "全選択"}
                </button>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", paddingLeft: "78px" }}>
                {[
                  { key: "pending", label: "承認待ち", color: "#f59e0b" },
                  { key: "approved", label: "承認済み", color: "#22c55e" },
                  { key: "resubmission", label: "再提出", color: "#a855f7" },
                  { key: "working", label: "勤務中", color: "#3b82f6" },
                  { key: "incomplete", label: "未退勤", color: "#ef4444" },
                  { key: "discrepancy", label: "時間ずれ", color: "#f97316" },
                  { key: "error", label: "時間異常", color: "#dc2626" },
                  { key: "night", label: "深夜勤務", color: "#6366f1" },
                  { key: "noshift", label: "未出勤", color: "#ef4444" },
                  { key: "no_shift_day", label: "シフトなし", color: "#9ca3af" },
                  { key: "absent", label: "欠勤", color: "#78716c" },
                  { key: "sa_return_admin", label: "上位差戻(管)", color: "#be123c" },
                  { key: "sa_return_staff", label: "上位差戻(ス)", color: "#c2410c" },
                ].map(opt => (
                  <label key={opt.key} style={{
                    display: "flex", alignItems: "center", gap: "5px",
                    padding: "5px 10px", borderRadius: "6px",
                    border: customStatuses.has(opt.key) ? `1.5px solid ${opt.color}` : "1.5px solid #e5e7eb",
                    background: customStatuses.has(opt.key) ? `${opt.color}10` : "#fff",
                    cursor: "pointer", fontSize: "0.82rem", fontWeight: "500",
                    transition: "all 0.15s", userSelect: "none"
                  }}>
                    <input
                      type="checkbox"
                      checked={customStatuses.has(opt.key)}
                      onChange={() => {
                        setCustomStatuses(prev => {
                          const next = new Set(prev);
                          if (next.has(opt.key)) next.delete(opt.key); else next.add(opt.key);
                          return next;
                        });
                      }}
                      style={{ accentColor: opt.color, width: "15px", height: "15px" }}
                    />
                    <span style={{ color: customStatuses.has(opt.key) ? opt.color : "#6b7280" }}>{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* スタッフ名・勤務地・部署 */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", marginBottom: "16px", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ fontSize: "0.85rem", color: "#374151", fontWeight: "500" }}>スタッフ名:</span>
                <input
                  type="text"
                  placeholder="名前で検索"
                  value={filterName}
                  onChange={e => setFilterName(e.target.value)}
                  style={{
                    padding: "7px 10px", border: "1px solid #d1d5db", borderRadius: "6px",
                    fontSize: "0.85rem", background: "#fff", outline: "none", width: "150px"
                  }}
                />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <MapPin size={15} color="#6b7280" />
                <select className="input" value={filterLocation} onChange={e => setFilterLocation(e.target.value)} style={{ padding: "7px 10px", fontSize: "0.85rem" }}>
                  <option value="all">全勤務地</option>
                  {LOCATIONS.filter(l => l !== "未記載").map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <Briefcase size={15} color="#6b7280" />
                <select className="input" value={filterDepartment} onChange={e => setFilterDepartment(e.target.value)} style={{ padding: "7px 10px", fontSize: "0.85rem" }}>
                  <option value="all">全部署</option>
                  {DEPARTMENTS.filter(d => d !== "未記載").map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            </div>

            {/* 照会ボタン */}
            <div style={{ display: "flex", justifyContent: "center" }}>
              <button
                onClick={() => {
                  setCustomSearchTriggered(prev => !prev);
                  setFilterStatus(customStatuses);
                  fetchAttendances();
                }}
                style={{
                  padding: "10px 40px", borderRadius: "8px", border: "none",
                  background: "linear-gradient(135deg, #3b82f6, #2563eb)",
                  color: "#fff", fontSize: "0.95rem", fontWeight: "bold",
                  cursor: "pointer", boxShadow: "0 2px 8px rgba(37,99,235,0.3)",
                  display: "flex", alignItems: "center", gap: "8px",
                  transition: "all 0.2s"
                }}
                onMouseEnter={e => e.target.style.transform = "translateY(-1px)"}
                onMouseLeave={e => e.target.style.transform = "translateY(0)"}
              >
                <Search size={16} /> 照会
              </button>
            </div>
          </div>
        )}

        {/* Filters */}
        {viewMode !== "report" && viewMode !== "current" && viewMode !== "shift_check" && viewMode !== "custom" && (
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
                  const labels = { pending: "承認待ち", approved: "承認済み", working: "勤務中", incomplete: "未退勤", discrepancy: "時間ずれ", resubmission: "再提出", error: "時間異常", night: "深夜勤務", noshift: "未出勤", no_shift_day: "シフトなし", sa_return_admin: "上位差戻(管)", sa_return_staff: "上位差戻(ス)" };
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
                  {[{ key: "pending", label: "承認待ち" }, { key: "approved", label: "承認済み" }, { key: "working", label: "勤務中" }, { key: "incomplete", label: "未退勤" }, { key: "discrepancy", label: "時間ずれ" }, { key: "resubmission", label: "再提出" }, { key: "error", label: "時間異常" }, { key: "night", label: "深夜勤務" }, { key: "noshift", label: "未出勤" }, { key: "no_shift_day", label: "シフトなし" }, { key: "sa_return_admin", label: "上位差戻(管)" }, { key: "sa_return_staff", label: "上位差戻(ス)" }].map(opt => (
                    <label key={opt.key} className="status-dropdown-item">
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
                  const saReturnCount = dayItems.filter(i => ["sa_return_admin", "sa_return_staff"].includes(i._application?.status)).length;

                  let bg = isCurrentMonth ? "#fff" : "#f9fafb";
                  if (hasError) bg = "#fef2f2";
                  else if (pendingCount > 0) bg = "#fff7ed";
                  else if (saReturnCount > 0) bg = "#fef2f2"; // Red for SA return
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
              {/* 一括承認ボタン */}
              {(() => {
                const pendingInView = filteredItems.filter(i => i._application?.status === "pending");
                if (pendingInView.length === 0) return null;
                return (
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 16px", background: "#f0fdf4", borderRadius: "8px", marginBottom: "12px", border: "1px solid #bbf7d0" }}>
                    <span style={{ fontSize: "13px", color: "#166534", fontWeight: "bold" }}>
                      📋 表示中の承認待ち: {pendingInView.length}件
                    </span>
                    <button
                      onClick={async () => {
                        if (!confirm(`表示中の承認待ち ${pendingInView.length}件 を一括承認しますか？`)) return;
                        setLoading(true);
                        let successCount = 0;
                        for (const item of pendingInView) {
                          try {
                            await handleApprove(item);
                            successCount++;
                          } catch (e) {
                            console.error("一括承認エラー:", item.userName, e);
                          }
                        }
                        setLoading(false);
                        alert(`${successCount}件を承認しました`);
                      }}
                      disabled={loading}
                      style={{
                        padding: "6px 16px", borderRadius: "6px", border: "none",
                        background: loading ? "#93c5fd" : "#10b981", color: "#fff",
                        fontWeight: "bold", fontSize: "13px", cursor: loading ? "default" : "pointer",
                        display: "flex", alignItems: "center", gap: "6px"
                      }}
                    >
                      <CheckCircle size={14} /> 一括承認
                    </button>
                  </div>
                );
              })()}
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
                      // 管理者修正済みの場合は申請時間ベースで判定
                      const app = item._application || {};
                      const isAdminEdited = !!app.adminEdited;
                      const checkIn = isAdminEdited && app.appliedIn ? toMin(app.appliedIn) : toMin(item.clockIn);
                      const checkOut = isAdminEdited && app.appliedOut ? toMin(app.appliedOut) : toMin(item.clockOut);

                      // 管理者修正: ぴったりは遅刻にしない(>)、通常打刻: ぴったりは遅刻(>=)
                      const isLate = isAdminEdited ? checkIn > shiftStartMin : checkIn >= shiftStartMin;
                      const isEarly = checkOut < shiftEndMin;
                      const isOvertime = checkOut >= shiftEndMin + 30; // シフト終了30分以上で残業判定

                      if (isLate && isEarly) shiftCheck = "both";
                      else if (isLate && isOvertime) shiftCheck = "late_overtime";
                      else if (isLate) shiftCheck = "late";
                      else if (isEarly) shiftCheck = "early";
                      else if (isOvertime) shiftCheck = "overtime";
                      else shiftCheck = "ok";
                    }

                    const category = getItemCategory(item);
                    const isShiftOnly = category !== "absent" && ((item._shiftOnly && !item.clockIn) || (category === "noshift") || (category === "no_shift_day"));
                    const isNoShiftDay = category === "no_shift_day";

                    let bg = "#fff";
                    if (isShiftOnly && !isNoShiftDay) bg = "#fef2f2"; // Red (未出勤: シフトあり未打刻)
                    else if (isNoShiftDay) bg = "#f9fafb"; // Light gray (シフトなし)
                    else if (category === "absent") bg = "#fce4ec"; // Maroon/pink for absent
                    else if (rowAppStatus === "approved") bg = "#d1fae5"; // Stronger green for approved
                    else if (rowAppStatus === "pending") bg = "#fff7ed"; // Orange
                    else if (rowAppStatus === "resubmission_requested") bg = "#fcf4ff"; // Purple
                    else if (rowAppStatus === "sa_return_admin") bg = "#fef2f2"; // Red
                    else if (rowAppStatus === "sa_return_staff") bg = "#fff7ed"; // Orange
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
                            // 自動承認待ち(問題なし): 30分丸めの申請時間を表示
                            if (item.clockIn && item.clockOut && !app?.appliedIn) {
                              const roundCeil = (t) => { const m = toMin(t); const r = Math.ceil(m / 30) * 30; const hh = String(Math.floor(r / 60)).padStart(2, '0'); const mm = String(r % 60).padStart(2, '0'); return `${hh}:${mm}`; };
                              const roundFloor = (t) => { const m = toMin(t); const r = Math.floor(m / 30) * 30; const hh = String(Math.floor(r / 60)).padStart(2, '0'); const mm = String(r % 60).padStart(2, '0'); return `${hh}:${mm}`; };
                              return (
                                <span style={{ fontFamily: "monospace", color: "#9ca3af" }}>
                                  {roundCeil(item.clockIn)}-{roundFloor(item.clockOut)}
                                </span>
                              );
                            }
                            return <span style={{ color: "#9ca3af" }}>-</span>;
                          })()}
                        </td>
                        <td style={{ padding: "10px 8px" }}>
                          {isShiftOnly && !isNoShiftDay && <span className="status-badge" style={{ background: "#fee2e2", color: "#991b1b", border: "1px solid #fca5a5", fontSize: "11px", fontWeight: "bold" }}>未出勤</span>}
                          {isNoShiftDay && <span className="status-badge" style={{ background: "#f3f4f6", color: "#6b7280", border: "1px solid #d1d5db", fontSize: "11px", fontWeight: "bold" }}>シフトなし</span>}
                          {!isShiftOnly && isWorking && <span className="status-badge green" style={{ background: "#dcfce7", color: "#166534", border: "1px solid #bbf7d0", fontSize: "11px" }}>出勤中</span>}
                          {!isShiftOnly && isIncomplete && <span className="status-badge red" style={{ fontSize: "11px" }}>未退勤</span>}
                          {!isShiftOnly && rowAppStatus === "pending" && <span className="status-badge orange" style={{ fontSize: "11px" }}>承認待</span>}
                          {!isShiftOnly && rowAppStatus === "approved" && category !== "absent" && <span className="status-badge" style={{ background: "#059669", color: "#fff", fontSize: "11px", fontWeight: "bold", padding: "3px 8px" }}>✅ 承認済{item._application?.adminEdited && <span style={{ fontSize: "9px", opacity: 0.8 }}> (管理者)</span>}</span>}
                          {!isShiftOnly && category === "absent" && <span className="status-badge" style={{ background: "#800000", color: "#fff", fontSize: "11px", fontWeight: "bold", padding: "3px 8px" }}>欠勤</span>}
                          {!isShiftOnly && rowAppStatus === "resubmission_requested" && <span className="status-badge purple" style={{ fontSize: "11px" }}>再提出</span>}
                          {!isShiftOnly && rowAppStatus === "sa_return_admin" && <span className="status-badge" style={{ background: "#be123c", color: "#fff", fontSize: "11px", fontWeight: "bold", padding: "3px 8px" }}>🔴 上位差戻(管)</span>}
                          {!isShiftOnly && rowAppStatus === "sa_return_staff" && <span className="status-badge" style={{ background: "#c2410c", color: "#fff", fontSize: "11px", fontWeight: "bold", padding: "3px 8px" }}>🟠 上位差戻(ス)</span>}
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
                            {/* 承認済み → 管理者の承認取消（非上位管理者） */}
                            {rowAppStatus === "approved" && !isSuperAdmin && (
                              <button
                                className="btn"
                                onClick={() => handleRevokeApproval(item)}
                                style={{
                                  fontSize: "11px", padding: "4px 10px",
                                  background: "#fee2e2", color: "#991b1b", border: "1px solid #fca5a5", borderRadius: "4px",
                                  cursor: "pointer", fontWeight: "bold", display: "flex", alignItems: "center", gap: "4px"
                                }}
                              >
                                <XCircle size={12} /> 承認取消
                              </button>
                            )}

                            {/* 承認済み → 上位管理者アクション（super_adminのみ） */}
                            {rowAppStatus === "approved" && isSuperAdmin && (
                              <>
                                <button
                                  className="btn"
                                  onClick={() => setApproveConfirmItem(item)}
                                  style={{
                                    fontSize: "11px", padding: "4px 10px",
                                    background: "#10b981", color: "#fff", border: "none", borderRadius: "4px",
                                    cursor: "pointer", fontWeight: "bold", display: "flex", alignItems: "center", gap: "4px"
                                  }}
                                >
                                  <CheckCircle size={12} /> 最終承認
                                </button>
                                <button
                                  className="btn"
                                  onClick={() => { setSaActionModal({ item, type: "return_admin" }); setSaActionComment(""); }}
                                  style={{
                                    fontSize: "11px", padding: "4px 10px",
                                    background: "#2563eb", color: "#fff", border: "none", borderRadius: "4px",
                                    cursor: "pointer", fontWeight: "bold", display: "flex", alignItems: "center", gap: "4px"
                                  }}
                                >
                                  🔵 井本へ再提出
                                </button>
                                <button
                                  className="btn"
                                  onClick={() => { setSaActionModal({ item, type: "return_staff" }); setSaActionComment(""); }}
                                  style={{
                                    fontSize: "11px", padding: "4px 10px",
                                    background: "#f97316", color: "#fff", border: "none", borderRadius: "4px",
                                    cursor: "pointer", fontWeight: "bold", display: "flex", alignItems: "center", gap: "4px"
                                  }}
                                >
                                  🟠 スタッフへ再提出
                                </button>
                                <button
                                  className="btn"
                                  onClick={() => { setSaActionModal({ item, type: "cancel" }); setSaActionComment(""); }}
                                  style={{
                                    fontSize: "11px", padding: "4px 10px",
                                    background: "#fee2e2", color: "#991b1b", border: "1px solid #fca5a5", borderRadius: "4px",
                                    cursor: "pointer", fontWeight: "bold", display: "flex", alignItems: "center", gap: "4px"
                                  }}
                                >
                                  <XCircle size={12} /> 承認取消
                                </button>
                              </>
                            )}

                            {/* 上位管理者差戻（管理者向け）→ 再承認 + 修正（上位管理者コメント表示） */}
                            {rowAppStatus === "sa_return_admin" && (
                              <>
                                {item._application?.superAdminComment && (
                                  <div style={{ width: "100%", padding: "4px 8px", background: "#fef2f2", borderRadius: "4px", fontSize: "11px", color: "#991b1b", marginBottom: "4px" }}>
                                    📝 上位管理者: {item._application.superAdminComment}
                                  </div>
                                )}
                                <button
                                  className="btn"
                                  onClick={() => setApproveConfirmItem(item)}
                                  style={{
                                    fontSize: "11px", padding: "4px 10px",
                                    background: "#10b981", color: "#fff", border: "none", borderRadius: "4px",
                                    cursor: "pointer", fontWeight: "bold", display: "flex", alignItems: "center", gap: "4px"
                                  }}
                                >
                                  <CheckCircle size={12} /> 再承認
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
                              </>
                            )}

                            {/* 上位管理者差戻（スタッフ向け）→ 管理者は修正可能 + 上位管理者コメント表示 */}
                            {rowAppStatus === "sa_return_staff" && (
                              <>
                                {item._application?.superAdminComment && (
                                  <div style={{ width: "100%", padding: "4px 8px", background: "#fff7ed", borderRadius: "4px", fontSize: "11px", color: "#c2410c", marginBottom: "4px" }}>
                                    📝 上位管理者: {item._application.superAdminComment}
                                  </div>
                                )}
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
                                <span style={{ fontSize: "10px", color: "#9ca3af" }}>※スタッフ再申請待ち</span>
                              </>
                            )}

                            {/* 未承認（clockInあり）→ 承認（super_adminのみ） + 修正 + 再提出 */}
                            {!isShiftOnly && rowAppStatus !== "approved" && rowAppStatus !== "sa_return_admin" && rowAppStatus !== "sa_return_staff" && (
                              <>
                                <button
                                  className="btn"
                                  onClick={() => setApproveConfirmItem(item)}
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

                            {/* ログボタン */}
                            <button
                              className="btn"
                              onClick={(e) => { e.stopPropagation(); setLogModalItem(item); }}
                              style={{
                                fontSize: "11px", padding: "4px 10px",
                                background: "#f3f4f6", color: "#374151", border: "1px solid #d1d5db", borderRadius: "4px",
                                cursor: "pointer", fontWeight: "bold", display: "flex", alignItems: "center", gap: "4px"
                              }}
                            >
                              <MessageSquare size={12} /> ログ
                            </button>
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
            <div className="modal-content" key={editingItemId} style={{ maxWidth: "700px", position: "relative", maxHeight: "90vh", overflowY: "auto" }}>
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
                    {editingItem._application?.subReason && (
                      <div style={{ fontSize: "13px", color: "#6b7280", marginTop: "4px" }}>
                        詳細: {editingItem._application.subReason}
                        {editingItem._application.subReasonText ? ` (${editingItem._application.subReasonText})` : ""}
                      </div>
                    )}
                  </div>

                  {/* 打刻忘れ: 実際の時間表示 */}
                  {editingItem._application?.reason === "打刻忘れ" && (editingItem._application?.actualClockIn || editingItem._application?.actualClockOut) && (
                    <div style={{ background: "#fef3c7", padding: "10px", borderRadius: "6px", marginTop: "8px", border: "1px solid #fcd34d" }}>
                      <div style={{ fontSize: "12px", color: "#92400e", marginBottom: "4px", fontWeight: "bold" }}>⏰ 本人申告の実際の時間</div>
                      <div style={{ display: "flex", gap: "16px", fontSize: "14px" }}>
                        {editingItem._application.actualClockIn && (
                          <div><span style={{ color: "#6b7280" }}>出社:</span> <strong>{editingItem._application.actualClockIn}</strong></div>
                        )}
                        {editingItem._application.actualClockOut && (
                          <div><span style={{ color: "#6b7280" }}>退勤:</span> <strong>{editingItem._application.actualClockOut}</strong></div>
                        )}
                      </div>
                    </div>
                  )}
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
                      defaultValue={(() => {
                        const raw = editingItem._application?.appliedIn || editingItem.clockIn || "";
                        if (!raw) return "";
                        const m = toMin(raw); const r = Math.ceil(m / 30) * 30;
                        return `${String(Math.floor(r / 60)).padStart(2, '0')}:${String(r % 60).padStart(2, '0')}`;
                      })()}
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
                      defaultValue={(() => {
                        const raw = editingItem._application?.appliedOut || editingItem.clockOut || "";
                        if (!raw) return "";
                        const m = toMin(raw); const r = Math.floor(m / 30) * 30;
                        return `${String(Math.floor(r / 60)).padStart(2, '0')}:${String(r % 60).padStart(2, '0')}`;
                      })()}
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
                    const inEl = document.getElementById("adminEditIn");
                    const outEl = document.getElementById("adminEditOut");
                    const breakEl = document.getElementById("adminEditBreak");
                    if (!inEl || !outEl || !breakEl) { alert("フォーム要素が見つかりません"); return; }
                    const newIn = inEl.value;
                    const newOut = outEl.value;
                    const newBreak = parseInt(breakEl.value) || 0;
                    if (!newIn || !newOut) { alert("出勤・退勤時間を入力してください"); return; }

                    // 遅刻・残業の自動判定
                    const shift = findShiftForItem(editingItem);
                    let autoReason = null;
                    if (shift && shift.start && shift.end) {
                      const shiftStartMin = toMin(shift.start);
                      const shiftEndMin = toMin(shift.end);
                      const editInMin = toMin(newIn);
                      const editOutMin = toMin(newOut);
                      const isLate = editInMin > shiftStartMin; // 管理者修正はぴったりを遅刻にしない
                      const isOvertime = editOutMin >= shiftEndMin + 30;
                      const isEarly = editOutMin < shiftEndMin;
                      if (isLate && isOvertime) autoReason = "遅刻・残業";
                      else if (isLate) autoReason = "遅刻";
                      else if (isOvertime) autoReason = "残業";
                      else if (isEarly) autoReason = "早退";
                    }

                    const confirmMsg = `申請時間を管理者が編集します。\n出勤: ${newIn}\n退勤: ${newOut}\n休憩: ${newBreak}分${autoReason ? `\n\n⚠️ 判定: ${autoReason}` : "\n\n✅ 判定: 問題なし"}\n\nよろしいですか？`;
                    if (!window.confirm(confirmMsg)) return;
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
                      const finalComment = JSON.stringify({ segments: p.segments, text: p.text, application: newApp, auditLog: [...(p.auditLog || []), { action: "admin_edited", by: "管理者", at: new Date().toISOString(), detail: `管理者が修正しました（${newIn}〜${newOut}、休憩${newBreak}分）` }] });
                      const res = await fetch(`${API_BASE}/attendance/update`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          userId: editingItem.userId,
                          workDate: editingItem.workDate,
                          clockIn: editingItem.clockIn || "",
                          clockOut: editingItem.clockOut || "",
                          breaks: editingItem.breaks || [],
                          comment: finalComment
                        })
                      });
                      if (!res.ok) {
                        const err = await res.text();
                        throw new Error(`API error: ${res.status} ${err}`);
                      }
                      alert("保存しました");
                      setEditingItem(null);
                      fetchAttendances();
                    } catch (e) { console.error(e); alert("保存に失敗しました: " + e.message); }
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

              {/* 勤怠取り消し */}
              <div style={{ marginTop: "20px", padding: "20px", background: "#fff", border: "1px solid #fca5a5", borderRadius: "8px" }}>
                <h4 style={{ margin: "0 0 8px 0", fontSize: "1rem", color: "#dc2626", display: "flex", alignItems: "center", gap: "6px" }}>
                  🗑️ 勤怠取り消し
                </h4>
                <p style={{ fontSize: "0.85rem", color: "#6b7280", marginBottom: "12px" }}>
                  申請内容・実働・判定・理由をリセットします。打刻時間は保持されます。
                </p>
                <button
                  className="btn"
                  onClick={async () => {
                    if (!await showConfirm(`${editingItem.userName}さんの${editingItem.workDate}の勤怠を取り消しますか？\n\n⚠️ 申請内容・実働・判定・理由がリセットされます。\n（打刻時間は保持されます）`)) return;
                    setLoading(true);
                    try {
                      // ログを保持したまま申請内容のみリセット（打刻は維持）
                      const p = parseComment(editingItem.comment);
                      const existingLog = p.auditLog || [];
                      existingLog.push({ action: "cancelled", by: "管理者", at: new Date().toISOString(), detail: "勤怠を取り消しました（申請内容・実働・判定・理由をリセット）" });
                      const resetComment = JSON.stringify({ segments: p.segments || [], application: null, text: "", auditLog: existingLog });
                      const payload = {
                        userId: editingItem.userId,
                        workDate: editingItem.workDate,
                        clockIn: editingItem.clockIn || "",
                        clockOut: editingItem.clockOut || "",
                        breaks: editingItem.breaks || [],
                        comment: resetComment
                      };
                      await fetch(`${API_BASE}/attendance/update`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(payload),
                      });
                      alert("勤怠を取り消しました");
                      setEditingItem(null);
                      fetchAttendances();
                    } catch (e) {
                      console.error(e);
                      alert("エラーが発生しました");
                    } finally {
                      setLoading(false);
                    }
                  }}
                  style={{
                    width: "100%", padding: "10px", fontSize: "0.95rem", fontWeight: "bold",
                    background: "#dc2626", color: "#fff", border: "none", borderRadius: "6px",
                    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px"
                  }}
                >
                  <Trash2 size={16} /> 勤怠を取り消す
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

      {/* 承認確認モーダル */}
      {approveConfirmItem && (() => {
        const acItem = approveConfirmItem;
        const acShift = findShiftForItem(acItem);
        const acApp = acItem._application || {};
        const acClockIn = acItem.clockIn || "-";
        const acClockOut = acItem.clockOut || "-";
        const acAppliedIn = acApp.appliedIn || "-";
        const acAppliedOut = acApp.appliedOut || "-";
        const acReason = acApp.reason || "-";
        const acSubReason = acApp.subReason || "";
        const acDetailText = acApp.detailText || acApp.subReasonText || "";

        let shiftDisplay = "-";
        if (acShift) {
          if (acShift.isOff) {
            shiftDisplay = "休み";
          } else {
            const parts = [];
            if (acShift.start && acShift.end) parts.push(`${acShift.start}-${acShift.end}`);
            if (acShift.partStart && acShift.partEnd) parts.push(`バイト ${acShift.partStart}-${acShift.partEnd}`);
            shiftDisplay = parts.join(" / ") || "-";
          }
        }

        let workHours = "-";
        if (acAppliedIn !== "-" && acAppliedOut !== "-") {
          const diff = toMin(acAppliedOut) - toMin(acAppliedIn);
          const breakMin = acApp.breakDuration || 0;
          const net = diff - breakMin;
          if (net > 0) workHours = `${(net / 60).toFixed(1)}H`;
        }

        return (
          <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", justifyContent: "center", alignItems: "center" }}>
            <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)" }} onClick={() => setApproveConfirmItem(null)} />
            <div style={{
              position: "relative", background: "#fff", borderRadius: "14px",
              padding: "28px", maxWidth: "480px", width: "90%",
              boxShadow: "0 20px 60px rgba(0,0,0,0.3)"
            }}>
              <h3 style={{ margin: "0 0 20px 0", fontSize: "1.15rem", color: "#1f2937", display: "flex", alignItems: "center", gap: "8px" }}>
                <CheckCircle size={22} color="#10b981" /> 承認確認
              </h3>

              <div style={{ fontSize: "0.95rem", marginBottom: "16px" }}>
                <strong>{acItem.userName}</strong>
                <span style={{ color: "#6b7280", marginLeft: "8px" }}>{acItem.workDate}</span>
              </div>

              <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "20px", fontSize: "0.9rem" }}>
                <tbody>
                  <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                    <td style={{ padding: "10px 8px", color: "#6b7280", fontWeight: "600", width: "110px", background: "#f9fafb" }}>📅 シフト</td>
                    <td style={{ padding: "10px 8px", fontWeight: "bold" }}>{shiftDisplay}</td>
                  </tr>
                  <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                    <td style={{ padding: "10px 8px", color: "#6b7280", fontWeight: "600", background: "#f9fafb" }}>⏰ 実績（打刻）</td>
                    <td style={{ padding: "10px 8px" }}>
                      <span style={{ fontWeight: "bold" }}>{acClockIn}</span>
                      <span style={{ color: "#9ca3af", margin: "0 6px" }}>→</span>
                      <span style={{ fontWeight: "bold" }}>{acClockOut}</span>
                    </td>
                  </tr>
                  <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                    <td style={{ padding: "10px 8px", color: "#6b7280", fontWeight: "600", background: "#f9fafb" }}>📝 申請時間</td>
                    <td style={{ padding: "10px 8px" }}>
                      <span style={{ fontWeight: "bold", color: "#2563eb" }}>{acAppliedIn}</span>
                      <span style={{ color: "#9ca3af", margin: "0 6px" }}>→</span>
                      <span style={{ fontWeight: "bold", color: "#2563eb" }}>{acAppliedOut}</span>
                      <span style={{ color: "#6b7280", marginLeft: "10px", fontSize: "0.85rem" }}>({workHours})</span>
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: "10px 8px", color: "#6b7280", fontWeight: "600", background: "#f9fafb" }}>❓ 申請理由</td>
                    <td style={{ padding: "10px 8px" }}>
                      <span style={{ fontWeight: "bold", color: acReason !== "-" ? "#ef4444" : "#6b7280" }}>{acReason}</span>
                      {acSubReason && <span style={{ color: "#6b7280", marginLeft: "6px", fontSize: "0.85rem" }}>({acSubReason})</span>}
                      {acDetailText && <div style={{ fontSize: "0.82rem", color: "#6b7280", marginTop: "4px" }}>詳細: {acDetailText}</div>}
                    </td>
                  </tr>
                </tbody>
              </table>

              <div style={{ display: "flex", gap: "12px" }}>
                <button
                  onClick={() => setApproveConfirmItem(null)}
                  style={{
                    flex: 1, padding: "12px", borderRadius: "8px",
                    border: "1px solid #d1d5db", background: "#fff",
                    fontSize: "0.95rem", cursor: "pointer", fontWeight: "600", color: "#374151"
                  }}
                >
                  キャンセル
                </button>
                <button
                  onClick={() => {
                    handleApprove(acItem);
                    setApproveConfirmItem(null);
                  }}
                  style={{
                    flex: 1, padding: "12px", borderRadius: "8px",
                    border: "none", background: "linear-gradient(135deg, #10b981, #059669)",
                    color: "#fff", fontSize: "0.95rem", cursor: "pointer", fontWeight: "bold",
                    boxShadow: "0 2px 8px rgba(16,185,129,0.3)",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: "6px"
                  }}
                >
                  <CheckCircle size={18} /> 承認する
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 上位管理者アクションモーダル */}
      {saActionModal && (() => {
        const saItem = saActionModal.item;
        const saType = saActionModal.type;
        const titleMap = { return_admin: "🔵 井本へ再提出", return_staff: "🟠 スタッフへ再提出", cancel: "🔴 承認取消" };
        const descMap = {
          return_admin: "管理者（井本さん）にこの勤怠を差し戻します。\n管理者に再確認を依頼します。",
          return_staff: "スタッフにこの勤怠を差し戻します。\nスタッフに再申請を依頼します。",
          cancel: "この勤怠の承認を取り消します。\n承認待ち状態に戻ります。"
        };
        const colorMap = { return_admin: "#2563eb", return_staff: "#f97316", cancel: "#dc2626" };

        return (
          <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", justifyContent: "center", alignItems: "center" }}>
            <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)" }} onClick={() => setSaActionModal(null)} />
            <div style={{
              position: "relative", background: "#fff", borderRadius: "14px",
              padding: "28px", maxWidth: "500px", width: "90%",
              boxShadow: "0 20px 60px rgba(0,0,0,0.3)"
            }}>
              <h3 style={{ margin: "0 0 8px 0", fontSize: "1.15rem", color: "#1f2937" }}>
                {titleMap[saType]}
              </h3>
              <div style={{ fontSize: "0.9rem", color: "#6b7280", marginBottom: "16px", whiteSpace: "pre-line" }}>
                {descMap[saType]}
              </div>

              <div style={{ fontSize: "0.95rem", marginBottom: "16px", padding: "10px", background: "#f9fafb", borderRadius: "8px" }}>
                <strong>{saItem.userName}</strong>
                <span style={{ color: "#6b7280", marginLeft: "8px" }}>{saItem.workDate}</span>
              </div>

              <div style={{ marginBottom: "20px" }}>
                <label style={{ fontSize: "0.9rem", fontWeight: "600", color: "#374151", display: "block", marginBottom: "6px" }}>
                  📝 コメント（理由）
                </label>
                <textarea
                  value={saActionComment}
                  onChange={e => setSaActionComment(e.target.value)}
                  placeholder={saType === "return_admin" ? "井本さんへの確認依頼内容を入力..." : saType === "return_staff" ? "スタッフへの再提出依頼内容を入力..." : "承認取消の理由を入力..."}
                  style={{
                    width: "100%", minHeight: "80px", padding: "10px",
                    border: "1px solid #d1d5db", borderRadius: "8px",
                    fontSize: "0.9rem", resize: "vertical", boxSizing: "border-box"
                  }}
                />
              </div>

              <div style={{ display: "flex", gap: "12px" }}>
                <button
                  onClick={() => setSaActionModal(null)}
                  style={{
                    flex: 1, padding: "12px", borderRadius: "8px",
                    border: "1px solid #d1d5db", background: "#fff",
                    fontSize: "0.95rem", cursor: "pointer", fontWeight: "600", color: "#374151"
                  }}
                >
                  キャンセル
                </button>
                <button
                  onClick={async () => {
                    if (!saActionComment.trim() && saType !== "cancel") {
                      alert("コメントを入力してください");
                      return;
                    }
                    setLoading(true);
                    try {
                      const p = parseComment(saItem.comment);
                      const app = p.application || {};
                      let newApp, logAction, logDetail;

                      if (saType === "return_admin") {
                        newApp = { ...app, status: "sa_return_admin", superAdminComment: saActionComment.trim(), returnedAt: new Date().toISOString() };
                        logAction = "sa_return_admin";
                        logDetail = `上位管理者が管理者へ差し戻しました: ${saActionComment.trim()}`;
                      } else if (saType === "return_staff") {
                        newApp = { ...app, status: "sa_return_staff", superAdminComment: saActionComment.trim(), returnedAt: new Date().toISOString() };
                        logAction = "sa_return_staff";
                        logDetail = `上位管理者がスタッフへ差し戻しました: ${saActionComment.trim()}`;
                      } else {
                        // cancel: ステータスのみpendingに戻す（申請内容・打刻は保持）
                        newApp = {
                          ...app,
                          status: "pending",
                          confirmedBy: null,
                          confirmedAt: null,
                          superAdminComment: saActionComment.trim() || null,
                          withdrawn: true, withdrawnAt: new Date().toISOString()
                        };
                        logAction = "approval_cancelled";
                        logDetail = `上位管理者が承認を取り消しました${saActionComment.trim() ? `: ${saActionComment.trim()}` : ""}`;
                      }

                      const finalComment = JSON.stringify({
                        segments: p.segments, text: p.text, application: newApp,
                        auditLog: [...(p.auditLog || []), { action: logAction, by: "上位管理者", at: new Date().toISOString(), detail: logDetail }]
                      });

                      await fetch(`${API_BASE}/attendance/update`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          userId: saItem.userId, workDate: saItem.workDate,
                          clockIn: saItem.clockIn || "", clockOut: saItem.clockOut || "",
                          breaks: saItem.breaks || [], comment: finalComment
                        })
                      });

                      setSaActionModal(null);
                      fetchAttendances();
                    } catch (e) {
                      console.error(e);
                      alert("エラーが発生しました");
                    } finally {
                      setLoading(false);
                    }
                  }}
                  style={{
                    flex: 1, padding: "12px", borderRadius: "8px",
                    border: "none", background: colorMap[saType],
                    color: "#fff", fontSize: "0.95rem", cursor: "pointer", fontWeight: "bold",
                    boxShadow: `0 2px 8px ${colorMap[saType]}50`,
                    display: "flex", alignItems: "center", justifyContent: "center", gap: "6px"
                  }}
                >
                  {saType === "return_admin" && "井本へ差し戻す"}
                  {saType === "return_staff" && "スタッフへ差し戻す"}
                  {saType === "cancel" && <><XCircle size={18} /> 承認取消</>}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 確認モーダル */}
      {
        confirmModal.isOpen && (
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
        )
      }

      {/* 再提出理由選択モーダル */}
      {
        resubmitTarget && (
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
        )
      }

      {/* 取消理由選択モーダル */}
      {
        cancelTarget && (
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
        )
      }

      {/* LINEチャット風 操作ログモーダル */}
      {logModalItem && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0,0,0,0.5)", zIndex: 10001,
          display: "flex", alignItems: "center", justifyContent: "center"
        }} onClick={() => setLogModalItem(null)}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: "#e8ddd3", borderRadius: "16px", width: "90%", maxWidth: "480px",
              maxHeight: "80vh", display: "flex", flexDirection: "column",
              boxShadow: "0 16px 48px rgba(0,0,0,0.3)", overflow: "hidden"
            }}
          >
            {/* Header */}
            <div style={{
              background: "#7b6b5a", color: "#fff", padding: "14px 20px",
              display: "flex", justifyContent: "space-between", alignItems: "center",
              borderRadius: "16px 16px 0 0"
            }}>
              <div>
                <div style={{ fontWeight: "bold", fontSize: "15px" }}>操作ログ</div>
                <div style={{ fontSize: "12px", opacity: 0.8 }}>{logModalItem.userName} - {logModalItem.workDate}</div>
              </div>
              <button onClick={() => setLogModalItem(null)} style={{ background: "none", border: "none", color: "#fff", fontSize: "20px", cursor: "pointer", padding: "4px" }}>×</button>
            </div>

            {/* Chat Area */}
            <div style={{ flex: 1, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
              {(() => {
                const p = parseComment(logModalItem.comment);
                const logs = p.auditLog || [];
                if (logs.length === 0) {
                  return (
                    <div style={{ textAlign: "center", color: "#8b7e74", padding: "40px 0", fontSize: "14px" }}>
                      操作ログはまだありません
                    </div>
                  );
                }
                return logs.map((log, idx) => {
                  const date = new Date(log.at);
                  const timeStr = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

                  // アクションに応じた色
                  let bubbleBg = "#fff";
                  let textColor = "#1f2937";
                  if (log.action === "approved") { bubbleBg = "#dcfce7"; textColor = "#166534"; }
                  else if (log.action === "approval_cancelled") { bubbleBg = "#fee2e2"; textColor = "#991b1b"; }
                  else if (log.action === "cancelled") { bubbleBg = "#fef2f2"; textColor = "#dc2626"; }
                  else if (log.action === "resubmission_requested") { bubbleBg = "#f3e8ff"; textColor = "#7c3aed"; }
                  else if (log.action === "admin_edited") { bubbleBg = "#eff6ff"; textColor = "#1d4ed8"; }
                  else if (log.action === "sa_return_admin") { bubbleBg = "#fef2f2"; textColor = "#be123c"; }
                  else if (log.action === "sa_return_staff") { bubbleBg = "#fff7ed"; textColor = "#c2410c"; }
                  else if (log.action === "confirmed") { bubbleBg = "#fef9c3"; textColor = "#854d0e"; }

                  return (
                    <div key={idx} style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                      <div style={{
                        background: bubbleBg, color: textColor,
                        padding: "10px 14px", borderRadius: "16px 16px 4px 16px",
                        maxWidth: "80%", fontSize: "14px", lineHeight: "1.5",
                        boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
                        wordBreak: "break-word"
                      }}>
                        <div style={{ fontWeight: "bold", fontSize: "12px", marginBottom: "4px", opacity: 0.7 }}>{log.by || "管理者"}</div>
                        {log.detail}
                      </div>
                      <div style={{ fontSize: "11px", color: "#8b7e74", marginTop: "4px", paddingRight: "4px" }}>
                        {timeStr}
                      </div>
                    </div>
                  );
                });
              })()}
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
