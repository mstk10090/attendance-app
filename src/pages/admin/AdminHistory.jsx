import React, { useEffect, useState, useMemo } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { format, parseISO, startOfYear, endOfYear, startOfMonth, endOfMonth, eachDayOfInterval, isSaturday, isSunday } from "date-fns";
import { ja } from "date-fns/locale";
import {
    User, CheckCircle, Calendar, Search, ArrowLeft, Clock, AlertCircle, RefreshCw, Filter, PieChart, BarChart2
} from "lucide-react";
import "../../App.css";

const API_BASE = "https://lfsu60xvw7.execute-api.ap-northeast-1.amazonaws.com";
const API_USER_URL = `${API_BASE}/users`;

import { LOCATIONS, DEPARTMENTS, EMPLOYMENT_TYPES, HOLIDAYS } from "../../constants";
import HistoryReport from "../../components/HistoryReport";
import { normalizeName, fetchShiftData } from "../../utils/shiftParser";

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

const parseCommentLocal = (comment) => {
    if (!comment) return {};
    try { return JSON.parse(comment); } catch { return {}; }
};

// ユーザーのシフトデータを取得（normalizeName で複数キーをフォールバック）
const getUserShiftsLocal = (shiftMap, user) => {
    if (!shiftMap || !user) return {};
    const candidates = [
        (user.lastName || "") + (user.firstName || ""),
        (user.userName || ""),
        (user.loginId || ""),
    ].filter(Boolean);
    for (const c of candidates) {
        const normalized = normalizeName(c);
        for (const key of Object.keys(shiftMap)) {
            if (normalizeName(key) === normalized) return shiftMap[key] || {};
        }
    }
    return {};
};

