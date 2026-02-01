import React, { useEffect, useState, useMemo } from "react";
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addDays, startOfYear, endOfYear, isSaturday, isSunday } from "date-fns";
import { ja } from "date-fns/locale";
import { Search, Filter, AlertTriangle, CheckCircle, Clock, MapPin, Download, Save, X, Briefcase, FileText, Send, PieChart, BarChart, ClipboardCheck } from "lucide-react";
import "../../App.css";
import { LOCATIONS, DEPARTMENTS, EMPLOYMENT_TYPES, HOLIDAYS } from "../../constants";

const API_BASE = "https://lfsu60xvw7.execute-api.ap-northeast-1.amazonaws.com";
const API_USER_URL = `${API_BASE}/users`;

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

  const totalWork = calcWorkMin(item);
  let dispatchMin = 0;
  let partTimeMin = 0;

  // Dispatch Check
  // "朝","早","遅","中" imply Dispatch if matched.
  // Also shift.location === "派遣"
  const isDispatch = shift?.isDispatch || shift?.location === "派遣" || ["朝", "早", "遅", "中"].includes(shift?.type || "");

  if (isDispatch && shift && shift.start && shift.end) {
    const shiftStart = toMin(shift.start);
    const shiftEnd = toMin(shift.end);
    const actualIn = toMin(item.clockIn);
    const actualOut = toMin(item.clockOut);

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

      dispatchMin = Math.max(0, (end - start) - breakInOverlap);
    }
    partTimeMin = Math.max(0, totalWork - dispatchMin);

  } else {
    // Not dispatch, return standard
    return <div>{item.clockIn} - {item.clockOut}</div>;
  }

  // Visual Display Logic
  const splitPointMin = Math.min(toMin(shift.end), toMin(item.clockOut));
  const splitPoint = minToTime(splitPointMin);

  return (
    <div style={{ fontSize: "0.85rem", lineHeight: "1.4" }}>
      {dispatchMin > 0 && (
        <div>{item.clockIn} - {splitPoint} (派遣)</div>
      )}
      {partTimeMin > 0 && (
        <div style={{ color: "#16a34a" }}>{splitPoint} - {item.clockOut} (バイト)</div>
      )}
      {dispatchMin === 0 && partTimeMin === 0 && (
        <div>{item.clockIn} - {item.clockOut} (派遣)</div>
      )}
    </div>
  );
};


