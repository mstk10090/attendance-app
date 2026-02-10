import React, { useEffect, useState, useMemo, useRef } from "react";
import { format, parseISO, startOfYear, endOfYear, eachDayOfInterval, isSaturday, isSunday } from "date-fns";
import { ja } from "date-fns/locale";
import {
    User, CheckCircle, Calendar, Search, ArrowLeft, Clock, AlertCircle, RefreshCw, Filter, PieChart, BarChart2
} from "lucide-react";
import "../../App.css";

const API_BASE = "https://lfsu60xvw7.execute-api.ap-northeast-1.amazonaws.com";
const API_USER_URL = `${API_BASE}/users`;

import { LOCATIONS, DEPARTMENTS, EMPLOYMENT_TYPES, HOLIDAYS } from "../../constants";
import HistoryReport from "../../components/HistoryReport";

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

    // Lazy Load State
    const [displayedLimit, setDisplayedLimit] = useState(20);
    const observerTarget = useRef(null);

    useEffect(() => {
        setDisplayedLimit(20);
    }, [searchQuery, filterType, filterDept, filterLoc]); // Reset on filter change

    useEffect(() => {
        const observer = new IntersectionObserver(
            entries => {
                if (entries[0].isIntersecting) {
                    setDisplayedLimit(prev => prev + 20);
                }
            },
            { threshold: 0.1 }
        );
        if (observerTarget.current) {
            observer.observe(observerTarget.current);
        }
        return () => {
            if (observerTarget.current) observer.unobserve(observerTarget.current);
        };
    }, [users]); // Re-attach if users list completely reloads (rare) or just mount.
    // Actually, we want to observe the sentinel. 
    // Effect needs to run when sentinel might be rendered/unrendered? 
    // Simply having it with empty deps or appropriate filteredUsers might be enough, 
    // but React refs are stable. We might need a callback ref or just rely on 'observerTarget.current' being available.

    // Better pattern:
    // We will render <div ref={observerTarget} /> at the bottom.


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

                    // loginIdに基づいて重複を排除（最新のエントリを保持）
                    const uniqueMap = new Map();
                    list.forEach(user => {
                        if (user.loginId) {
                            uniqueMap.set(user.loginId, user);
                        }
                    });
                    list = Array.from(uniqueMap.values());

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

                // Normalize Items
                const normalized = data.items.map(item => {
                    let displayDate = item.workDate;
                    if (/^\d{6}-\d{2}-\d{2}$/.test(item.workDate)) {
                        const yyyymm = item.workDate.substring(0, 6);
                        const dd = item.workDate.substring(10, 12);
                        displayDate = `${yyyymm.substring(0, 4)}-${yyyymm.substring(4, 6)}-${dd}`;
                    }
                    return { ...item, displayDate };
                });

                const filtered = normalized.filter(item =>
                    item.displayDate && item.displayDate.startsWith(targetPrefix)
                );

                // Sort by date
                filtered.sort((a, b) => a.displayDate.localeCompare(b.displayDate));
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
        const attendedDates = new Set(userItems.filter(i => i.clockIn).map(i => i.displayDate || i.workDate)); // Keep needed for 'days' count

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
            // 遅刻取消フラグを確認
            let parsed = null;
            try { parsed = JSON.parse(i.comment || "{}"); } catch { }
            const lateCancelled = parsed?.application?.lateCancelled;
            const earlyCancelled = parsed?.application?.earlyCancelled;

            if (r) {
                reasons[r] = (reasons[r] || 0) + 1;
                if (r.includes("遅刻") && !lateCancelled) lateCount++;
                if (r.includes("早退") && !earlyCancelled) earlyCount++;
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
                    {/* Search & Filter Header (Refined) */}
                    <div style={{ padding: "16px", borderBottom: "1px solid #e5e7eb", background: "#f9fafb", flexShrink: 0 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                            <h3 style={{ fontSize: "1rem", fontWeight: "bold", color: "#374151" }}>
                                スタッフ選択
                            </h3>
                            <span style={{ fontSize: "0.8rem", color: "#6b7280", background: "#fff", padding: "2px 8px", borderRadius: "12px", border: "1px solid #e5e7eb" }}>
                                {filteredUsers.length} 名 表示中
                            </span>
                        </div>

                        {/* Search Bar */}
                        <div style={{ marginBottom: "12px", position: "relative" }}>
                            <Search size={18} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "#9ca3af" }} />
                            <input
                                type="text"
                                className="input"
                                placeholder="名前、IDで検索..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                style={{
                                    width: "100%",
                                    padding: "10px 10px 10px 40px",
                                    fontSize: "0.95rem",
                                    border: "1px solid #d1d5db",
                                    borderRadius: "8px",
                                    boxShadow: "0 1px 2px rgba(0,0,0,0.05)"
                                }}
                            />
                        </div>

                        {/* Filters Row */}
                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                            <select
                                className="input"
                                value={filterType}
                                onChange={e => setFilterType(e.target.value)}
                                style={{ flex: 1, minWidth: "90px", fontSize: "0.85rem", padding: "6px", borderRadius: "6px" }}
                            >
                                <option value="">形態: 全て</option>
                                {EMPLOYMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>

                            <select
                                className="input"
                                value={filterDept}
                                onChange={e => setFilterDept(e.target.value)}
                                style={{ flex: 1, minWidth: "90px", fontSize: "0.85rem", padding: "6px", borderRadius: "6px" }}
                            >
                                <option value="">部署: 全て</option>
                                {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                            </select>

                            <select
                                className="input"
                                value={filterLoc}
                                onChange={e => setFilterLoc(e.target.value)}
                                style={{ flex: 1, minWidth: "90px", fontSize: "0.85rem", padding: "6px", borderRadius: "6px" }}
                            >
                                <option value="">勤務地: 全て</option>
                                {LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
                            </select>
                        </div>

                        {(filterType || filterDept || filterLoc) && (
                            <div style={{ marginTop: "8px", textAlign: "right" }}>
                                <button
                                    onClick={() => { setFilterType(""); setFilterDept(""); setFilterLoc(""); }}
                                    style={{ fontSize: "0.8rem", color: "#ef4444", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
                                >
                                    絞り込みをクリア
                                </button>
                            </div>
                        )}
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
                                {filteredUsers.slice(0, displayedLimit).map(u => (
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
                                {/* Sentinel */}
                                <div ref={observerTarget} style={{ height: "20px", width: "100%", gridColumn: "1 / -1" }}></div>
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
                            <HistoryReport
                                user={historyUser}
                                items={userItems}
                                baseDate={baseDate}
                                viewMode={viewMode}
                                shiftMap={shiftMap}
                            />
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