// 1ユーザー分のstatsを計算
const calcUserStats = (userItems, user, shiftMap, baseDate, viewMode) => {
    if (!user || !baseDate) return null;
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
    const startStr = format(startD, "yyyy-MM-dd");
    const endStr = format(endD, "yyyy-MM-dd");
    const monthItems = userItems.filter(i => {
        const d = i.displayDate || i.workDate;
        return d >= startStr && d <= endStr;
    });
    const approvedItems = monthItems.filter(i => {
        const p = parseCommentLocal(i.comment);
        const st = p?.application?.status;
        // 管理者(a)が承認したapproved + 上位管理者が最終承認したconfirmedを集計対象に
        // pendingはまだ管理者が承認していないので含めない
        return st === "approved" || (p?.application?.confirmedBy);
    });
    const attendedDates = new Set(approvedItems.filter(i => {
        const p = parseCommentLocal(i.comment);
        const effectiveIn = p?.application?.appliedIn || i.clockIn;
        return !!effectiveIn;
    }).map(i => i.displayDate || i.workDate));
    const userShifts = getUserShiftsLocal(shiftMap, user);
    let lateCount = 0, absentCount = 0, earlyCount = 0, dispatchMin = 0, partTimeMin = 0;
    monthItems.forEach(i => {
        const parsed = parseCommentLocal(i.comment);
        const app = parsed?.application;
        if (app?.status === "absent") absentCount++;
        const dateStr = i.displayDate || i.workDate;
        const shiftForDay = userShifts[dateStr] || null;
        if (shiftForDay && shiftForDay.start) {
            const effectiveIn = app?.appliedIn || i.clockIn;
            if (effectiveIn) {
                const lateCancelled = app?.lateCancelled || false;
                const inMin = toMin(effectiveIn);
                const startMin = toMin(shiftForDay.start);
                // 申請時間(appliedIn)は「>」で判定（ちょうどは遅刻でない）
                // 打刻(clockIn)は「>=」で判定（ちょうどでも遅刻）
                const isLate = app?.appliedIn ? inMin > startMin : inMin >= startMin;
                if (isLate && !lateCancelled) lateCount++;
            }
        }
        if (app?.reason && app.reason.includes("早退")) earlyCount++;
    });
    approvedItems.forEach(i => {
        const parsed = parseCommentLocal(i.comment);
        const app = parsed?.application || {};
        if (app.withdrawn) return;
        const effectiveIn = app.appliedIn || i.clockIn;
        const effectiveOut = app.appliedOut || i.clockOut;
        if (!effectiveIn || !effectiveOut) return;
        const actualIn = toMin(effectiveIn);
        const actualOut = toMin(effectiveOut);
        const roundedIn = Math.ceil(actualIn / 30) * 30;
        const roundedOut = Math.floor(actualOut / 30) * 30;
        if (roundedIn >= roundedOut) return;
        const breakMin = app.breakDuration || calcBreakTime(i);
        const netWorkMin = Math.max(0, roundedOut - roundedIn - breakMin);
        const dateStr = i.displayDate || i.workDate;
        const shift = userShifts[dateStr] || null;
        let dayDispatch = 0, dayPartTime = 0;
        if (shift && (shift.dispatchRange || shift.partTimeRange)) {
            // 勤怠管理と同じロジック: dispatchRangeのフルレンジを派遣時間として使用
            if (shift.dispatchRange) {
                const dS = toMin(shift.dispatchRange.start);
                const dE = toMin(shift.dispatchRange.end);
                dayDispatch = dE - dS; // シフト範囲固定（overlapではなくフルレンジ）
            }
            if (dayDispatch > 8 * 60) { dayPartTime += dayDispatch - 8 * 60; dayDispatch = 8 * 60; }
            // バイト時間 = 実働 - 派遣時間
            dayPartTime = Math.max(0, netWorkMin - dayDispatch);
        } else if (shift && shift.isDispatch) {
            dayDispatch = Math.min(netWorkMin, 8 * 60);
            dayPartTime = Math.max(0, netWorkMin - 8 * 60);
        } else {
            dayPartTime = netWorkMin;
        }
        dayDispatch = Math.floor(dayDispatch / 30) * 30;
        dayPartTime = Math.floor(dayPartTime / 30) * 30;
        dispatchMin += dayDispatch;
        partTimeMin += dayPartTime;
    });
    const totalMin = approvedItems.reduce((acc, i) => {
        const parsed = parseCommentLocal(i.comment);
        const app = parsed?.application || {};
        const effectiveIn = app.appliedIn || i.clockIn;
        const effectiveOut = app.appliedOut || i.clockOut;
        if (!effectiveIn || !effectiveOut) return acc;
        const inMin = toMin(effectiveIn);
        const outMin = toMin(effectiveOut);
        const breakDur = app.breakDuration || calcBreakTime(i);
        let wm = Math.max(0, outMin - inMin - breakDur);
        wm = Math.floor(wm / 30) * 30;
        return acc + wm;
    }, 0);
    return {
        totalMin, days: attendedDates.size, lateCount, absentCount, earlyCount, dispatchMin, partTimeMin
    };
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
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
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

    // サマリーテーブル用
    const [allUserStats, setAllUserStats] = useState({});
    const [loadingSummary, setLoadingSummary] = useState(false);
    const [summaryShiftMap, setSummaryShiftMap] = useState({});

    // ソート用
    const [sortKey, setSortKey] = useState(null); // "name"|"type"|"days"|"dispatch"|"partTime"|"total"|"late"|"early"|"absent"
    const [sortDir, setSortDir] = useState("desc"); // "asc" | "desc"
    const handleSort = (key) => {
        if (sortKey === key) {
            setSortDir(prev => prev === "asc" ? "desc" : "asc");
        } else {
            setSortKey(key);
            setSortDir("desc");
        }
    };



    // 1. Fetch Users on Mount
    useEffect(() => {
        fetchUsers();
    }, []);

    // シフトデータの初回取得
    useEffect(() => {
        fetchShiftData().then(data => setSummaryShiftMap(data || {})).catch(() => { });
    }, []);

    // 全ユーザーのサマリー取得（月/年が変わるたびに）
    useEffect(() => {
        if (users.length === 0 || historyUser) return;
        fetchAllStats();
    }, [users, baseDate, viewMode, summaryShiftMap, historyUser]);

    const fetchAllStats = async () => {
        setLoadingSummary(true);
        try {
            const targetPrefix = viewMode === "month" ? baseDate.slice(0, 7) : baseDate.slice(0, 4);
            const results = {};

            // リトライ付きフェッチ
            const fetchWithRetry = async (url, retries = 3) => {
                for (let attempt = 0; attempt < retries; attempt++) {
                    try {
                        const res = await fetch(url);
                        if (res.status === 503 || res.status === 429) {
                            await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
                            continue;
                        }
                        if (!res.ok) return null;
                        return await res.json();
                    } catch {
                        if (attempt < retries - 1) {
                            await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
                        }
                    }
                }
                return null;
            };

            const CHUNK_SIZE = 3;
            for (let i = 0; i < users.length; i += CHUNK_SIZE) {
                const chunk = users.slice(i, i + CHUNK_SIZE);
                const chunkResults = await Promise.all(chunk.map(async (u) => {
                    try {
                        // 全代替IDのデータを統合（重複排除で排除されたIDの勤怠データも取得）
                        const allIds = u.altUserIds && u.altUserIds.length > 0
                            ? [...new Set(u.altUserIds)]
                            : [u.userId];

                        let allItems = [];
                        for (const uid of allIds) {
                            const data = await fetchWithRetry(`${API_BASE}/attendance?userId=${uid}`);
                            if (data && data.success && Array.isArray(data.items)) {
                                allItems.push(...data.items);
                            }
                        }

                        if (allItems.length > 0) {
                            // workDateで重複排除（同じ日に複数IDのデータがある場合）
                            const dateMap = new Map();
                            allItems.forEach(item => {
                                const existing = dateMap.get(item.workDate);
                                if (!existing || (item.clockIn && !existing.clockIn)) {
                                    dateMap.set(item.workDate, item);
                                }
                            });

                            const normalized = Array.from(dateMap.values()).map(item => {
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
                            const stats = calcUserStats(filtered, u, summaryShiftMap, baseDate, viewMode);
                            return { userId: u.userId, stats };
                        }
                        return { userId: u.userId, stats: null };
                    } catch {
                        return { userId: u.userId, stats: null };
                    }
                }));
                chunkResults.forEach(r => { results[r.userId] = r.stats; });
                await new Promise(r => setTimeout(r, 200));
            }
            setAllUserStats(results);
        } catch (e) {
            console.error("Failed to fetch all stats:", e);
        } finally {
            setLoadingSummary(false);
        }
    };

    // URLパラメータからuserIdを取得して自動選択（常に個人ビューに遷移）
    useEffect(() => {
        const userId = searchParams.get("userId");
        if (userId && users.length > 0) {
            // まずプライマリuserIdで検索、見つからなければaltUserIdsで検索
            let foundUser = users.find(u => u.userId === userId);
            if (!foundUser) {
                foundUser = users.find(u => u.altUserIds && u.altUserIds.includes(userId));
            }
            if (foundUser) {
                setHistoryUser(foundUser);
            }
        }
    }, [users, searchParams]);

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

                    // 重複排除（AdminUser.jsxと同じ3段階ロジック）
                    const completenessScore = (u) => {
                        let score = 0;
                        if (u.lastName || u.firstName) score += 2;
                        if (u.defaultLocation && u.defaultLocation !== "未記載") score += 1;
                        if (u.defaultDepartment && u.defaultDepartment !== "未記載") score += 1;
                        if (u.startDate) score += 1;
                        if (u.employmentType) score += 1;
                        if (u.hourlyWage) score += 1;
                        return score;
                    };

                    // Step 1: loginId（大文字小文字を区別せず）で重複排除（代替IDを蓄積）
                    const loginIdMap = new Map();
                    list.forEach(user => {
                        if (!user.loginId) return;
                        const key = user.loginId.toLowerCase();
                        const existing = loginIdMap.get(key);
                        if (!existing) {
                            loginIdMap.set(key, { ...user, altUserIds: [user.userId] });
                        } else if (completenessScore(user) > completenessScore(existing)) {
                            // 新しい方を採用し、古い方のIDを代替IDに追加
                            loginIdMap.set(key, { ...user, altUserIds: [...(existing.altUserIds || [existing.userId]), user.userId] });
                        } else {
                            // 既存の方が優秀、新しい方のIDを代替IDに追加
                            existing.altUserIds = [...(existing.altUserIds || [existing.userId]), user.userId];
                        }
                    });

                    // Step 2: 同じ氏名（lastName + firstName）で重複排除
                    const nameMap = new Map();
                    Array.from(loginIdMap.values()).forEach(user => {
                        const ln = (user.lastName || "").trim();
                        const fn = (user.firstName || "").trim();
                        if (!ln && !fn) {
                            nameMap.set(`__no_name__${user.loginId}`, user);
                            return;
                        }
                        const nameKey = normalizeName(`${ln}${fn}`);
                        const existing = nameMap.get(nameKey);
                        if (!existing) {
                            nameMap.set(nameKey, user);
                        } else if (completenessScore(user) > completenessScore(existing)) {
                            nameMap.set(nameKey, { ...user, altUserIds: [...new Set([...(existing.altUserIds || [existing.userId]), ...(user.altUserIds || [user.userId])])] });
                        } else {
                            existing.altUserIds = [...new Set([...(existing.altUserIds || [existing.userId]), ...(user.altUserIds || [user.userId])])];
                        }
                    });
                    list = Array.from(nameMap.values());

                    // テストユーザーを除外
                    const EXCLUDED_NAMES = new Set(["bb", "テスト", "テストユーザー"]);
                    list = list.filter(u => {
                        const name = normalizeName((u.lastName || "") + (u.firstName || ""));
                        return !EXCLUDED_NAMES.has(name);
                    });

                    // 入社日順でソート（スプレッドシートの名簿順）
                    const HIRE_ORDER = [
                        "眞葛澪", "黒宮悠太", "斉藤七海", "伊藤麻哉", "小河原愛実",
                        "平山士穏", "加藤朝陽", "小河原豪", "黒木統丞", "西川菜緒", "小野麻梨花",
                        "島田絢菜", "冨工元晴", "山口紘生", "藪中悠太", "関口将聡",
                        "北川祐人", "長田明香里", "山本拓実", "佐々木幸隆", "高木最哉",
                        "丸岡美月", "柳下啓志", "重野太紀",
                        "藤井柾志", "平松菜織", "柳有綺", "井本莉緒", "伊佐有希",
                        "梶原佑太", "山田有輝奈", "川嶋恭志郎", "内田大貴", "土屋沙織",
                        "平松陽和", "原凛成",
                        "橋本ひなた", "庵原咲南", "江刺家仁実",
                        "梅屋礼", "高橋優希", "安藤祐貴", "吉田匡希", "赤穂佳弘",
                        "楠海音", "河内顕", "後藤綾菜", "市川美羽", "中崎優人", "赤津優大",
                        "溝口哲太", "加藤広",
                        "洪潤太", "池賢秀", "岩佐康祐", "広瀬チアーゴ清幸",
                        "原雅也", "黒岡響生", "三富凜梨花", "奈良歩美", "ギジェルモ",
                        "髙田祥太朗", "水谷泰智", "竹中勇馬", "高木風ナシーム", "三浦あま音",
                        "米山拓哉", "三浦夢大", "渡辺快", "相場大知", "清水優羽",
                        "足立慎吾", "渡邉瑛太", "西塚エマ", "鈴木由里香",
                        "松本裕希", "嶋中美波", "近藤滝", "田島一平", "菊池陽平",
                        "渡邉愛菜", "桑山響", "山田純也", "小林由奈", "佐伯鈴昌", "田和瑠久", "土屋勇介"
                    ];
                    const orderMap = {};
                    HIRE_ORDER.forEach((name, i) => { orderMap[normalizeName(name)] = i; });
                    list.sort((a, b) => {
                        const na = normalizeName((a.lastName || "") + (a.firstName || ""));
                        const nb = normalizeName((b.lastName || "") + (b.firstName || ""));
                        const ia = orderMap[na] ?? 9999;
                        const ib = orderMap[nb] ?? 9999;
                        if (ia !== ib) return ia - ib;
                        return na.localeCompare(nb, "ja");
                    });
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
            fetchUserHistory(historyUser);
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

    const fetchUserHistory = async (user) => {
        setLoadingHistory(true);
        try {
            // altUserIdsから全データ取得
            const allIds = user.altUserIds && user.altUserIds.length > 0
                ? [...new Set(user.altUserIds)]
                : [user.userId];

            let allItems = [];
            for (const uid of allIds) {
                try {
                    const res = await fetch(`${API_BASE}/attendance?userId=${uid}`);
                    const data = await res.json();
                    if (data.success && Array.isArray(data.items)) {
                        allItems.push(...data.items);
                    }
                } catch (e) { /* skip failed fetch */ }
            }

            let targetPrefix = "";
            if (viewMode === "month") {
                targetPrefix = baseDate.slice(0, 7);
            } else {
                targetPrefix = baseDate.slice(0, 4);
            }

            // Normalize Items
            const normalized = allItems.map(item => {
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

            // 日付ごとに重複排除（clockInがあるレコードを優先）
            const dateMap = new Map();
            filtered.forEach(item => {
                const existing = dateMap.get(item.displayDate);
                if (!existing || (item.clockIn && !existing.clockIn)) {
                    dateMap.set(item.displayDate, item);
                }
            });

            const deduped = Array.from(dateMap.values());
            deduped.sort((a, b) => a.displayDate.localeCompare(b.displayDate));
            setUserItems(deduped);
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

        // 3. Sort
        if (sortKey) {
            result.sort((a, b) => {
                const sa = allUserStats[a.userId];
                const sb = allUserStats[b.userId];
                let va, vb;
                switch (sortKey) {
                    case "name":
                        va = `${a.lastName || ""}${a.firstName || ""}`.trim();
                        vb = `${b.lastName || ""}${b.firstName || ""}`.trim();
                        return sortDir === "asc" ? va.localeCompare(vb, "ja") : vb.localeCompare(va, "ja");
                    case "type":
                        va = a.employmentType || "";
                        vb = b.employmentType || "";
                        return sortDir === "asc" ? va.localeCompare(vb, "ja") : vb.localeCompare(va, "ja");
                    case "days": va = sa?.days ?? -1; vb = sb?.days ?? -1; break;
                    case "dispatch":
                        // 非派遣ユーザーは常に最下位に
                        va = a.employmentType === "派遣" ? (sa?.dispatchMin ?? 0) : -Infinity;
                        vb = b.employmentType === "派遣" ? (sb?.dispatchMin ?? 0) : -Infinity;
                        break;
                    case "partTime": va = sa?.partTimeMin ?? -1; vb = sb?.partTimeMin ?? -1; break;
                    case "total": va = sa?.totalMin ?? -1; vb = sb?.totalMin ?? -1; break;
                    case "late": va = sa?.lateCount ?? -1; vb = sb?.lateCount ?? -1; break;
                    case "early": va = sa?.earlyCount ?? -1; vb = sb?.earlyCount ?? -1; break;
                    case "absent": va = sa?.absentCount ?? -1; vb = sb?.absentCount ?? -1; break;
                    default: return 0;
                }
                return sortDir === "asc" ? va - vb : vb - va;
            });
        }

        return result;
    }, [users, searchQuery, filterType, filterDept, filterLoc, sortKey, sortDir, allUserStats]);

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

        const totalMin = userItems.reduce((acc, i) => {
            if (!i.clockIn || !i.clockOut) return acc;
            let wm = calcRoundedWorkMin(i);
            return acc + wm;
        }, 0);
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
                /* --- サマリーテーブル一覧モード --- */
                <div className="card" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", padding: 0 }}>
                    {/* Search & Filter Header */}
                    <div style={{ padding: "16px", borderBottom: "1px solid #e5e7eb", background: "#f9fafb", flexShrink: 0 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                            <h3 style={{ fontSize: "1rem", fontWeight: "bold", color: "#374151" }}>
                                スタッフ 勤務サマリー
                            </h3>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                {/* 月切り替え */}
                                <div style={{ display: "flex", alignItems: "center", gap: "4px", background: "#fff", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "2px" }}>
                                    <button
                                        onClick={() => {
                                            const d = new Date(baseDate);
                                            d.setMonth(d.getMonth() - 1);
                                            setBaseDate(format(d, "yyyy-MM-dd"));
                                        }}
                                        style={{ border: "none", background: "transparent", cursor: "pointer", padding: "4px 8px", borderRadius: "6px", fontSize: "1rem", color: "#374151", fontWeight: "bold" }}
                                        onMouseEnter={e => e.target.style.background = "#f3f4f6"}
                                        onMouseLeave={e => e.target.style.background = "transparent"}
                                    >
                                        &lt;
                                    </button>
                                    <span style={{ fontWeight: "bold", fontSize: "0.95rem", color: "#1f2937", minWidth: "120px", textAlign: "center" }}>
                                        {baseDate.slice(0, 4)}年 {baseDate.slice(5, 7)}月
                                    </span>
                                    <button
                                        onClick={() => {
                                            const d = new Date(baseDate);
                                            d.setMonth(d.getMonth() + 1);
                                            setBaseDate(format(d, "yyyy-MM-dd"));
                                        }}
                                        style={{ border: "none", background: "transparent", cursor: "pointer", padding: "4px 8px", borderRadius: "6px", fontSize: "1rem", color: "#374151", fontWeight: "bold" }}
                                        onMouseEnter={e => e.target.style.background = "#f3f4f6"}
                                        onMouseLeave={e => e.target.style.background = "transparent"}
                                    >
                                        &gt;
                                    </button>
                                </div>
                                {loadingSummary && (
                                    <span style={{ fontSize: "0.8rem", color: "#f59e0b", display: "flex", alignItems: "center", gap: "4px" }}>
                                        <RefreshCw size={14} className="spin" /> 集計中...
                                    </span>
                                )}
                                <span style={{ fontSize: "0.8rem", color: "#6b7280", background: "#fff", padding: "2px 8px", borderRadius: "12px", border: "1px solid #e5e7eb" }}>
                                    {filteredUsers.length} 名
                                </span>
                            </div>
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
                            <select className="input" value={filterType} onChange={e => setFilterType(e.target.value)}
                                style={{ flex: 1, minWidth: "90px", fontSize: "0.85rem", padding: "6px", borderRadius: "6px" }}>
                                <option value="">形態: 全て</option>
                                {EMPLOYMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                            <select className="input" value={filterDept} onChange={e => setFilterDept(e.target.value)}
                                style={{ flex: 1, minWidth: "90px", fontSize: "0.85rem", padding: "6px", borderRadius: "6px" }}>
                                <option value="">部署: 全て</option>
                                {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                            <select className="input" value={filterLoc} onChange={e => setFilterLoc(e.target.value)}
                                style={{ flex: 1, minWidth: "90px", fontSize: "0.85rem", padding: "6px", borderRadius: "6px" }}>
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

                    {/* テーブル */}
                    <div style={{ flex: 1, overflowY: "auto" }}>
                        {loadingUsers ? (
                            <div style={{ padding: "60px", textAlign: "center", color: "#6b7280" }}>
                                <div className="spin" style={{ display: "inline-block", marginBottom: "8px" }}><RefreshCw size={24} /></div>
                                <div>スタッフ一覧を読み込み中...</div>
                            </div>
                        ) : (
                            <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: "0.95rem" }}>
                                <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
                                    <tr style={{ background: "#f9fafb" }}>
                                        {[
                                            { key: "name", label: "氏名", align: "left", color: "#6b7280" },
                                            { key: "type", label: "形態", align: "center", color: "#6b7280" },
                                            { key: "days", label: "出勤日", align: "right", color: "#6b7280" },
                                            { key: "dispatch", label: "派遣時間", align: "right", color: "#2563eb" },
                                            { key: "partTime", label: "バイト時間", align: "right", color: "#ea580c" },
                                            { key: "total", label: "合計時間", align: "right", color: "#374151" },
                                            { key: "late", label: "遅刻", align: "center", color: "#dc2626" },
                                            { key: "early", label: "早退", align: "center", color: "#7c3aed" },
                                            { key: "absent", label: "欠勤", align: "center", color: "#6b7280" },
                                        ].map(col => (
                                            <th
                                                key={col.key}
                                                onClick={() => handleSort(col.key)}
                                                style={{
                                                    padding: col.key === "name" ? "10px 12px" : "10px 8px",
                                                    textAlign: col.align,
                                                    borderBottom: "1px solid #e5e7eb",
                                                    color: col.color,
                                                    fontWeight: 600,
                                                    whiteSpace: "nowrap",
                                                    cursor: "pointer",
                                                    userSelect: "none",
                                                    background: sortKey === col.key ? "#eef2ff" : "transparent",
                                                    transition: "background 0.15s",
                                                }}
                                            >
                                                <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                                                    {col.label}
                                                    <span style={{ display: "inline-flex", flexDirection: "column", fontSize: "0.6rem", lineHeight: 1, gap: "0px" }}>
                                                        <span style={{ color: sortKey === col.key && sortDir === "asc" ? col.color : "#d1d5db" }}>▲</span>
                                                        <span style={{ color: sortKey === col.key && sortDir === "desc" ? col.color : "#d1d5db" }}>▼</span>
                                                    </span>
                                                </span>
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredUsers.length === 0 ? (
                                        <tr><td colSpan="9" style={{ textAlign: "center", padding: "40px", color: "#9ca3af" }}>条件に一致するスタッフがいません</td></tr>
                                    ) : filteredUsers.map(u => {
                                        const s = allUserStats[u.userId];
                                        const fmtH = (min) => min != null ? `${Math.floor(min / 60)}h${(min % 60).toString().padStart(2, "0")}m` : "-";
                                        return (
                                            <tr
                                                key={u.userId}
                                                onClick={() => setHistoryUser(u)}
                                                style={{ cursor: "pointer", borderBottom: "1px solid #f3f4f6", transition: "background 0.15s" }}
                                                onMouseEnter={e => e.currentTarget.style.background = "#f0f9ff"}
                                                onMouseLeave={e => e.currentTarget.style.background = ""}
                                            >
                                                <td style={{ padding: "10px 12px", fontWeight: "bold", color: "#111827" }}>
                                                    <div>{getDisplayName(u)}</div>
                                                    <div style={{ fontSize: "0.75rem", color: "#9ca3af", fontWeight: "normal" }}>{u.loginId}</div>
                                                </td>
                                                <td style={{ padding: "10px 8px", textAlign: "center" }}>
                                                    <span style={{
                                                        padding: "2px 8px", borderRadius: "12px", fontSize: "0.75rem", fontWeight: 600,
                                                        background: u.employmentType === "派遣" ? "#dbeafe" : "#ffedd5",
                                                        color: u.employmentType === "派遣" ? "#1d4ed8" : "#c2410c"
                                                    }}>
                                                        {u.employmentType || "未設定"}
                                                    </span>
                                                </td>
                                                <td style={{ padding: "12px 10px", textAlign: "right", color: "#374151", fontSize: "0.95rem" }}>{s ? `${s.days}日` : "-"}</td>
                                                <td style={{ padding: "12px 10px", textAlign: "right", color: u.employmentType === "派遣" ? "#2563eb" : "#d1d5db", fontWeight: s?.dispatchMin ? 600 : 400, fontSize: "0.95rem" }}>{u.employmentType === "派遣" ? (s ? fmtH(s.dispatchMin) : "-") : "-"}</td>
                                                <td style={{ padding: "12px 10px", textAlign: "right", color: "#ea580c", fontWeight: s?.partTimeMin ? 600 : 400, fontSize: "0.95rem" }}>{s ? fmtH(s.partTimeMin) : "-"}</td>
                                                <td style={{ padding: "12px 10px", textAlign: "right", fontWeight: 600, color: "#111827", fontSize: "0.95rem" }}>{s ? fmtH(s.totalMin) : "-"}</td>
                                                <td style={{ padding: "12px 10px", textAlign: "center", color: s?.lateCount ? "#dc2626" : "#d1d5db", fontWeight: s?.lateCount ? 700 : 400, fontSize: "0.95rem" }}>{s ? s.lateCount : "-"}</td>
                                                <td style={{ padding: "12px 10px", textAlign: "center", color: s?.earlyCount ? "#7c3aed" : "#d1d5db", fontWeight: s?.earlyCount ? 700 : 400, fontSize: "0.95rem" }}>{s ? s.earlyCount : "-"}</td>
                                                <td style={{ padding: "12px 10px", textAlign: "center", color: s?.absentCount ? "#6b7280" : "#d1d5db", fontWeight: s?.absentCount ? 700 : 400, fontSize: "0.95rem" }}>{s ? s.absentCount : "-"}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
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
                        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                            <button className="btn btn-outline" onClick={() => navigate(`/admin/attendance?userId=${historyUser.userId}`)} style={{ borderColor: "#3b82f6", color: "#3b82f6" }}>
                                勤怠管理で開く
                            </button>
                            <button className="btn btn-outline" onClick={() => setHistoryUser(null)}>
                                <ArrowLeft size={16} style={{ marginRight: "4px" }} /> 一覧に戻る
                            </button>
                        </div>
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
                                adminMode={true}
                                onRowClick={(dateStr, item) => {
                                    // 勤怠管理画面にユーザーID+日付付きで遷移
                                    const userId = historyUser?.userId || item?.userId;
                                    if (userId) {
                                        navigate(`/admin/attendance?userId=${userId}&date=${dateStr}`);
                                    }
                                }}
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
