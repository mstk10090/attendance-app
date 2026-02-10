import React, { useEffect, useState, useMemo } from "react";
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addDays, startOfYear, endOfYear, isSaturday, isSunday } from "date-fns";
import { ja } from "date-fns/locale";
import { Search, Filter, AlertTriangle, CheckCircle, Clock, MapPin, Download, Save, X, Briefcase, FileText, Send, PieChart, BarChart, ClipboardCheck } from "lucide-react";
import "../../App.css";
import { LOCATIONS, DEPARTMENTS, EMPLOYMENT_TYPES, HOLIDAYS } from "../../constants";
import { fetchShiftData, parseCsv, SPECIAL_SHIFTS } from "../../utils/shiftParser";

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
  const raw = calcWorkMin(e);
  if (raw <= 0) return 0;
  return Math.floor(raw / 30) * 30;
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

  const actualIn = toMin(item.clockIn);
  const actualOut = toMin(item.clockOut);
  let dispatchMin = 0;
  let partTimeMin = 0;
  let dispatchStart = null, dispatchEnd = null;
  let partTimeStart = null, partTimeEnd = null;

  // Dispatch Check
  const isDispatch = shift?.isDispatch || shift?.location === "派遣" || ["朝", "早", "遅", "中"].includes(shift?.type || "");

  if (!isDispatch) {
    // Not dispatch, return standard
    return <div>{item.clockIn} - {item.clockOut}</div>;
  }

  // 新しいdispatchRange/partTimeRange方式を使用
  if (shift?.dispatchRange || shift?.partTimeRange) {
    // 派遣区間の計算
    if (shift.dispatchRange) {
      const dispStart = toMin(shift.dispatchRange.start);
      const dispEnd = toMin(shift.dispatchRange.end);
      const overlapStart = Math.max(actualIn, dispStart);
      const overlapEnd = Math.min(actualOut, dispEnd);
      if (overlapStart < overlapEnd) {
        dispatchMin = overlapEnd - overlapStart;
        dispatchStart = minToTime(overlapStart);
        dispatchEnd = minToTime(overlapEnd);
      }
    }

    // バイト区間の計算
    if (shift.partTimeRange) {
      const partStart = toMin(shift.partTimeRange.start);
      const partEnd = toMin(shift.partTimeRange.end);
      const overlapStart = Math.max(actualIn, partStart);
      const overlapEnd = Math.min(actualOut, partEnd);
      if (overlapStart < overlapEnd) {
        partTimeMin = overlapEnd - overlapStart;
        partTimeStart = minToTime(overlapStart);
        partTimeEnd = minToTime(overlapEnd);
      }
    }

    // partTimeRangeがない場合（派遣のみの日）で、派遣終了後も働いている場合
    if (!shift.partTimeRange && shift.dispatchRange) {
      const dispEnd = toMin(shift.dispatchRange.end);
      if (actualOut > dispEnd) {
        partTimeMin = actualOut - dispEnd;
        partTimeStart = minToTime(dispEnd);
        partTimeEnd = item.clockOut;
      }
    }
  } else if (shift && shift.start && shift.end) {
    // 旧方式: シフト時間ベースで計算（フォールバック）
    const shiftStart = toMin(shift.start);
    const shiftEnd = toMin(shift.end);

    const start = Math.max(shiftStart, actualIn);
    const end = Math.min(shiftEnd, actualOut);

    if (start < end) {
      dispatchMin = end - start;
      dispatchStart = minToTime(Math.max(actualIn, shiftStart));
      dispatchEnd = minToTime(Math.min(actualOut, shiftEnd));
    }

    const totalWork = calcWorkMin(item);
    partTimeMin = Math.max(0, totalWork - dispatchMin);
    if (partTimeMin > 0) {
      partTimeStart = dispatchEnd;
      partTimeEnd = item.clockOut;
    }
  }

  return (
    <div style={{ fontSize: "0.85rem", lineHeight: "1.4" }}>
      {dispatchMin > 0 && (
        <div style={{ color: "#2563eb" }}>{dispatchStart} - {dispatchEnd} (派遣 {Math.floor(dispatchMin / 60)}h{dispatchMin % 60 > 0 ? dispatchMin % 60 + 'm' : ''})</div>
      )}
      {partTimeMin > 0 && (
        <div style={{ color: "#16a34a" }}>{partTimeStart} - {partTimeEnd} (バイト {Math.floor(partTimeMin / 60)}h{partTimeMin % 60 > 0 ? partTimeMin % 60 + 'm' : ''})</div>
      )}
      {dispatchMin === 0 && partTimeMin === 0 && (
        <div>{item.clockIn} - {item.clockOut}</div>
      )}
    </div>
  );
};