export default function AdminAttendance() {
  /* State */
  const [viewMode, setViewMode] = useState("daily"); // daily, weekly, monthly, report, current
  const [baseDate, setBaseDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [items, setItems] = useState([]);
  const [users, setUsers] = useState([]); // For report
  const [loading, setLoading] = useState(false);

  // Filter States
  const [filterName, setFilterName] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterLocation, setFilterLocation] = useState("all");
  const [filterDepartment, setFilterDepartment] = useState("all");

  const [shiftMap, setShiftMap] = useState({});
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'desc' });

  useEffect(() => {
    import("../../utils/shiftParser").then(mod => {
      mod.fetchShiftData().then(data => setShiftMap(data));
    });
  }, []);

  // Edit/Action Modal State
  const [editingItem, setEditingItem] = useState(null);
  const [resubmitReason, setResubmitReason] = useState("");

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const res = await fetch(API_USER_URL);
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
      alert("データの取得に失敗しました");
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
      businessDates.forEach(d => {
        if (!attendedDates.has(d)) absent++;
      });

      let late = 0;
      let early = 0;
      let missingOut = 0;
      uItems.forEach(i => {
        const app = i._application || {};
        if (app.reason && app.reason.includes("遅刻")) late++;
        if (app.reason && app.reason.includes("早退")) early++;
        if (i.clockIn && !i.clockOut) missingOut++;
      });

      return {
        user: u,
        absent,
        late,
        early,
        missingOut
      };
    });
  }, [items, users, viewMode, fetchRange]);

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
    if (!window.confirm(`${userName}さんを「欠勤」として登録しますか？`)) return;

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
  const openEdit = (item) => {
    setEditingItem(item);
    setResubmitReason("");
  };

  const handleRequestResubmission = async () => {
    if (!resubmitReason.trim()) {
      alert("再提出依頼の理由を入力してください");
      return;
    }
    if (!window.confirm("このスタッフに再提出を依頼しますか？\n(通知が送られます)")) return;

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
    if (!window.confirm("承認しますか？")) return;
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <h2 style={{ fontSize: "1.2rem", fontWeight: "bold", display: "flex", alignItems: "center", gap: "8px" }}>
            <Clock size={24} /> 勤怠管理ダッシュボード
          </h2>
          <div>
            {/* View Mode Toggle (Segmented Control) */}
            <div style={{ display: "flex", background: "#f3f4f6", padding: "4px", borderRadius: "8px" }}>
              {[
                { id: "current", icon: <CheckCircle size={14} />, label: "現在出勤中" },
                { id: "daily", icon: null, label: "日次" },
                { id: "weekly", icon: null, label: "週次" },
                { id: "monthly", icon: null, label: "月次" },
                { id: "shift_check", icon: <ClipboardCheck size={14} />, label: "シフト確認" },
                { id: "report", icon: <BarChart size={14} />, label: "レポート" }
              ].map(mode => (
                <button
                  key={mode.id}
                  onClick={() => setViewMode(mode.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: "6px",
                    padding: "6px 16px",
                    fontSize: "14px", fontWeight: "500",
                    borderRadius: "6px",
                    border: "none",
                    background: viewMode === mode.id ? "#fff" : "transparent",
                    color: viewMode === mode.id ? "#2563eb" : "#6b7280",
                    boxShadow: viewMode === mode.id ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                    cursor: "pointer",
                    transition: "all 0.2s"
                  }}
                >
                  {mode.icon} {mode.label}
                </button>
              ))}
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
              if (viewMode === "monthly" || viewMode === "report") setBaseDate(format(addDays(d, -30), "yyyy-MM-dd"));
            }}>{"<"}</button>

            <span style={{ fontWeight: "bold", fontSize: "1.1rem" }}>
              {viewMode === "daily" && format(new Date(baseDate), "yyyy年M月d日 (E)", { locale: ja })}
              {viewMode !== "daily" && `${fetchRange.start} 〜 ${fetchRange.end}`}
            </span>

            <button className="icon-btn" onClick={() => {
              const d = new Date(baseDate);
              if (viewMode === "daily") setBaseDate(format(addDays(d, 1), "yyyy-MM-dd"));
              if (viewMode === "weekly") setBaseDate(format(addDays(d, 7), "yyyy-MM-dd"));
              if (viewMode === "monthly" || viewMode === "report") setBaseDate(format(addDays(d, 30), "yyyy-MM-dd"));
            }}>{">"}</button>
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
            <div style={{ display: "flex", gap: "10px" }}>
              <input
                type="text"
                placeholder="氏名検索..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{ padding: "6px 10px", borderRadius: "4px", border: "1px solid #d1d5db", fontSize: "0.9rem" }}
              />
            </div>
          </div>
          {loading ? (
            <div style={{ padding: "40px", textAlign: "center" }}>読み込み中...</div>
          ) : (
            <div className="table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th style={{ padding: "12px", width: "150px" }}>氏名</th>
                    <th style={{ padding: "12px", width: "150px" }}>シフト予定</th>
                    <th style={{ padding: "12px", width: "100px" }}>予定地</th>
                    <th style={{ padding: "12px", width: "100px" }}>状態</th>
                    <th style={{ padding: "12px", width: "150px" }}>実績 (出-退)</th>
                    <th style={{ padding: "12px" }}>補足</th>
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

                    return (
                      <tr key={u.userId} style={{ background: rowBg }}>
                        <td style={{ padding: "12px", fontWeight: "bold" }}>{userName}</td>
                        <td style={{ padding: "12px", display: "flex", flexDirection: "column" }}>
                          <span style={{ fontWeight: shift.isOff ? "bold" : "normal", color: shift.isOff ? "#ef4444" : "inherit" }}>
                            {shift.isOff ? "休み" : `${shift.start} - ${shift.end}`}
                          </span>
                          {shift.location && !shift.isOff && <span style={{ fontSize: "0.8rem", color: "#6b7280" }}>{shift.location}</span>}
                        </td>
                        <td style={{ padding: "12px" }}>{shift.isOff ? "-" : shift.location}</td>
                        <td style={{ padding: "12px" }}>{statusBadge}</td>
                        <td style={{ padding: "12px" }}>
                          {item ? (
                            <div>
                              {calcSplitDisplay(item, shift)}
                            </div>
                          ) : "-"}
                        </td>
                        <td style={{ padding: "12px", fontSize: "0.85rem", color: "#6b7280", textAlign: "center" }}>
                          {item && item._application?.status === "pending" && <div style={{ color: "#ea580c", marginBottom: "4px" }}>申請承認待ち</div>}
                          <button
                            className="action-btn"
                            style={{ background: "#ef4444", color: "#fff", border: "none", padding: "4px 8px", borderRadius: "4px", fontSize: "0.75rem", cursor: "pointer" }}
                            onClick={() => handleMarkAbsent(u.userId, userName, baseDate)}
                          >
                            欠勤
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
            <div className="table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th style={{ padding: "12px", fontSize: "14px" }}>日付</th>
                    <th style={{ padding: "12px", fontSize: "14px" }}>氏名</th>
                    <th style={{ padding: "12px", fontSize: "14px" }}>状態</th>
                    <th style={{ padding: "12px", fontSize: "14px" }}>実働 / 申請時間</th>
                    <th style={{ padding: "12px", fontSize: "14px" }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map(item => {
                    const rowAppStatus = item._application?.status;
                    const isToday = isSameDay(new Date(item.workDate), new Date());
                    const isWorking = item.clockIn && !item.clockOut && isToday;
                    const isUnapplied = item.clockIn && item.clockOut && !rowAppStatus;
                    const isIncomplete = item.clockIn && !item.clockOut && !isToday;

                    let bg = "#fff";
                    if (rowAppStatus === "approved") bg = "#ecfdf5"; // Green
                    else if (rowAppStatus === "pending") bg = "#fff7ed"; // Orange
                    else if (rowAppStatus === "resubmission_requested") bg = "#fcf4ff"; // Purple
                    else if (isIncomplete) bg = "#fee2e2"; // Red (Forgot Clockout)
                    else if (isUnapplied) bg = "#fef2f2"; // Red (Unapplied)
                    else if (isWorking) bg = "#ffffff"; // White (Working)

                    return (
                      <tr key={item.userId + item.workDate} style={{ background: bg, borderBottom: "1px solid #f3f4f6" }}>
                        <td style={{ fontSize: "14px", color: "#374151", padding: "12px" }}>
                          {format(new Date(item.workDate), "MM/dd(E)", { locale: ja })}
                        </td>
                        <td style={{ fontWeight: "bold", fontSize: "15px", padding: "12px" }}>
                          {item.userName}
                          <div style={{ fontSize: "10px", color: "#aaa" }}>{item.employmentType || "未設定"}</div>
                        </td>
                        <td style={{ padding: "12px" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: "2px", alignItems: "flex-start" }}>
                            {/* 1. Working (Today & In & !Out) */}
                            {(() => {
                              const isToday = item.workDate === format(new Date(), "yyyy-MM-dd");
                              if (isToday && item.clockIn && !item.clockOut) {
                                return <span className="status-badge green" style={{ background: "#dcfce7", color: "#166534", border: "1px solid #bbf7d0" }}>出勤中</span>;
                              }
                              return null;
                            })()}

                            {/* 2. No Clock Out (Past & In & !Out) */}
                            {(() => {
                              const isToday = item.workDate === format(new Date(), "yyyy-MM-dd");
                              if (!isToday && item.clockIn && !item.clockOut) {
                                return <span className="status-badge red" style={{ background: "#fee2e2", color: "#991b1b", border: "1px solid #fecaca" }}>未退勤</span>;
                              }
                              return null;
                            })()}

                            {/* 3. Application Status */}
                            {(() => {
                              if (!rowAppStatus && item.clockIn && item.clockOut) {
                                return <span className="status-badge gray" style={{ background: "#f3f4f6", color: "#4b5563", border: "1px solid #e5e7eb" }}>未申請</span>;
                              }
                              if (rowAppStatus === "pending") return <span className="status-badge orange">承認待</span>;
                              if (rowAppStatus === "resubmission_requested") return <span className="status-badge purple">再提出依頼</span>;
                              if (rowAppStatus === "approved") return <span className="status-badge green">承認済</span>;
                              return null;
                            })()}

                            {/* 4. Time Discrepancy / Reason */}
                            {(() => {
                              const app = item._application || {};
                              let isDiscrepancy = false;
                              if (app.reason && (app.reason === "寝坊" || app.reason.includes("早退"))) isDiscrepancy = true;
                              if (toMin(item.clockIn) > toMin(app.appliedIn)) isDiscrepancy = true;
                              if (toMin(item.clockOut) < toMin(app.appliedOut)) isDiscrepancy = true;

                              if (isDiscrepancy || app.reason) {
                                return (
                                  <span style={{ fontSize: "11px", color: isDiscrepancy ? "#ef4444" : "#6b7280", marginTop: 2 }}>
                                    {isDiscrepancy && "⚠️ "}
                                    {app.reason || (isDiscrepancy ? "時間乖離" : "")}
                                  </span>
                                );
                              }
                              return null;
                            })()}
                          </div>
                        </td>
                        <td style={{ fontSize: "14px", padding: "12px" }}>
                          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "8px 12px", alignItems: "center" }}>
                            {/* Actual Time */}
                            <div style={{ color: "#6b7280", fontSize: "0.8rem" }}>実績:</div>
                            <div style={{ fontFamily: "monospace", fontWeight: "bold" }}>
                              {(() => {
                                const min = calcRoundedWorkMin(item);
                                const h = Math.floor(min / 60);
                                const m = (min % 60) === 30 ? 5 : 0;
                                return `${h}.${m}H`;
                              })()}
                            </div>

                            {/* Applied Time (if pending/approved/resubmit) */}
                            {(rowAppStatus || item._application?.appliedIn) && (
                              <>
                                <div style={{ color: "#2563eb", fontSize: "0.8rem" }}>申請:</div>
                                <div style={{ fontFamily: "monospace", fontWeight: "bold", color: "#2563eb" }}>
                                  {(() => {
                                    const app = item._application;
                                    // Use same logic: 30 min truncate
                                    // Construct temp object mimicking item structure for calc logic
                                    // NOTE: Applied logic typically assumes NO breaks unless specified?
                                    // Or should we subtract break time from applied duration too?
                                    // Usually "Original Intended" includes break logic.
                                    // If break is not in application, fallback to item.breaks?
                                    // Let's assume applied duration = (Out - In) - Breaks.

                                    if (!app?.appliedIn || !app?.appliedOut) return "-";

                                    const dummyWithAppTimes = {
                                      ...item,
                                      clockIn: app.appliedIn,
                                      clockOut: app.appliedOut
                                      // breaks: item.breaks // Use actual breaks for calculation?
                                      // Or breaks should be in application? 
                                      // Payload sending formBreaks, but not parsed into _application structure in parseComment?
                                      // AdminAttendance parseComment: application = parsed.application.
                                      // But payload has "breaks" at root level for update.
                                      // Let's use item.breaks for now as best effort.
                                    };

                                    const min = calcRoundedWorkMin(dummyWithAppTimes);
                                    const h = Math.floor(min / 60);
                                    const m = (min % 60) === 30 ? 5 : 0;
                                    return `${h}.${m}H`;
                                  })()}
                                </div>
                              </>
                            )}
                          </div>
                        </td>

                        <td style={{ fontSize: "14px", padding: "12px" }}>
                          <div style={{ display: "flex", gap: "8px" }}>
                            {rowAppStatus === "pending" && (
                              <button
                                className="btn"
                                onClick={() => handleApprove(item)}
                                style={{
                                  fontSize: "12px", padding: "4px 8px",
                                  background: "#10b981", color: "#fff", border: "none", borderRadius: "4px",
                                  cursor: "pointer", fontWeight: "bold", display: "flex", alignItems: "center", gap: "4px"
                                }}
                              >
                                <CheckCircle size={14} /> 承認
                              </button>
                            )}
                            <button className="btn btn-outline" onClick={() => openEdit(item)} style={{ fontSize: "12px", padding: "4px 8px" }}>
                              詳細
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
      )
      }

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

      <style>{`
          .status-badge.purple { background: #f3e8ff; color: #7c3aed; border: 1px solid #d8b4fe; }
          .row-purple { background: #fcf4ff; }
          .toggle-btn { margin-right: 4px; padding: 4px 8px; border: 1px solid #ddd; background: #fff; cursor: pointer; }
      `}</style>
    </div >
  );
}
