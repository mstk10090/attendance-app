import React, { useEffect, useState, useMemo } from "react";
import { format, parseISO, startOfYear, endOfYear, eachDayOfInterval, isSaturday, isSunday } from "date-fns";
import { ja } from "date-fns/locale";
import {
    User, CheckCircle, Calendar, Search, ArrowLeft, Clock, AlertCircle, RefreshCw, Filter, PieChart, BarChart2
} from "lucide-react";
import "../../App.css";

const API_BASE = "https://lfsu60xvw7.execute-api.ap-northeast-1.amazonaws.com";
const API_USER_URL = `${API_BASE}/users`;

import { LOCATIONS, DEPARTMENTS, EMPLOYMENT_TYPES, HOLIDAYS } from "../../constants";

// Utilities
const toMin = (t) => {
    if (!t) return 0;
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
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

const parseStatus = (item) => {
    if (!item.comment) return null;
    try {
        const p = JSON.parse(item.comment);
        if (p && p.application) return p.application.status;
        return null;
    } catch {
        return null;
    }
};

const extractReason = (item) => {
    if (!item.comment) return null;
    try {
        const p = JSON.parse(item.comment);
        // application.reason or stored somewhere?
        // AdminAttendance saves admin reasons in comment text?
        // AttendanceRecord saves deviation reason in application.reason
        if (p && p.application && p.application.reason) return p.application.reason;

        // Sometimes it's in text like "[管理者修正]: reason"
        if (p.text && p.text.includes("[管理者修正]:")) {
            return "管理者修正"; // Simplify or extract
        }
        return null;
    } catch {
        return null;
    }
}

const isWorkDay = (dateStr) => {
    const d = new Date(dateStr);
    if (isSaturday(d) || isSunday(d)) return false;
    if (HOLIDAYS.includes(dateStr)) return false;
    return true;
};

export default function AdminHistory() {
    const [viewMode, setViewMode] = useState("month"); // "month" | "year"
    const [baseDate, setBaseDate] = useState(format(new Date(), "yyyy-MM-dd"));

    // User List State
    const [users, setUsers] = useState([]);
    const [loadingUsers, setLoadingUsers] = useState(false);

    // Filter State
    const [searchQuery, setSearchQuery] = useState("");
    const [filterType, setFilterType] = useState("");
    const [filterDept, setFilterDept] = useState("");
    const [filterLoc, setFilterLoc] = useState("");

    // Selected User State
    const [historyUser, setHistoryUser] = useState(null);
    const [userItems, setUserItems] = useState([]);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [shiftMap, setShiftMap] = useState({});

    // 1. Fetch Users on Mount
    useEffect(() => {
        fetchUsers();
    }, []);

    const fetchUsers = async () => {
        setLoadingUsers(true);
        try {
            const res = await fetch(API_USER_URL);
            if (res.ok) {
                const text = await res.text();
                let data = null;
                try {
                    const outer = JSON.parse(text);
                    if (outer.body && typeof outer.body === "string") data = JSON.parse(outer.body);
                    else data = outer;

                    let list = [];
                    if (Array.isArray(data)) list = data;
                    else if (data && Array.isArray(data.items)) list = data.items;
                    else if (data && Array.isArray(data.Items)) list = data.Items;
                    else if (data && data.success && Array.isArray(data.items)) list = data.items;

                    // Sort by name or ID logically
                    list.sort((a, b) => (a.userId || "").localeCompare(b.userId || ""));
                    setUsers(list);
                } catch (e) { console.error(e); }
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoadingUsers(false);
        }
    };

    // 2. Fetch History when User is selected or Date/Mode changes
    useEffect(() => {
        if (historyUser) {
            fetchUserHistory(historyUser.userId);
            // Fetch Shifts for this user
            import("../../utils/shiftParser").then(mod => {
                mod.fetchShiftData().then(data => {
                    // Extract only this user's shifts or perform lookup later
                    // data structure is { userName: { dayInt: {start, end} } }
                    // We need to match by userName potentially? 
                    // Let's store full map or just extract for efficiency?
                    // Store full map for now, access via historyUser.userName
                    setShiftMap(data);
                });
            });
        } else {
            setUserItems([]);
        }
    }, [historyUser, baseDate, viewMode]);

    const fetchUserHistory = async (userId) => {
        setLoadingHistory(true);
        try {
            const res = await fetch(`${API_BASE}/attendance?userId=${userId}`);
            const data = await res.json();

            if (data.success && Array.isArray(data.items)) {
                let targetPrefix = "";
                if (viewMode === "month") {
                    targetPrefix = baseDate.slice(0, 7); // "yyyy-MM"
                } else {
                    targetPrefix = baseDate.slice(0, 4); // "yyyy"
                }

                const filtered = data.items.filter(item =>
                    item.workDate && item.workDate.startsWith(targetPrefix)
                );

                // Sort by date
                filtered.sort((a, b) => a.workDate.localeCompare(b.workDate));
                setUserItems(filtered);
            } else {
                setUserItems([]);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoadingHistory(false);
        }
    };

    const filteredUsers = useMemo(() => {
        let result = [...users];

        // 1. Search Query
        if (searchQuery) {
            const lower = searchQuery.toLowerCase();
            result = result.filter(u => {
                const nameCands = [u.lastName, u.firstName, u.userName, u.loginId, u.userId].filter(Boolean).join(" ");
                return nameCands.toLowerCase().includes(lower);
            });
        }

        // 2. Filters
        if (filterType) {
            result = result.filter(u => (u.employmentType || "未設定") === filterType);
        }
        if (filterDept) {
            result = result.filter(u => (u.defaultDepartment || "未記載") === filterDept);
        }
        if (filterLoc) {
            result = result.filter(u => (u.defaultLocation || "未記載") === filterLoc);
        }

        return result;
    }, [users, searchQuery, filterType, filterDept, filterLoc]);

    const getDisplayName = (u) => {
        if (!u) return "";
        if (u.lastName || u.firstName) {
            return `${u.lastName || ""} ${u.firstName || ""}`.trim();
        }
        if (u.userName && u.userName !== "undefined") return u.userName;
        if (u.loginId) return u.loginId;
        return u.userId;
    };

    const getSubInfo = (u) => {
        if (!u) return "";
        const dept = u.defaultDepartment && u.defaultDepartment !== "未記載" ? u.defaultDepartment : "";
        const loc = u.defaultLocation && u.defaultLocation !== "未記載" ? u.defaultLocation : "";
        return [dept, loc].filter(Boolean).join(" / ") || u.loginId || "ID: " + u.userId.slice(0, 8);
    }

    // Render Stats
    const stats = useMemo(() => {
        if (!historyUser || !baseDate) return null;

        // 1. Calculate Scheduled Days
        let startD, endD;
        if (viewMode === "month") {
            const d = new Date(baseDate.slice(0, 7) + "-01");
            startD = new Date(d.getFullYear(), d.getMonth(), 1);
            endD = new Date(d.getFullYear(), d.getMonth() + 1, 0);
        } else {
            const y = parseInt(baseDate.slice(0, 4));
            startD = startOfYear(new Date(y, 0, 1));
            endD = endOfYear(new Date(y, 0, 1));
        }

        const allDays = eachDayOfInterval({ start: startD, end: endD });
        // Don't count future days for "Absent" calculation?
        // Usually reports are for past. If today is mid-month, absent count implies "days passed - attended".
        // But simplified: "Scheduled Work Days" (M-F, non-holiday)
        // Absent count removed as per request
        /*
        const businessDays = allDays.filter(d => {
            const s = format(d, "yyyy-MM-dd");
            return isWorkDay(s) && d <= new Date(); 
        });

        const attendedDates = new Set(userItems.filter(i => i.clockIn).map(i => i.workDate));

        let absentCount = 0;
        businessDays.forEach(d => {
            if (!attendedDates.has(format(d, "yyyy-MM-dd"))) {
                absentCount++;
            }
        });
        */
        const attendedDates = new Set(userItems.filter(i => i.clockIn).map(i => i.workDate)); // Keep needed for 'days' count

        const totalMin = userItems.reduce((acc, i) => acc + (i.clockIn && i.clockOut ? calcRoundedWorkMin(i) : 0), 0);
        // Late Count: Needs "Original Time". If not available, we can't count.
        // Assuming "Late" requires application.reason "遅刻" or similar logic?
        // Let's use the explicit "Late" reason count + logic if available.
        // Actually, user wants "Late/Absent/Early counts".
        // Absent = calculated above.
        // Late/Early = Check records.
        // Since we don't have "Scheduled Time" in DB for everyone, we rely on Application data OR "Common Sense" (e.g. 9:00)?
        // User said: "Late/Absent/Early reasons breakdown".
        // This implies we count the occurrences of REASONS.

        const reasons = {};
        let lateCount = 0;
        let earlyCount = 0;

        userItems.forEach(i => {
            const r = extractReason(i);
            if (r) {
                reasons[r] = (reasons[r] || 0) + 1;
                if (r.includes("遅刻")) lateCount++;
                if (r.includes("早退")) earlyCount++;
            }
        });

        const missingOut = userItems.filter(i => i.clockIn && !i.clockOut).length;
        const days = attendedDates.size;

        return {
            totalMin,
            missingOut,
            days,
            // absentCount,
            lateCount, // Only explicit ones
            earlyCount, // Only explicit ones
            reasons
        };
    }, [userItems, historyUser, baseDate, viewMode]);


    return (
        <div className="admin-container" style={{ height: "100vh", display: "flex", flexDirection: "column", boxSizing: "border-box", paddingBottom: "20px" }}>

            {/* Header - Fixed */}
            <div style={{ flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                <h2 style={{ fontSize: "1.5rem", fontWeight: "bold", display: "flex", alignItems: "center", gap: "12px", color: "#1f2937" }}>
                    <div style={{ background: "#fff7ed", padding: "10px", borderRadius: "12px", color: "#ea580c" }}>
                        <Calendar size={28} />
                    </div>
                    個人勤怠履歴・レポート
                </h2>

                {/* Date/Mode Selector */}
                {historyUser && (
                    <div style={{ display: "flex", gap: "8px", background: "#fff", padding: "4px", borderRadius: "8px", border: "1px solid #e5e7eb" }}>
                        <button
                            onClick={() => setViewMode("month")}
                            className={`toggle-btn ${viewMode === "month" ? "active" : ""}`}
                        >
                            月次
                        </button>
                        <button
                            onClick={() => setViewMode("year")}
                            className={`toggle-btn ${viewMode === "year" ? "active" : ""}`}
                        >
                            年次
                        </button>

                        <div style={{ width: "1px", background: "#e5e7eb", margin: "0 4px" }}></div>

                        {viewMode === "month" ? (
                            <input
                                type="month"
                                className="input-clean"
                                value={baseDate.slice(0, 7)}
                                onChange={e => setBaseDate(e.target.value + "-01")}
                            />
                        ) : (
                            <select
                                className="input-clean"
                                value={baseDate.slice(0, 4)}
                                onChange={e => setBaseDate(e.target.value + "-01-01")}
                            >
                                {[2024, 2025, 2026].map(y => <option key={y} value={y}>{y}年</option>)}
                            </select>
                        )}
                    </div>
                )}
            </div>

            {!historyUser ? (
                /* --- User Selection Mode --- */
                <div className="card" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", padding: 0 }}>
                    {/* Search & Filter Header - Fixed */}
                    <div style={{ padding: "16px", borderBottom: "1px solid #f3f4f6", background: "#fff", flexShrink: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "12px" }}>
                            <h3 style={{ fontSize: "1rem", fontWeight: "bold", color: "#374151", margin: 0 }}>
                                対象スタッフを選択してください
                            </h3>
                            <span style={{ fontSize: "0.85rem", color: "#6b7280", background: "#f3f4f6", padding: "2px 8px", borderRadius: "12px" }}>
                                全 {filteredUsers.length} 名
                            </span>
                        </div>

                        {/* Controls Row */}
                        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                            {/* Compact Search Bar */}
                            <div style={{ position: "relative", width: "240px" }}>
                                <Search size={16} style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: "#9ca3af", pointerEvents: "none" }} />
                                <input
                                    type="text"
                                    className="input"
                                    placeholder="氏名・ID..."
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                    style={{
                                        paddingLeft: "32px",
                                        width: "100%",
                                        height: "36px",
                                        fontSize: "14px",
                                        border: "1px solid #e5e7eb",
                                        borderRadius: "6px"
                                    }}
                                />
                            </div>

                            <div style={{ width: "1px", height: "24px", background: "#e5e7eb", margin: "0 4px" }} />

                            {/* Filters */}
                            <select
                                className="input"
                                value={filterType}
                                onChange={e => setFilterType(e.target.value)}
                                style={{ height: "36px", width: "110px", fontSize: "0.85rem", padding: "0 8px" }}
                            >
                                <option value="">全ての形態</option>
                                {EMPLOYMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>

                            <select
                                className="input"
                                value={filterDept}
                                onChange={e => setFilterDept(e.target.value)}
                                style={{ height: "36px", width: "110px", fontSize: "0.85rem", padding: "0 8px" }}
                            >
                                <option value="">全ての部署</option>
                                {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                            </select>

                            <select
                                className="input"
                                value={filterLoc}
                                onChange={e => setFilterLoc(e.target.value)}
                                style={{ height: "36px", width: "110px", fontSize: "0.85rem", padding: "0 8px" }}
                            >
                                <option value="">全ての勤務地</option>
                                {LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
                            </select>

                            {(filterType || filterDept || filterLoc) && (
                                <button
                                    onClick={() => { setFilterType(""); setFilterDept(""); setFilterLoc(""); }}
                                    style={{ fontSize: "0.8rem", color: "#ef4444", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
                                >
                                    クリア
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Scrollable Content */}
                    <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
                        {loadingUsers ? (
                            <div style={{ padding: "60px", textAlign: "center", color: "#6b7280" }}>
                                <div className="spin" style={{ display: "inline-block", marginBottom: "8px" }}><RefreshCw size={24} /></div>
                                <div>スタッフ一覧を読み込み中...</div>
                            </div>
                        ) : users.length === 0 ? (
                            <div style={{ padding: "40px", textAlign: "center", color: "#9ca3af" }}>データがありません (API接続を確認してください)</div>
                        ) : (
                            <div className="user-grid">
                                {filteredUsers.map(u => (
                                    <button
                                        key={u.userId}
                                        className="user-card-btn"
                                        onClick={() => setHistoryUser(u)}
                                    >
                                        <div className="user-avatar">
                                            <User size={20} />
                                        </div>
                                        <div className="user-info">
                                            <div className="user-name">{getDisplayName(u)}</div>
                                            <div className="user-sub">{getSubInfo(u)}</div>
                                        </div>
                                    </button>
                                ))}
                                {filteredUsers.length === 0 && (
                                    <div style={{ gridColumn: "1 / -1", textAlign: "center", color: "#9ca3af", padding: "20px" }}>
                                        条件に一致するスタッフがいません
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            ) : (
                /* --- History / Report View Mode --- */
                <div className="card" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", padding: 0 }}>
                    <div style={{ padding: "16px 20px", borderBottom: "1px solid #f3f4f6", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#fcfcfc", flexShrink: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                            <div className="user-avatar-lg">
                                <User size={24} />
                            </div>
                            <div>
                                <div style={{ fontWeight: "bold", fontSize: "1.1rem", color: "#1f2937" }}>
                                    {getDisplayName(historyUser)}
                                </div>
                                <div style={{ fontSize: "0.85rem", color: "#6b7280" }}>
                                    {viewMode === "month"
                                        ? `${baseDate.slice(0, 4)}年 ${baseDate.slice(5, 7)}月 (${historyUser.employmentType || "一般"})`
                                        : `${baseDate.slice(0, 4)}年 年間レポート`
                                    }
                                </div>
                            </div>
                        </div>
                        <button className="btn btn-outline" onClick={() => setHistoryUser(null)}>
                            <ArrowLeft size={16} style={{ marginRight: "4px" }} /> 一覧に戻る
                        </button>
                    </div>

                    <div style={{ flex: 1, overflowY: "auto", padding: "24px" }}>
                        {loadingHistory ? (
                            <div style={{ padding: "60px", textAlign: "center", color: "#6b7280" }}>
                                <div className="spin" style={{ display: "inline-block", marginBottom: "8px" }}><RefreshCw size={24} /></div>
                                <div>履歴を読み込み中...</div>
                            </div>
                        ) : (
                            <>
                                {/* Summary / Report Logic */}
                                {stats && (
                                    <>
                                        <div className="stats-grid">
                                            {/* Row 1: Basic Counts */}
                                            <div className="stat-card">
                                                <div className="stat-label">出勤日数</div>
                                                <div className="stat-value">{stats.days} <span className="unit">日</span></div>
                                                <Calendar className="stat-icon" size={20} />
                                            </div>
                                            <div className="stat-card">
                                                <div className="stat-label">総実働</div>
                                                <div className="stat-value">
                                                    {Math.floor(stats.totalMin / 60)}<span className="unit">h</span>
                                                    {String(stats.totalMin % 60).padStart(2, '0')}<span className="unit">m</span>
                                                </div>
                                                <Clock className="stat-icon" size={20} />
                                            </div>
                                            {/* Absent card removed */}
                                            <div className={`stat-card ${stats.lateCount > 0 ? "alert" : ""}`}>
                                                <div className="stat-label">遅刻 (申請ベース)</div>
                                                <div className="stat-value">{stats.lateCount} <span className="unit">件</span></div>
                                            </div>
                                            <div className={`stat-card ${stats.earlyCount > 0 ? "alert" : ""}`}>
                                                <div className="stat-label">早退 (申請ベース)</div>
                                                <div className="stat-value">{stats.earlyCount} <span className="unit">件</span></div>
                                            </div>
                                        </div>

                                        {/* Reason Breakdown */}
                                        {Object.keys(stats.reasons).length > 0 && (
                                            <div style={{ marginTop: "24px", padding: "16px", background: "#f8fafc", borderRadius: "12px", border: "1px solid #e2e8f0" }}>
                                                <h4 style={{ fontSize: "0.95rem", fontWeight: "bold", marginBottom: "12px", color: "#475569", display: "flex", alignItems: "center", gap: "8px" }}>
                                                    <PieChart size={16} /> 理由別内訳
                                                </h4>
                                                <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
                                                    {Object.entries(stats.reasons).map(([reason, count]) => (
                                                        <div key={reason} style={{ background: "#fff", padding: "8px 12px", borderRadius: "8px", border: "1px solid #e5e7eb", fontSize: "0.9rem", display: "flex", alignItems: "center", gap: "8px" }}>
                                                            <span style={{ fontWeight: "600", color: "#334155" }}>{reason}</span>
                                                            <span style={{ background: "#e2e8f0", padding: "2px 8px", borderRadius: "12px", fontSize: "0.8rem", color: "#475569" }}>{count}件</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </>
                                )}

                                {/* Table List - Render Items */}
                                <div className="table-wrap" style={{ marginTop: "24px", boxShadow: "0 1px 3px rgba(0,0,0,0.05)", borderRadius: "8px", overflow: "hidden", border: "1px solid #e5e7eb" }}>
                                    <table className="admin-table" style={{ width: "100%", borderCollapse: "collapse" }}>
                                        <thead>
                                            <tr style={{ background: "#f9fafb" }}>
                                                <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "0.85rem", color: "#6b7280" }}>日付</th>
                                                <th style={{ padding: "12px 16px", textAlign: "center", fontSize: "0.85rem", color: "#6b7280" }}>シフト</th>
                                                <th style={{ padding: "12px 16px", textAlign: "center", fontSize: "0.85rem", color: "#6b7280" }}>出勤</th>
                                                <th style={{ padding: "12px 16px", textAlign: "center", fontSize: "0.85rem", color: "#6b7280" }}>退勤</th>
                                                <th style={{ padding: "12px 16px", textAlign: "center", fontSize: "0.85rem", color: "#6b7280" }}>実働</th>
                                                <th style={{ padding: "12px 16px", textAlign: "center", fontSize: "0.85rem", color: "#6b7280" }}>状態/理由</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {(() => {
                                                // Prepare rows: All Days in view range
                                                let startD, endD;
                                                if (viewMode === "month") {
                                                    const d = new Date(baseDate.slice(0, 7) + "-01");
                                                    startD = new Date(d.getFullYear(), d.getMonth(), 1);
                                                    endD = new Date(d.getFullYear(), d.getMonth() + 1, 0);
                                                } else {
                                                    const y = parseInt(baseDate.slice(0, 4));
                                                    startD = startOfYear(new Date(y, 0, 1));
                                                    endD = endOfYear(new Date(y, 0, 1));
                                                }
                                                const daysToRender = eachDayOfInterval({ start: startD, end: endD });

                                                // Create Map for quick lookup
                                                const attendanceMap = {};
                                                userItems.forEach(i => attendanceMap[i.workDate] = i);

                                                return daysToRender.map(dateObj => {
                                                    const dateStr = format(dateObj, "yyyy-MM-dd");
                                                    const item = attendanceMap[dateStr] || { workDate: dateStr }; // Dummy item if missing
                                                    const hasAttendance = !!attendanceMap[dateStr];

                                                    const workMin = calcWorkMin(item);
                                                    const rounded = calcRoundedWorkMin(item);
                                                    const isError = (item.clockIn && item.clockOut && workMin <= 0);
                                                    const incomplete = (item.clockIn && !item.clockOut);
                                                    const status = parseStatus(item);
                                                    const reason = extractReason(item);

                                                    let bg = "#fff";
                                                    if (isError || incomplete) bg = "#fef2f2";

                                                    // Shift Lookup Logic
                                                    let shift = null;
                                                    if (shiftMap) {
                                                        const keysToTry = [
                                                            historyUser.userName,
                                                            `${historyUser.lastName || ""} ${historyUser.firstName || ""}`.trim(),
                                                            `${historyUser.firstName || ""} ${historyUser.lastName || ""}`.trim(),
                                                            `${historyUser.lastName || ""}　${historyUser.firstName || ""}`.trim(),
                                                            `${historyUser.firstName || ""}　${historyUser.lastName || ""}`.trim(),
                                                            `${historyUser.lastName || ""}${historyUser.firstName || ""}`.trim()
                                                        ];

                                                        for (const k of keysToTry) {
                                                            if (k && shiftMap[k] && shiftMap[k][dateStr]) {
                                                                shift = shiftMap[k][dateStr];
                                                                break;
                                                            }
                                                        }
                                                    }

                                                    // If no shift and no attendance, maybe skip in YEAR mode? 
                                                    // But in MONTH mode show all.

                                                    return (
                                                        <tr key={dateStr} style={{ background: bg, borderBottom: "1px solid #f3f4f6" }}>
                                                            <td style={{ padding: "12px 16px", borderRight: "1px solid #f3f4f6", fontWeight: "500", color: "#374151" }}>
                                                                {format(dateObj, "MM/dd (E)", { locale: ja })}
                                                            </td>
                                                            <td style={{ padding: "12px 16px", textAlign: "center", fontSize: "0.9rem", color: shift ? "#2563eb" : "#9ca3af" }}>
                                                                {shift ? `${shift.start}-${shift.end}` : "-"}
                                                            </td>
                                                            <td style={{ padding: "12px 16px", textAlign: "center", fontFamily: "monospace", fontSize: "1rem" }}>
                                                                {item.clockIn || <span style={{ color: "#d1d5db" }}>-</span>}
                                                            </td>
                                                            <td style={{ padding: "12px 16px", textAlign: "center", fontFamily: "monospace", fontSize: "1rem" }}>
                                                                {item.clockOut || <span style={{ color: "#d1d5db" }}>-</span>}
                                                            </td>
                                                            <td style={{ padding: "12px 16px", textAlign: "center", fontWeight: "bold", color: "#111827" }}>
                                                                {rounded > 0
                                                                    ? `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`
                                                                    : <span style={{ color: "#e5e7eb" }}>-</span>
                                                                }
                                                            </td>
                                                            <td style={{ padding: "12px 16px", textAlign: "center" }}>
                                                                {incomplete && <span className="status-badge red">未退勤</span>}
                                                                {isError && <span className="status-badge red">異常</span>}
                                                                {status === "pending" && <span className="status-badge orange">承認待</span>}
                                                                {status === "resubmission_requested" && <span className="status-badge purple">再提出依頼</span>}
                                                                {status === "approved" && <span className="status-badge green">済</span>}

                                                                {/* Reason Display */}
                                                                {reason && <span className="status-badge gray" style={{ marginLeft: "6px" }}>{reason}</span>}

                                                                {!incomplete && !isError && !status && !reason && hasAttendance && <CheckCircle size={18} color="#22c55e" />}
                                                            </td>
                                                        </tr>
                                                    );
                                                });
                                            })()}
                                        </tbody>
                                    </table>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            <style>{`
                .spin { animation: spin 1s linear infinite; }
                @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                
                .user-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
                    gap: 16px;
                }
                .user-card-btn {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 16px;
                    background: #fff;
                    border: 1px solid #e5e7eb;
                    border-radius: 12px;
                    text-align: left;
                    cursor: pointer;
                    transition: all 0.2s ease;
                    box-shadow: 0 1px 2px rgba(0,0,0,0.02);
                }
                .user-card-btn:hover {
                    border-color: #3b82f6;
                    background: #eff6ff;
                    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
                    transform: translateY(-1px);
                }
                .user-avatar {
                    width: 40px; height: 40px;
                    background: #f3f4f6;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: #9ca3af;
                    flex-shrink: 0;
                }
                .user-card-btn:hover .user-avatar {
                    background: #bfdbfe;
                    color: #2563eb;
                }
                .user-name {
                    font-weight: bold;
                    color: #1f2937;
                    font-size: 0.95rem;
                }
                .user-sub {
                    font-size: 0.8rem;
                    color: #6b7280;
                    margin-top: 2px;
                }

                .user-avatar-lg {
                    width: 48px; height: 48px;
                    background: #e0f2fe;
                    color: #0284c7;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                
                .stats-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
                    gap: 16px;
                }
                .stat-card {
                    background: #f9fafb;
                    padding: 16px;
                    border-radius: 12px;
                    position: relative;
                    border: 1px solid #f3f4f6;
                }
                .stat-card.alert {
                    background: #fef2f2;
                    border-color: #fee2e2;
                }
                .stat-label {
                    font-size: 0.8rem;
                    color: #6b7280;
                    margin-bottom: 4px;
                }
                .stat-value {
                    font-size: 1.4rem;
                    font-weight: bold;
                    color: #111827;
                }
                .stat-card.alert .stat-value { color: #dc2626; }
                .unit {
                    font-size: 0.85rem;
                    font-weight: normal;
                    color: #9ca3af;
                    margin-left: 2px;
                }
                .stat-icon {
                    position: absolute;
                    top: 16px; right: 16px;
                    color: #d1d5db;
                }
                
                .btn-outline {
                    background: #fff;
                    border: 1px solid #d1d5db;
                    color: #374151;
                    padding: 8px 16px;
                    border-radius: 8px;
                    font-size: 0.9rem;
                    font-weight: 500;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    transition: all 0.2s;
                }
                .btn-outline:hover {
                    background: #f9fafb;
                    border-color: #9ca3af;
                }

                .toggle-btn {
                    padding: 6px 16px;
                    border-radius: 6px;
                    border: none;
                    background: transparent;
                    color: #6b7280;
                    font-weight: 500;
                    font-size: 0.9rem;
                    cursor: pointer;
                    transition: 0.2s;
                }
                .toggle-btn.active {
                    background: #fff7ed;
                    color: #ea580c;
                    font-weight: bold;
                }
                .input-clean {
                    border: none;
                    outline: none;
                    font-weight: bold;
                    color: #374151;
                    font-size: 0.95rem;
                    background: transparent;
                    cursor: pointer;
                }
            `}</style>
        </div>
    );
}