export default function AdminShiftManagement() {
  /* State */
  /* State */
  const [viewMode, setViewMode] = useState("shift_check"); // shift_check, shift_import, report
  const [baseDate, setBaseDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [items, setItems] = useState([]);
  const [users, setUsers] = useState([]); // For report
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

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
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterLocation, setFilterLocation] = useState("all");
  const [filterDepartment, setFilterDepartment] = useState("all");
  const [filterShiftLocation, setFilterShiftLocation] = useState("all"); // シフトチェック用勤務地フィルタ
  const [filterShiftDepartment, setFilterShiftDepartment] = useState("all"); // シフトチェック用勤務部署フィルタ

  const [shiftMap, setShiftMap] = useState({});
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'desc' });

  // Custom Sheets State (Persisted)
  const [customSheets, setCustomSheets] = useState(() => {
    try {
      const saved = localStorage.getItem("admin_custom_sheets");
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  // Initial Load
  useEffect(() => {
    loadShifts(false);
  }, [customSheets]); // Reload if sheets change

  const loadShifts = (force = false) => {
    fetchShiftData(force, customSheets).then(data => {
      setShiftMap(data);
      if (force) alert("シフトデータを最新化しました");
    });
  };

  const handleSyncShifts = () => {
    setLoading(true);
    loadShifts(true);
    // Determine loading state end? fetchShiftData is async. 
    // We should probably await it, but for now strict reload is fine.
    setTimeout(() => setLoading(false), 1000);
  };

  const handleAddSheet = (e) => {
    e.preventDefault();
    const form = e.target;
    // Expected inputs: monthLabel(YYYY-MM), sheetId, sheetGid
    const monthLabel = form.monthLabel.value;
    const year = parseInt(monthLabel.split("-")[0]);
    const month = parseInt(monthLabel.split("-")[1]);
    const sheetId = form.sheetId.value;
    const sheetGid = form.sheetGid.value;
    const sheetName = form.sheetName.value || "sokujitsu"; // Default to sokujitsu if not provided, or custom

    if (!monthLabel || !sheetId || !sheetGid) {
      alert("必須項目を入力してください");
      return;
    }

    const newSource = {
      monthLabel, year, month, id: sheetId,
      sheets: [{
        name: sheetName,
        gid: sheetGid,
        nameColIndex: 0,
        dateRowIndex: 1,
        dataStartRowIndex: 3
      }],
      isCustom: true,
      timestamp: Date.now()
    };

    // Add to state and persist
    const newSheets = [...customSheets, newSource];
    setCustomSheets(newSheets);
    localStorage.setItem("admin_custom_sheets", JSON.stringify(newSheets));
    form.reset();
    alert("追加しました。シフトを再読み込みします。");
  };

  const handleRemoveSheet = async (ts) => {
    if (!await showConfirm("削除しますか？")) return;
    const newSheets = customSheets.filter(s => s.timestamp !== ts);
    setCustomSheets(newSheets);
    localStorage.setItem("admin_custom_sheets", JSON.stringify(newSheets));
  };

  // Edit/Action Modal State
  const [editingItem, setEditingItem] = useState(null);
  const [resubmitReason, setResubmitReason] = useState("");

  // Drag & Drop State
  const [dragActive, setDragActive] = useState(false);

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.type !== "text/csv" && !file.name.endsWith(".csv")) {
        alert("CSVファイルのみアップロード可能です");
        return;
      }

      const reader = new FileReader();
      reader.onload = function (event) {
        const text = event.target.result;
        try {
          // Parse CSV
          const config = { nameColIndex: 0, dateRowIndex: 1, dataStartRowIndex: 3 }; // Assuming standard format
          // Need year/month. Try to guess from filename or ask? 
          // For simplicity, we parse and see if it populates the current view or baseDate month.
          // Or we can parse dates from the file content if possible (row 1 normally has dates).

          // We will use the current monthLabel logic or just parse into the existing shiftMap.
          // Note: parseCsv requires 'year' and 'month'. We might need to extract from the file content or user input.
          // For this "Simple" version, let's assume it matches the currently viewed month or prompt?
          // Actually, parseCsv uses year/month to construct date strings "YYYY-MM-DD".
          // If we pass incorrect year/month, keys will be wrong.

          // Let's try to extract YYYY-MM from the file data if possible (row 1 dates usually "2/1").
          // If the CSV has "2/1", and we pass year=2026, it becomes "2026-02-01".

          // For now, use the year/month from the "Shift Import" input if filled, or default to current baseDate?
          // Let's use baseDate year/month.
          const d = new Date(baseDate);
          const year = d.getFullYear();
          const month = d.getMonth() + 1;

          const newShifts = { ...shiftMap };
          // parseCsv modifies 'newShifts' in place
          // We need to pass a config object that matches the standard format
          const sheetConfig = { nameColIndex: 0, dateRowIndex: 1, dataStartRowIndex: 3 };

          parseCsv(text, sheetConfig, year, month, newShifts, "取込データ", SPECIAL_SHIFTS);
          setShiftMap(newShifts);
          alert(`${file.name} を読み込みました (対象: ${year}年${month}月)`);
        } catch (err) {
          console.error(err);
          alert("読み込みに失敗しました");
        }
      };
      reader.readAsText(file);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const token = localStorage.getItem("token");
      const headers = {};

      // ✅ Add Authorization header if token exists
      if (token) headers["Authorization"] = token;

      const res = await fetch(API_USER_URL, { headers });

      // ✅ Handle 403 Forbidden (Token expired/missing) safely
      if (res.status === 403) {
        setMessage("❌ 認証エラー: セッションが切れました。再ログインしてください。");
        setUsers([]); // Clear users list on error
        return; // Stop processing
      }

      if (res.ok) {
        const text = await res.text();
        const outer = JSON.parse(text);
        const data = (outer.body && typeof outer.body === "string") ? JSON.parse(outer.body) : outer;
        const list = Array.isArray(data) ? data : (data.items || []);
        setUsers(list);
      }
    } catch (e) {
      console.error(e);
      setMessage("❌ スタッフ情報の取得に失敗しました");
      setUsers([]); // Clear users list on error
    }
  }

  /* Data Fetching */
  const fetchRange = useMemo(() => {
    const d = new Date(baseDate);
    if (viewMode === "report") {
      return {
        start: format(startOfMonth(d), "yyyy-MM-dd"),
        end: format(endOfMonth(d), "yyyy-MM-dd"),
      };
    }
    if (viewMode === "current") {
      // Fetch today
      return { start: format(new Date(), "yyyy-MM-dd"), end: format(new Date(), "yyyy-MM-dd") };
    }

    if (viewMode === "shift_check") {
      return { start: baseDate, end: baseDate };
    }

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
    // don't clear message here to avoid hiding fetchUsers errors
    try {
      const token = localStorage.getItem("token");
      const headers = {};
      if (token) headers["Authorization"] = token;

      const start = new Date(fetchRange.start);
      const end = new Date(fetchRange.end);
      const days = eachDayOfInterval({ start, end });

      // Chunking requests
      const results = [];
      const CHUNK_SIZE = 5;
      for (let i = 0; i < days.length; i += CHUNK_SIZE) {
        const chunk = days.slice(i, i + CHUNK_SIZE);
        const chunkResults = await Promise.all(chunk.map(async (day) => {
          const res = await fetch(`${API_BASE}/admin/attendance?date=${format(day, "yyyy-MM-dd")}`, { headers });
          if (res.status === 403) {
            throw new Error("403 Forbidden");
          }
          const d = await res.json();
          return (d.success ? d.items : []);
        }));
        results.push(...chunkResults);
        await new Promise(r => setTimeout(r, 50));
      }

      const allItems = results.flat();
      const uniqueItems = Array.from(new Map(allItems.map(item => [item.userId + item.workDate, item])).values());

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

      setItems(processedItems);
    } catch (e) {
      console.error(e);
      if (e.message === "403 Forbidden") {
        setMessage("❌ 認証エラー: セッションが切れました。再ログインしてください。");
      } else {
        setMessage("❌ データの取得に失敗しました");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAttendances();
  }, [fetchRange]);

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

      const appStatus = item._application?.status;

      if (filterStatus === "incomplete") {
        const isToday = item.workDate === format(new Date(), "yyyy-MM-dd");
        if (item.clockIn && !item.clockOut && !isToday) return true;
        return false;
      }
      if (filterStatus === "unapplied") {
        // Clocked In (and maybe Out) but NO status
        return item.clockIn && !appStatus;
      }
      if (filterStatus === "approved") return appStatus === "approved";

      if (filterStatus === "discrepancy") {
        // Late or Early check
        // If application exists, compare appliedIn/Out vs clockIn/Out
        // OR check if reason contains "寝坊" or "早退"
        const app = item._application || {};
        if (app.reason && (app.reason === "寝坊" || app.reason.includes("早退"))) return true;

        // Also check raw time diff if reason missing?
        // Using same logic as AttendanceRecord:
        // Late: clockIn > appliedIn
        // Early: clockOut < appliedOut
        if (item.clockIn && app.appliedIn && toMin(item.clockIn) > toMin(app.appliedIn)) return true;
        if (item.clockOut && app.appliedOut && toMin(item.clockOut) < toMin(app.appliedOut)) return true;

        return false;
      }

      if (filterStatus === "error") {
        if (item.clockIn && item.clockOut && toMin(item.clockIn) > toMin(item.clockOut)) return true;
        const work = calcWorkMin(item);
        if (item.clockIn && item.clockOut && work <= 0) return true;
        return false;
      }
      if (filterStatus === "night") return hasNightWork(item);
      if (filterStatus === "pending") return appStatus === "pending";
      if (filterStatus === "resubmission") return appStatus === "resubmission_requested";

      return true;
    });
  }, [items, filterName, filterStatus, filterLocation, filterDepartment]);


  /* Report Generation */
  const reportData = useMemo(() => {
    if (viewMode !== "report" || users.length === 0) return [];

    // Calculate Stats per User for the fetched range
    // 1. Identify Business Days in Range
    const start = new Date(fetchRange.start);
    const end = new Date(fetchRange.end);
    const allDays = eachDayOfInterval({ start, end });
    const businessDays = allDays.filter(d => {
      const s = format(d, "yyyy-MM-dd");
      return isWorkDay(s) && d <= new Date(); // Only past/today
    });
    const businessDates = new Set(businessDays.map(d => format(d, "yyyy-MM-dd")));

    // 2. Map Users
    return users.map(u => {
      const uItems = items.filter(i => i.userId === u.userId);
      const attendedDates = new Set(uItems.filter(i => i.clockIn).map(i => i.workDate));

      let absent = 0;
      let late = 0;
      let early = 0;
      let missingOut = 0;
      let dispatchMin = 0;
      let partTimeMin = 0;

      // シフトマップからユーザーのシフトを取得するためのキー
      const fullName = (u.lastName || "") + (u.firstName || "");
      const fullNameSpace = (u.lastName || "") + " " + (u.firstName || "");
      const fullNameWide = (u.lastName || "") + "　" + (u.firstName || "");
      const uShiftData = shiftMap[fullName] || shiftMap[fullNameSpace] || shiftMap[fullNameWide] || shiftMap[u.userName] || {};

      // 派遣ユーザーかどうかをチェック
      const isDispatchUser = u.employmentType === "派遣";

      uItems.forEach(i => {
        const app = i._application || {};
        // 早退は理由ベース
        if (app.reason && app.reason.includes("早退")) early++;
        if (i.clockIn && !i.clockOut) missingOut++;
        // Check for explicit "absent" status
        if (app.status === "absent") absent++;

        // 遅刻チェック: シフト開始時刻と実際の出勤時刻を比較
        const workDate = i.displayDate || i.workDate;
        const shift = uShiftData[workDate];
        if (shift && shift.start && i.clockIn) {
          const shiftStartMin = toMin(shift.start);
          const clockInMin = toMin(i.clockIn);
          if (clockInMin > shiftStartMin) {
            late++;
          }
        }

        // 派遣/バイト時間の計算（承認済みのレコードのみ）
        if (app.status === "approved" && i.clockIn && i.clockOut && isDispatchUser) {
          const actualIn = toMin(app.appliedIn || i.clockIn);
          const actualOut = toMin(app.appliedOut || i.clockOut);

          if (shift && (shift.dispatchRange || shift.partTimeRange)) {
            // 新しい方式: dispatchRange/partTimeRangeを使用
            if (shift.dispatchRange) {
              const dispStart = toMin(shift.dispatchRange.start);
              const dispEnd = toMin(shift.dispatchRange.end);
              const overlapStart = Math.max(actualIn, dispStart);
              const overlapEnd = Math.min(actualOut, dispEnd);
              if (overlapStart < overlapEnd) {
                dispatchMin += (overlapEnd - overlapStart);
              }
            }

            if (shift.partTimeRange) {
              const partStart = toMin(shift.partTimeRange.start);
              const partEnd = toMin(shift.partTimeRange.end);
              const overlapStart = Math.max(actualIn, partStart);
              const overlapEnd = Math.min(actualOut, partEnd);
              if (overlapStart < overlapEnd) {
                partTimeMin += (overlapEnd - overlapStart);
              }
            }

            // partTimeRangeがない場合で、派遣終了後も働いている場合
            if (!shift.partTimeRange && shift.dispatchRange) {
              const dispEnd = toMin(shift.dispatchRange.end);
              if (actualOut > dispEnd) {
                partTimeMin += (actualOut - dispEnd);
              }
            }
          } else if (shift && shift.isDispatch) {
            // 旧方式: フォールバック
            const wm = Math.max(0, actualOut - actualIn);
            dispatchMin += Math.min(wm, 8 * 60);
            partTimeMin += Math.max(0, wm - 8 * 60);
          } else {
            // シフトなしまたは派遣シフトでない場合は全てバイト
            partTimeMin += Math.max(0, actualOut - actualIn);
          }
        }
      });

      // Prescribed Days
      const m = new Date(baseDate);
      const pKey = `prescribed_${m.getFullYear()}_${m.getMonth() + 1}`;
      // uFullName等は既に上で定義済み
      const sData = shiftMap[fullName] || shiftMap[fullNameSpace] || {};
      let prescribed = sData[pKey];

      // Temporary Hardcode per user request
      if (!prescribed && pKey === "prescribed_2026_2") {
        prescribed = "18";
      }
      prescribed = prescribed || "-";

      return {
        user: u,
        absent,
        late,
        early,
        missingOut,
        prescribed,
        dispatchMin,
        partTimeMin,
        dispatchHours: `${Math.floor(dispatchMin / 60)}:${String(dispatchMin % 60).padStart(2, '0')}`,
        partTimeHours: `${Math.floor(partTimeMin / 60)}:${String(partTimeMin % 60).padStart(2, '0')}`
      };
    });
  }, [items, users, viewMode, fetchRange, shiftMap]);

  // Sorted Report Data
  const sortedReportData = useMemo(() => {
    let sortableItems = [...reportData];
    if (sortConfig.key !== null) {
      sortableItems.sort((a, b) => {
        let aVal = a[sortConfig.key];
        let bVal = b[sortConfig.key];

        // Handle User Name sorting specially
        if (sortConfig.key === 'name') {
          aVal = (a.user.lastName || "") + (a.user.firstName || "");
          bVal = (b.user.lastName || "") + (b.user.firstName || "");
        }

        if (aVal < bVal) {
          return sortConfig.direction === 'asc' ? -1 : 1;
        }
        if (aVal > bVal) {
          return sortConfig.direction === 'asc' ? 1 : -1;
        }
        return 0;
      });
    }
    return sortableItems;
  }, [reportData, sortConfig]);

  const requestSort = (key) => {
    let direction = 'desc';
    if (sortConfig.key === key && sortConfig.direction === 'desc') {
      direction = 'asc';
    }
    setSortConfig({ key, direction });
  };

  // 勤務地・勤務部署フィルタ適用後のユーザーリスト
  const filteredShiftCheckUsers = useMemo(() => {
    return users.filter(u => {
      const userName = `${u.lastName} ${u.firstName}`;
      const userShifts = shiftMap[userName];
      const shift = userShifts ? userShifts[baseDate] : null;
      // シフトに勤務地がある場合はそれを使用、なければデフォルト勤務地
      const rawLocation = (shift && !shift.isOff && shift.location) ? shift.location : (u.defaultLocation || "未記載");
      // デフォルト勤務部署
      const department = u.defaultDepartment || "未記載";

      // 勤務地フィルター（部分一致でチェック：「即日・派遣」は「即日」でも「派遣」でもヒット）
      if (filterShiftLocation !== "all" && !rawLocation.includes(filterShiftLocation)) return false;
      // 勤務部署フィルター
      if (filterShiftDepartment !== "all" && department !== filterShiftDepartment) return false;

      return true;
    });
  }, [users, filterShiftLocation, filterShiftDepartment, shiftMap, baseDate]);

  /* Mark Absent Logic */
  const handleMarkAbsent = async (e, userId, userName, dateStr) => {
    // イベントの伝播を即座に止める
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    const isConfirmed = await showConfirm(`${userName}さんを「欠勤」として登録しますか？`);
    if (!isConfirmed) return;

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
        const errorText = await res.text();
        console.error("API Error:", res.status, errorText);
        alert(`欠勤登録に失敗しました: ${res.status}`);
        return;
      }

      alert("欠勤登録しました");
      fetchAttendances();
    } catch (err) {
      console.error(err);
      alert("エラーが発生しました");
    }
  };

  const handleCancelAbsent = async (e, userId, dateStr) => {
    // イベントの伝播を即座に止める
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    const isConfirmed = await showConfirm("欠勤を取り消しますか？\n(未申請状態に戻ります)");
    if (!isConfirmed) return;

    try {
      const payload = {
        userId: userId,
        workDate: dateStr,
        clockIn: "",
        clockOut: "",
        breaks: [],
        comment: ""
      };

      const res = await fetch(`${API_BASE}/attendance/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.error("API Error:", res.status, errorText);
        alert(`欠勤取消に失敗しました: ${res.status}`);
        return;
      }

      alert("欠勤を取り消しました");
      fetchAttendances();
    } catch (err) {
      console.error(err);
      alert("エラーが発生しました");
    }
  };

  /* --- ACTIONS --- */
  const openEdit = (item) => {
    setEditingItem(item);
    setResubmitReason("");
  };

  const handleRequestResubmission = async () => {
    if (!resubmitReason.trim()) {
      alert("再提出依頼の理由を入力してください");
      return;
    }
    if (!await showConfirm("このスタッフに再提出を依頼しますか？\n(通知が送られます)")) return;

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
          comment: finalComment
        }),
      });

      alert("再提出を依頼しました");
      setEditingItem(null);
      fetchAttendances();

    } catch (e) {
      alert("エラーが発生しました");
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (targetItem = null) => {
    if (!await showConfirm("承認しますか？")) return;
    setLoading(true);
    try {
      const item = targetItem || editingItem;
      const p = parseComment(item.comment);
      const newApp = { ...p.application, status: 'approved' };

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
          comment: finalComment
        }),
      });

      alert("承認しました");
      setEditingItem(null);
      fetchAttendances();
    } catch (e) {
      alert("処理に失敗しました");
    } finally {
      setLoading(false);
    }
  };


  /* JSX */
  return (
    <div className="admin-container" style={{ paddingBottom: "100px" }}>
      {/* Header & Controls */}
      <div className="card">
        {message && (
          <div style={{
            padding: "12px 16px",
            background: message.includes("❌") ? "#fef2f2" : "#ecfdf5",
            color: message.includes("❌") ? "#991b1b" : "#065f46",
            marginBottom: "16px",
            borderRadius: "8px",
            border: "1px solid",
            borderColor: message.includes("❌") ? "#fecaca" : "#a7f3d0",
            display: "flex", alignItems: "center", gap: "8px", fontWeight: "bold"
          }}>
            {message.includes("❌") ? <AlertTriangle size={20} /> : <CheckCircle size={20} />}
            {message.replace("✅ ", "").replace("❌ ", "")}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <h2 style={{ fontSize: "1.2rem", fontWeight: "bold", display: "flex", alignItems: "center", gap: "8px" }}>
            <Clock size={24} /> 勤怠管理ダッシュボード
          </h2>
          <div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "10px" }}>
              <div style={{ display: "flex", background: "#f3f4f6", padding: "4px", borderRadius: "8px" }}>
                {[
                  { id: "shift_check", icon: <ClipboardCheck size={14} />, label: "シフト確認" },
                  { id: "gantt", icon: <BarChart size={14} />, label: "ガントチャート" },
                  { id: "shift_import", icon: <FileText size={14} />, label: "シフト取込" },
                  { id: "report", icon: <BarChart size={14} />, label: "レポート" }
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
              if (viewMode === "shift_check" || viewMode === "daily" || viewMode === "gantt") setBaseDate(format(addDays(d, -1), "yyyy-MM-dd"));
              if (viewMode === "weekly") setBaseDate(format(addDays(d, -7), "yyyy-MM-dd"));
              if (viewMode === "monthly" || viewMode === "report") setBaseDate(format(addDays(d, -30), "yyyy-MM-dd"));
            }}>{"<"}</button>

            <span style={{ fontWeight: "bold", fontSize: "1.1rem" }}>
              {(viewMode === "shift_check" || viewMode === "gantt") && format(new Date(baseDate), "yyyy年M月d日 (E)", { locale: ja })}
              {viewMode !== "shift_check" && viewMode !== "gantt" && `${fetchRange.start} 〜 ${fetchRange.end}`}
            </span>

            <button className="icon-btn" onClick={() => {
              const d = new Date(baseDate);
              if (viewMode === "shift_check" || viewMode === "daily" || viewMode === "gantt") setBaseDate(format(addDays(d, 1), "yyyy-MM-dd"));
              if (viewMode === "weekly") setBaseDate(format(addDays(d, 7), "yyyy-MM-dd"));
              if (viewMode === "monthly" || viewMode === "report") setBaseDate(format(addDays(d, 30), "yyyy-MM-dd"));
            }}>{">"}</button>
          </div>
        )}

        {/* Filters - shift_checkモードでは非表示（独自フィルタを使用） */}
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

            <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <Filter size={16} color="#6b7280" />
              <select className="input" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                <option value="all">全ステータス</option>
                <option value="unapplied">⚠️ 未申請</option>
                <option value="pending">⏳ 承認待ち</option>
                <option value="approved">✅ 承認済み</option>
                <option value="incomplete">🚫 未退勤 (打刻忘れ)</option>
                <option value="discrepancy">🕒 勤怠時間ずれ</option>
                <option value="resubmission">↩️ 再提出依頼中</option>
                <option value="error">❌ 時間異常</option>
                <option value="night">🌙 深夜勤務あり</option>
              </select>
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

      {/* --- REPORT VIEW --- */}
      {viewMode === "report" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          {/* Summary Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px" }}>
            <div className="card" style={{ textAlign: "center", padding: "20px" }}>
              <div style={{ fontSize: "0.9rem", color: "#6b7280", marginBottom: "4px" }}>対象スタッフ</div>
              <div style={{ fontSize: "1.8rem", fontWeight: "bold", color: "#111827" }}>{users.length}<span style={{ fontSize: "1rem", fontWeight: "normal" }}>名</span></div>
            </div>
            <div className="card" style={{ textAlign: "center", padding: "20px" }}>
              <div style={{ fontSize: "0.9rem", color: "#6b7280", marginBottom: "4px" }}>総遅刻数</div>
              <div style={{ fontSize: "1.8rem", fontWeight: "bold", color: "#f59e0b" }}>
                {reportData.reduce((acc, curr) => acc + curr.late, 0)}<span style={{ fontSize: "1rem", fontWeight: "normal" }}>件</span>
              </div>
            </div>
            <div className="card" style={{ textAlign: "center", padding: "20px" }}>
              <div style={{ fontSize: "0.9rem", color: "#6b7280", marginBottom: "4px" }}>総早退数</div>
              <div style={{ fontSize: "1.8rem", fontWeight: "bold", color: "#f59e0b" }}>
                {reportData.reduce((acc, curr) => acc + curr.early, 0)}<span style={{ fontSize: "1rem", fontWeight: "normal" }}>件</span>
              </div>
            </div>

          </div>

          <div className="card" style={{ overflow: "hidden" }}>
            <h3 style={{ fontSize: "1.1rem", fontWeight: "bold", marginBottom: "16px", color: "#4b5563", padding: "16px 16px 0" }}>
              詳細レポート
            </h3>
            {loading ? (
              <div style={{ padding: "40px", textAlign: "center" }}>集計中...</div>
            ) : (
              <div className="table-wrap" style={{ maxHeight: "600px", overflowY: "auto" }}>
                <table className="admin-table" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
                  <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
                    <tr>
                      <th onClick={() => requestSort('name')} style={{ cursor: "pointer", background: "#f9fafb", padding: "12px 16px", borderBottom: "2px solid #e5e7eb" }}>
                        氏名 {sortConfig.key === 'name' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}
                      </th>
                      <th style={{ background: "#f9fafb", padding: "12px 16px", borderBottom: "2px solid #e5e7eb" }}>雇用形態</th>
                      <th style={{ background: "#f9fafb", padding: "12px 16px", borderBottom: "2px solid #e5e7eb" }}>部署/拠点</th>
                      <th style={{ background: "#f9fafb", padding: "12px 16px", borderBottom: "2px solid #e5e7eb", textAlign: "center" }}>規定日数</th>
                      <th onClick={() => requestSort('dispatchMin')} style={{ cursor: "pointer", background: "#eff6ff", padding: "12px 16px", borderBottom: "2px solid #e5e7eb", textAlign: "center", color: "#2563eb" }}>
                        派遣時間 {sortConfig.key === 'dispatchMin' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}
                      </th>
                      <th onClick={() => requestSort('partTimeMin')} style={{ cursor: "pointer", background: "#f0fdf4", padding: "12px 16px", borderBottom: "2px solid #e5e7eb", textAlign: "center", color: "#16a34a" }}>
                        バイト時間 {sortConfig.key === 'partTimeMin' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}
                      </th>
                      <th onClick={() => requestSort('absent')} style={{ cursor: "pointer", background: "#f9fafb", padding: "12px 16px", borderBottom: "2px solid #e5e7eb", textAlign: "center" }}>
                        欠勤 {sortConfig.key === 'absent' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}
                      </th>
                      <th onClick={() => requestSort('late')} style={{ cursor: "pointer", background: "#f9fafb", padding: "12px 16px", borderBottom: "2px solid #e5e7eb", textAlign: "center" }}>
                        遅刻 {sortConfig.key === 'late' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}
                      </th>
                      <th onClick={() => requestSort('early')} style={{ cursor: "pointer", background: "#f9fafb", padding: "12px 16px", borderBottom: "2px solid #e5e7eb", textAlign: "center" }}>
                        早退 {sortConfig.key === 'early' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}
                      </th>
                      <th onClick={() => requestSort('missingOut')} style={{ cursor: "pointer", background: "#f9fafb", padding: "12px 16px", borderBottom: "2px solid #e5e7eb", textAlign: "center" }}>
                        打刻漏れ {sortConfig.key === 'missingOut' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedReportData.map((r, idx) => (
                      <tr key={r.user.userId} style={{ background: idx % 2 === 0 ? "#fff" : "#fbfbfb" }}>
                        <td style={{ fontWeight: "bold", padding: "12px 16px", borderBottom: "1px solid #f3f4f6" }}>
                          {r.user.lastName} {r.user.firstName}
                        </td>
                        <td style={{ padding: "12px 16px", borderBottom: "1px solid #f3f4f6" }}>{r.user.employmentType || "-"}</td>
                        <td style={{ padding: "12px 16px", borderBottom: "1px solid #f3f4f6" }}>{r.user.defaultDepartment}/{r.user.defaultLocation}</td>
                        <td style={{ textAlign: "center", padding: "12px 16px", borderBottom: "1px solid #f3f4f6", fontWeight: "bold", color: "#374151" }}>
                          {r.prescribed || "-"}
                        </td>
                        <td style={{ textAlign: "center", padding: "12px 16px", borderBottom: "1px solid #f3f4f6", background: "#f8faff" }}>
                          {r.user.employmentType === "派遣" && r.dispatchMin > 0 ? (
                            <span style={{ fontWeight: "bold", color: "#2563eb" }}>{r.dispatchHours}</span>
                          ) : <span style={{ color: "#d1d5db" }}>-</span>}
                        </td>
                        <td style={{ textAlign: "center", padding: "12px 16px", borderBottom: "1px solid #f3f4f6", background: "#f8fff8" }}>
                          {r.user.employmentType === "派遣" && r.partTimeMin > 0 ? (
                            <span style={{ fontWeight: "bold", color: "#16a34a" }}>{r.partTimeHours}</span>
                          ) : <span style={{ color: "#d1d5db" }}>-</span>}
                        </td>
                        <td style={{ textAlign: "center", padding: "12px 16px", borderBottom: "1px solid #f3f4f6" }}>
                          {r.absent > 0 ? <span className="status-badge red" style={{ minWidth: "30px", display: "inline-block" }}>{r.absent}</span> : <span style={{ color: "#d1d5db" }}>-</span>}
                        </td>
                        <td style={{ textAlign: "center", padding: "12px 16px", borderBottom: "1px solid #f3f4f6" }}>
                          {r.late > 0 ? <span className="status-badge orange" style={{ minWidth: "30px", display: "inline-block" }}>{r.late}</span> : <span style={{ color: "#d1d5db" }}>-</span>}
                        </td>
                        <td style={{ textAlign: "center", padding: "12px 16px", borderBottom: "1px solid #f3f4f6" }}>
                          {r.early > 0 ? <span className="status-badge orange" style={{ minWidth: "30px", display: "inline-block" }}>{r.early}</span> : <span style={{ color: "#d1d5db" }}>-</span>}
                        </td>
                        <td style={{ textAlign: "center", padding: "12px 16px", borderBottom: "1px solid #f3f4f6" }}>
                          {r.missingOut > 0 ? <span className="status-badge red" style={{ minWidth: "30px", display: "inline-block" }}>{r.missingOut}</span> : <span style={{ color: "#d1d5db" }}>-</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : viewMode === "current" ? (
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
      ) : viewMode === "shift_check" ? (
        /* --- SHIFT CHECK VIEW --- */
        <div className="card">
          <div style={{ marginBottom: "20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ fontSize: "1.1rem", fontWeight: "bold", color: "#4b5563" }}>
              シフト vs 出勤状況確認 ({baseDate})
            </h3>
            <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ fontSize: "0.85rem", color: "#6b7280" }}>勤務地:</label>
              <select
                value={filterShiftLocation}
                onChange={e => setFilterShiftLocation(e.target.value)}
                style={{ padding: "6px 10px", borderRadius: "4px", border: "1px solid #d1d5db", fontSize: "0.9rem" }}
              >
                <option value="all">すべて</option>
                {LOCATIONS.map(loc => (
                  <option key={loc} value={loc}>{loc}</option>
                ))}
              </select>
              <label style={{ fontSize: "0.85rem", color: "#6b7280", marginLeft: "10px" }}>勤務部署:</label>
              <select
                value={filterShiftDepartment}
                onChange={e => setFilterShiftDepartment(e.target.value)}
                style={{ padding: "6px 10px", borderRadius: "4px", border: "1px solid #d1d5db", fontSize: "0.9rem" }}
              >
                <option value="all">すべて</option>
                {DEPARTMENTS.map(dept => (
                  <option key={dept} value={dept}>{dept}</option>
                ))}
              </select>
            </div>
          </div>
          {loading ? (
            <div style={{ padding: "40px", textAlign: "center" }}>読み込み中...</div>
          ) : (
            <div className="table-wrap" style={{ maxHeight: "60vh", overflowY: "auto" }}>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th style={{ padding: "12px", width: "150px" }}>氏名</th>
                    <th style={{ padding: "12px", width: "150px" }}>シフト予定</th>
                    <th style={{ padding: "12px", width: "100px" }}>予定地</th>
                    <th style={{ padding: "12px", width: "100px" }}>勤務部署</th>
                    <th style={{ padding: "12px", width: "100px" }}>状態</th>
                    <th style={{ padding: "12px", width: "150px" }}>実績 (出-退)</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredShiftCheckUsers.map(u => {
                    const userName = `${u.lastName} ${u.firstName}`;
                    // Get Shift
                    const userShifts = shiftMap[userName];
                    const shift = userShifts ? userShifts[baseDate] : null;

                    // Get Attendance
                    const item = items.find(i => i.userId === u.userId && i.workDate === baseDate);

                    if (!shift && !item) return null; // Skip users with neither shift nor attendance

                    // Status Logic
                    let statusBadge = null;
                    let rowBg = "#fff";

                    if (shift) {
                      if (item && item.clockIn) {
                        // Working or Finished
                        if (item.clockOut) {
                          statusBadge = <span className="status-badge green">退勤済</span>;
                        } else {
                          // Check Late
                          const shiftStart = toMin(shift.start);
                          const actualIn = toMin(item.clockIn);
                          if (actualIn > shiftStart) {
                            statusBadge = <span className="status-badge orange">遅刻/出勤</span>;
                            rowBg = "#fff7ed";
                          } else {
                            statusBadge = <span className="status-badge green">出勤中</span>;
                            rowBg = "#f0fdf4";
                          }
                        }
                      } else {
                        // No clock in yet
                        const now = new Date();
                        const targetDate = new Date(baseDate);
                        // If past date, Absent. If today, check time.
                        const isPast = targetDate < new Date(format(now, "yyyy-MM-dd"));
                        if (isPast) {
                          statusBadge = <span className="status-badge red">欠勤</span>;
                          rowBg = "#fef2f2";
                        } else {
                          // Today: check if current time > shift start
                          const nowMin = now.getHours() * 60 + now.getMinutes();
                          const shiftStart = toMin(shift.start);
                          if (nowMin > shiftStart) {
                            statusBadge = <span className="status-badge red">遅刻(未出勤)</span>;
                            rowBg = "#fef2f2";
                          } else {
                            statusBadge = <span className="status-badge gray">出勤前</span>;
                          }
                        }
                      }
                    } else {
                      // No shift but attendance exists
                      statusBadge = <span className="status-badge orange" style={{ background: "#ffedd5", color: "#c2410c" }}>シフト外</span>;
                    }

                    // 欠勤・休みの場合のグレーアウト判定
                    const isAbsent = item && item._application?.status === "absent";
                    const isOffDay = shift && shift.isOff;
                    const shouldGrayOut = isAbsent || isOffDay;

                    // 予定地: デフォルト勤務地を使用（シフトのlocationではなく）
                    const displayLocation = u.defaultLocation || "未記載";
                    // 勤務部署: デフォルト勤務部署から取得
                    const displayDepartment = u.defaultDepartment || "未記載";

                    return (
                      <tr key={u.userId} style={{
                        background: shouldGrayOut ? "#e5e7eb" : rowBg,
                        opacity: shouldGrayOut ? 0.6 : 1
                      }}>
                        <td style={{ padding: "12px", fontWeight: "bold" }}>{userName}</td>
                        <td style={{ padding: "12px" }}>
                          {shift ? (
                            <span style={{ fontWeight: shift.isOff ? "bold" : "normal", color: shift.isOff ? "#ef4444" : "inherit" }}>
                              {shift.isOff ? "休み" : (
                                <>
                                  {`${shift.start} - ${shift.end}`}
                                  {/* 派遣シフトの場合はシフト種別を表示 */}
                                  {shift.isDispatch && shift.original && (() => {
                                    // originalから最初のシフトコード（朝・早・中・遅・深）を抽出
                                    const firstCode = shift.original.split(/[\s\/]/)[0]?.trim();
                                    if (["朝", "早", "中", "遅", "深"].includes(firstCode)) {
                                      return (
                                        <span style={{
                                          marginLeft: "6px",
                                          padding: "2px 6px",
                                          borderRadius: "4px",
                                          fontSize: "11px",
                                          fontWeight: "bold",
                                          background: firstCode === "朝" ? "#fef3c7" :
                                            firstCode === "早" ? "#d1fae5" :
                                              firstCode === "中" ? "#dbeafe" :
                                                firstCode === "遅" ? "#fce7f3" :
                                                  firstCode === "深" ? "#1e293b" : "#e5e7eb",
                                          color: firstCode === "深" ? "#fff" : "#374151"
                                        }}>
                                          {firstCode}
                                        </span>
                                      );
                                    }
                                    return null;
                                  })()}
                                </>
                              )}
                            </span>
                          ) : (
                            <span style={{ color: "#aaa" }}>-</span>
                          )}
                        </td>
                        <td style={{ padding: "12px" }}>{displayLocation}</td>
                        <td style={{ padding: "12px" }}>{displayDepartment}</td>
                        <td style={{ padding: "12px" }}>{statusBadge}</td>
                        <td style={{ padding: "12px" }}>
                          {item ? (
                            <div>
                              {calcSplitDisplay(item, shift)}
                            </div>
                          ) : "-"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

      ) : viewMode === "gantt" ? (
        /* --- GANTT CHART VIEW --- */
        <div className="card" style={{ padding: "24px" }}>
          <h3 style={{ fontSize: "1.1rem", fontWeight: "bold", marginBottom: "16px", color: "#4b5563" }}>
            ガントチャート - {format(new Date(baseDate), "yyyy年M月d日 (E)", { locale: ja })}
          </h3>

          {/* 勤務地・勤務部署フィルタ */}
          <div style={{ marginBottom: "16px", display: "flex", gap: "20px", alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <label style={{ fontSize: "13px", color: "#6b7280" }}>勤務地:</label>
              <select
                value={filterShiftLocation}
                onChange={(e) => setFilterShiftLocation(e.target.value)}
                style={{ padding: "6px 12px", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "13px" }}
              >
                <option value="all">すべて</option>
                {LOCATIONS.map(loc => <option key={loc} value={loc}>{loc}</option>)}
              </select>
            </div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <label style={{ fontSize: "13px", color: "#6b7280" }}>部署:</label>
              <select
                value={filterShiftDepartment}
                onChange={(e) => setFilterShiftDepartment(e.target.value)}
                style={{ padding: "6px 12px", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "13px" }}
              >
                <option value="all">すべて</option>
                {DEPARTMENTS.map(dept => <option key={dept} value={dept}>{dept}</option>)}
              </select>
            </div>
          </div>

          {/* ガントチャート本体 */}
          <div style={{ overflowX: "auto", maxHeight: "60vh", overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
              <thead>
                <tr style={{ background: "#f3f4f6" }}>
                  <th style={{ padding: "8px", textAlign: "left", minWidth: "100px", borderRight: "1px solid #e5e7eb", position: "sticky", left: 0, background: "#f3f4f6", zIndex: 10 }}>氏名</th>
                  <th style={{ padding: "8px", textAlign: "center", minWidth: "60px", borderRight: "1px solid #e5e7eb" }}>シフト</th>
                  {/* 7時〜24時の時間ヘッダー */}
                  {Array.from({ length: 18 }, (_, i) => i + 7).map(hour => (
                    <th key={hour} style={{ padding: "4px", textAlign: "center", minWidth: "30px", borderRight: "1px solid #e5e7eb", fontSize: "10px" }}>
                      {hour}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(() => {
                  // フィルタリングされたユーザー（シフトがある人のみ）
                  const ganttUsers = users.filter(u => {
                    // 勤務地フィルタ
                    if (filterShiftLocation !== "all" && u.defaultLocation !== filterShiftLocation) return false;
                    // 勤務部署フィルタ
                    if (filterShiftDepartment !== "all" && u.defaultDepartment !== filterShiftDepartment) return false;
                    // シフトがあるかチェック
                    const userName = `${u.lastName} ${u.firstName}`;
                    const userShifts = shiftMap[userName];
                    const shift = userShifts ? userShifts[baseDate] : null;
                    if (!shift || !shift.start || !shift.end) return false; // シフトがない人は除外
                    return true;
                  });

                  return ganttUsers.map(u => {
                    const userName = `${u.lastName} ${u.firstName}`;
                    const userShifts = shiftMap[userName];
                    const shift = userShifts ? userShifts[baseDate] : null;

                    // シフト時間をバーに変換
                    let shiftStart = null;
                    let shiftEnd = null;
                    if (shift && shift.start && shift.end) {
                      shiftStart = toMin(shift.start);
                      shiftEnd = toMin(shift.end);
                    }

                    return (
                      <tr key={u.userId} style={{ borderBottom: "1px solid #f3f4f6" }}>
                        <td style={{ padding: "8px", fontWeight: "500", borderRight: "1px solid #e5e7eb", position: "sticky", left: 0, background: "#fff", zIndex: 5 }}>
                          {userName}
                        </td>
                        <td style={{ padding: "4px 8px", textAlign: "center", fontSize: "11px", color: shift ? "#2563eb" : "#9ca3af", borderRight: "1px solid #e5e7eb" }}>
                          {shift ? (
                            <>
                              {`${shift.start}-${shift.end}`}
                              {/* 派遣シフトの場合はシフト種別を表示 */}
                              {shift.isDispatch && shift.original && SPECIAL_SHIFTS[shift.original.trim()] && (
                                <span style={{
                                  marginLeft: "4px",
                                  padding: "1px 4px",
                                  borderRadius: "3px",
                                  fontSize: "9px",
                                  fontWeight: "bold",
                                  background: shift.original.trim() === "朝" ? "#fef3c7" :
                                    shift.original.trim() === "早" ? "#d1fae5" :
                                      shift.original.trim() === "中" ? "#dbeafe" :
                                        shift.original.trim() === "遅" ? "#fce7f3" :
                                          shift.original.trim() === "深" ? "#1e293b" : "#e5e7eb",
                                  color: shift.original.trim() === "深" ? "#fff" : "#374151"
                                }}>
                                  {shift.original.trim()}
                                </span>
                              )}
                            </>
                          ) : "-"}
                        </td>
                        {/* 7時〜24時の各時間セル */}
                        {Array.from({ length: 18 }, (_, i) => i + 7).map(hour => {
                          const cellStart = hour * 60;
                          const cellEnd = (hour + 1) * 60;

                          // シフトがこの時間帯にあるかチェック
                          let hasShift = false;
                          if (shiftStart !== null && shiftEnd !== null) {
                            hasShift = shiftStart < cellEnd && shiftEnd > cellStart;
                          }

                          return (
                            <td
                              key={hour}
                              style={{
                                padding: "4px",
                                borderRight: "1px solid #e5e7eb",
                                background: hasShift ? "#60a5fa" : "#fff",
                                minHeight: "24px"
                              }}
                            />
                          );
                        })}
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
        </div>

      ) : null}

      {/* --- SHIFT IMPORT TAB --- */}
      {viewMode === "shift_import" && (
        <div className="card">
          <h3 style={{ fontSize: "1.1rem", fontWeight: "bold", marginBottom: "16px", color: "#4b5563" }}>
            シフトデータの管理
          </h3>

          <div style={{ marginBottom: "24px", padding: "16px", background: "#f3f4f6", borderRadius: "8px" }}>
            <h4 style={{ marginBottom: "12px", fontSize: "0.9rem" }}>1. 手動更新 (Manual Sync)</h4>
            <div style={{ fontSize: "0.85rem", color: "#666", marginBottom: "8px" }}>
              通常はキャッシュされます。スプレッドシートを更新した直後など、最新データを強制的に取得する場合はこちらを押してください。
            </div>
            <button
              onClick={handleSyncShifts}
              disabled={loading}
              className="btn-blue"
              style={{ padding: "8px 16px", fontSize: "0.9rem", borderRadius: "4px", border: "none", cursor: "pointer" }}
            >
              {loading ? "更新中..." : "最新のシフトを取得 (Sync Now)"}
            </button>
          </div>

          {/* DROP ZONE */}
          <div
            style={{
              marginBottom: "24px", padding: "24px",
              background: dragActive ? "#eff6ff" : "#fff",
              border: dragActive ? "2px dashed #2563eb" : "2px dashed #ccc",
              borderRadius: "8px", textAlign: "center",
              transition: "all 0.2s"
            }}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          >
            <FileText size={48} color={dragActive ? "#2563eb" : "#9ca3af"} style={{ marginBottom: "8px" }} />
            <div style={{ fontSize: "1rem", fontWeight: "bold", color: dragActive ? "#2563eb" : "#4b5563" }}>
              {dragActive ? "ドロップして読み込み" : "CSVファイルをドラッグ＆ドロップ"}
            </div>
            <div style={{ fontSize: "0.8rem", color: "#6b7280", marginTop: "4px" }}>
              一時的にシフトを表示します (ページをリロードすると消えます)<br />
              対象年月は現在の表示 ({new Date(baseDate).getFullYear()}年{new Date(baseDate).getMonth() + 1}月) として読み込まれます
            </div>
          </div>

          <div style={{ marginBottom: "24px", padding: "16px", background: "#fff", border: "1px solid #e5e7eb", borderRadius: "8px" }}>
            <h4 style={{ marginBottom: "12px", fontSize: "0.9rem" }}>2. 新しいシートの追加</h4>
            <form onSubmit={handleAddSheet} style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "flex-end" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "4px" }}>年月 (YYYY-MM)</label>
                <input type="month" name="monthLabel" required style={{ padding: "6px", border: "1px solid #ccc", borderRadius: "4px" }} />
              </div>
              <div style={{ flex: 1, minWidth: "200px" }}>
                <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "4px" }}>スプレッドシートID</label>
                <input type="text" name="sheetId" placeholder="docs.google.com/spreadsheets/d/THIS_ID/..." required style={{ width: "100%", padding: "6px", border: "1px solid #ccc", borderRadius: "4px" }} />
              </div>
              <div style={{ width: "120px" }}>
                <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "4px" }}>GID (シートID)</label>
                <input type="text" name="sheetGid" placeholder="0" required style={{ width: "100%", padding: "6px", border: "1px solid #ccc", borderRadius: "4px" }} />
              </div>
              <div style={{ width: "100px" }}>
                <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "4px" }}>シート種類</label>
                <select name="sheetName" style={{ padding: "6px", border: "1px solid #ccc", borderRadius: "4px", width: "100%" }}>
                  <option value="sokujitsu">即日</option>
                  <option value="kaitori">買取</option>
                  <option value="haken">派遣</option>
                  <option value="koukoku">広告</option>
                  <option value="ceo">CEO</option>
                </select>
              </div>
              <button type="submit" className="btn-green" style={{ padding: "8px 16px", fontSize: "0.9rem", borderRadius: "4px", border: "none", cursor: "pointer", height: "34px" }}>
                追加
              </button>
            </form>
          </div>

          <div>
            <h4 style={{ marginBottom: "12px", fontSize: "0.9rem" }}>登録済みカスタムシート</h4>
            {customSheets.length === 0 && <div style={{ color: "#888", fontSize: "0.85rem" }}>追加されたシートはありません</div>}
            <ul style={{ listStyle: "none", padding: 0 }}>
              {customSheets.map((s, idx) => (
                <li key={idx} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px", borderBottom: "1px solid #eee", fontSize: "0.9rem" }}>
                  <div>
                    <strong>{s.monthLabel}</strong> - {s.sheets[0]?.name} (GID: {s.sheets[0]?.gid})<br />
                    <span style={{ fontSize: "0.75rem", color: "#999" }}>ID: {s.id}</span>
                  </div>
                  <button
                    onClick={() => handleRemoveSheet(s.timestamp)}
                    style={{ color: "#ef4444", background: "none", border: "none", cursor: "pointer", fontSize: "0.8rem", textDecoration: "underline" }}
                  >
                    削除
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Action Modal */}
      {
        editingItem && (
          <div className="modal-overlay">
            <div className="modal-content" style={{ maxWidth: "500px" }}>
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

                    {/* Actual Row */}
                    <div style={{ fontWeight: "bold", fontSize: "14px", color: "#374151" }}>実績</div>
                    <div style={{ fontFamily: "monospace", textAlign: "center", fontSize: "15px" }}>
                      {editingItem.clockIn || "-"} ~ {editingItem.clockOut || "-"}
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

              <hr style={{ margin: "0 0 20px 0", border: "none", borderTop: "1px solid #eee" }} />

              <h4>再提出依頼 (修正願い)</h4>
              <p style={{ fontSize: "0.85rem", color: "#666", marginBottom: "8px" }}>
                承認できない場合は、理由を入力して再提出を依頼してください。
              </p>
              <textarea
                className="input"
                placeholder="例: 退勤時間の入力が間違っているようです"
                value={resubmitReason}
                onChange={e => setResubmitReason(e.target.value)}
                style={{ width: "100%", height: "80px", marginBottom: "12px" }}
              />
              <button className="btn btn-outline" onClick={handleRequestResubmission} style={{ width: "100%", color: "#7c3aed", borderColor: "#7c3aed" }}>
                <Send size={18} style={{ marginRight: 6 }} /> 再提出を依頼する
              </button>

              <button className="btn btn-gray" onClick={() => setEditingItem(null)} style={{ width: "100%", marginTop: "16px" }}>
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

      <style>{`
          .status-badge.purple { background: #f3e8ff; color: #7c3aed; border: 1px solid #d8b4fe; }
          .row-purple { background: #fcf4ff; }
          .toggle-btn { margin-right: 4px; padding: 4px 8px; border: 1px solid #ddd; background: #fff; cursor: pointer; }
      `}</style>
    </div >
  );
}
