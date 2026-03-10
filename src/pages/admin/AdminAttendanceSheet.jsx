import React, { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay } from "date-fns";
import { ja } from "date-fns/locale";
import { fetchShiftData } from "../../utils/shiftParser";

const API_BASE = "https://lfsu60xvw7.execute-api.ap-northeast-1.amazonaws.com";
const API_USER_URL = `${API_BASE}/users`;

const DAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];
const EXCLUDED_NAMES = new Set(["bb", "テスト", "テストユーザー"]);

const parseComment = (raw) => {
    try {
        if (!raw) return { segments: [], text: "", application: null, auditLog: [] };
        if (typeof raw === "object") {
            if (Array.isArray(raw)) return { segments: raw, text: "", auditLog: [] };
            return { segments: raw.segments || [], text: raw.text || "", application: raw.application || null, auditLog: raw.auditLog || [] };
        }
        const parsed = JSON.parse(raw);
        if (!parsed) return { segments: [], text: raw, auditLog: [] };
        if (Array.isArray(parsed)) return { segments: parsed, text: "", auditLog: [] };
        if (typeof parsed === "object") {
            return { segments: parsed.segments || [], text: parsed.text || "", application: parsed.application || null, auditLog: parsed.auditLog || [] };
        }
        return { segments: [], text: raw, auditLog: [] };
    } catch { return { segments: [], text: raw || "", auditLog: [] }; }
};

const normalizeName = (s) => (s || "").replace(/\s+/g, "").trim();

const toMin = (t) => {
    if (!t) return 0;
    const parts = t.split(":");
    return parseInt(parts[0]) * 60 + parseInt(parts[1] || 0);
};

// 0.5刻みに丸める（30分単位、切り捨て）
const roundHalf = (v) => (Math.floor(v * 2) / 2).toFixed(1);

const calcHours = (startStr, endStr) => {
    if (!startStr || !endStr) return "";
    const s = toMin(startStr);
    const e = toMin(endStr);
    if (e <= s) return "";
    return roundHalf((e - s) / 60);
};

export default function AdminAttendanceSheet() {
    const navigate = useNavigate();
    const [currentMonth, setCurrentMonth] = useState(new Date());
    const [users, setUsers] = useState([]);
    const [attendanceMap, setAttendanceMap] = useState({});
    const [shiftMap, setShiftMap] = useState({});
    const [loading, setLoading] = useState(true);
    const tableRef = useRef(null);
    const todayRowRef = useRef(null);

    // 承認モーダル
    const [confirmModal, setConfirmModal] = useState({ open: false, user: null, dateStr: "", cell: null });

    const isAdmin = ["admin", "super_admin"].includes(localStorage.getItem("role"));

    const days = useMemo(() => {
        const start = startOfMonth(currentMonth);
        const end = endOfMonth(currentMonth);
        return eachDayOfInterval({ start, end });
    }, [currentMonth]);

    const todayStr = format(new Date(), "yyyy-MM-dd");

    // ユーザー取得
    const fetchUsers = useCallback(async () => {
        try {
            const res = await fetch(API_USER_URL);
            const data = await res.json();
            let list = data.items || data.Items || (Array.isArray(data) ? data : []);
            list = list.filter(u => {
                if (u.role === "admin" || u.role === "super_admin") return false;
                const name = normalizeName((u.lastName || "") + (u.firstName || ""));
                if (EXCLUDED_NAMES.has(name)) return false;
                return true;
            });
            // loginIdベースで重複排除（消されたuserIdも保持、重要フィールドもマージ）
            const mergeImportantFields = (target, source) => {
                // 消される側のユーザーが持つ重要フィールドをマージ
                const fields = ['employmentType', 'defaultLocation', 'defaultDepartment', 'hourlyWage', 'startDate'];
                fields.forEach(f => {
                    if (!target[f] && source[f]) target[f] = source[f];
                });
            };
            const loginIdMap = {};
            list.forEach(u => {
                const lid = (u.loginId || "").toLowerCase();
                if (!loginIdMap[lid]) {
                    loginIdMap[lid] = { ...u, altUserIds: [u.userId] };
                } else {
                    const existing = loginIdMap[lid];
                    const altIds = [...(existing.altUserIds || [existing.userId]), u.userId];
                    const existingTs = existing.createdAt || existing.userId || "";
                    const newTs = u.createdAt || u.userId || "";
                    if (newTs > existingTs) {
                        const merged = { ...u, altUserIds: altIds };
                        mergeImportantFields(merged, existing);
                        loginIdMap[lid] = merged;
                    } else {
                        existing.altUserIds = altIds;
                        mergeImportantFields(existing, u);
                    }
                }
            });
            list = Object.values(loginIdMap);

            // 同姓同名ユーザーをマージ（打刻データが別IDに紐づくケース対応）
            const nameMap = {};
            list.forEach(u => {
                const fullName = normalizeName((u.lastName || "") + (u.firstName || ""));
                if (!nameMap[fullName]) {
                    nameMap[fullName] = { ...u, altUserIds: [...(u.altUserIds || [u.userId])] };
                } else {
                    // 既存のユーザーに代替IDを追加
                    const newIds = u.altUserIds || [u.userId];
                    nameMap[fullName].altUserIds = [...new Set([...(nameMap[fullName].altUserIds || []), ...newIds])];
                }
            });
            list = Object.values(nameMap);

            list.sort((a, b) => {
                const na = (a.lastName || "") + (a.firstName || "");
                const nb = (b.lastName || "") + (b.firstName || "");
                return na.localeCompare(nb, "ja");
            });
            setUsers(list);
        } catch (e) {
            console.error("Failed to fetch users:", e);
            setUsers([]);
            setLoading(false);
        }
    }, []);

    // 1日分のデータ取得（リトライ付き）
    const fetchOneDay = async (day, retries = 3) => {
        const dateStr = format(day, "yyyy-MM-dd");
        for (let attempt = 0; attempt < retries; attempt++) {
            try {
                const r = await fetch(`${API_BASE}/admin/attendance?date=${dateStr}`);
                if (r.status === 503 || r.status === 429) {
                    // サーバー過負荷 → 待ってリトライ
                    await new Promise(res => setTimeout(res, 500 * (attempt + 1)));
                    continue;
                }
                if (!r.ok) return { dateStr, items: [] };
                const data = await r.json().catch(() => ({ items: [] }));
                const items = data?.items || data?.Items || (Array.isArray(data) ? data : []);
                return { dateStr, items: Array.isArray(items) ? items : [] };
            } catch {
                if (attempt < retries - 1) {
                    await new Promise(res => setTimeout(res, 300 * (attempt + 1)));
                }
            }
        }
        return { dateStr, items: [] };
    };

    // 勤怠データ取得（チャンク方式で安定取得）
    const fetchAttendances = useCallback(async () => {
        setLoading(true);
        try {
            const dateFrom = format(startOfMonth(currentMonth), "yyyy-MM-dd");
            const dateTo = format(endOfMonth(currentMonth), "yyyy-MM-dd");

            // 5日ずつチャンクで取得（APIの負荷軽減）
            const CHUNK_SIZE = 5;
            const map = {};
            for (let i = 0; i < days.length; i += CHUNK_SIZE) {
                const chunk = days.slice(i, i + CHUNK_SIZE);
                const chunkResults = await Promise.all(chunk.map(day => fetchOneDay(day)));
                chunkResults.forEach(({ dateStr, items }) => {
                    items.forEach(item => {
                        if (item && item.userId) {
                            map[`${item.userId}_${dateStr}`] = item;
                        }
                    });
                });
                // チャンク間に少し待機
                if (i + CHUNK_SIZE < days.length) {
                    await new Promise(res => setTimeout(res, 100));
                }
            }
            setAttendanceMap(map);

            // シフトデータ取得（スプシCSVベースでfetchShiftDataを使用 → 個人履歴と同一データソース）
            try {
                const shiftData = await fetchShiftData();
                setShiftMap(shiftData || {});
            } catch (e) {
                console.error("Failed to fetch shift data:", e);
            }
        } catch (e) { console.error("Failed to fetch data:", e); }
        setLoading(false);
    }, [currentMonth, days]);

    useEffect(() => { fetchUsers(); }, [fetchUsers]);
    useEffect(() => { if (users.length > 0) fetchAttendances(); }, [fetchAttendances, users]);

    // 当日行に自動スクロール
    useEffect(() => {
        if (!loading && todayRowRef.current && tableRef.current) {
            const container = tableRef.current;
            const row = todayRowRef.current;
            const headerHeight = 70;
            const containerRect = container.getBoundingClientRect();
            const rowRect = row.getBoundingClientRect();
            const scrollTop = rowRect.top - containerRect.top + container.scrollTop - headerHeight;
            container.scrollTo({ top: Math.max(0, scrollTop), behavior: "smooth" });
        }
    }, [loading]);

    // ユーザーのシフト検索
    const getUserShift = useCallback((user, dateStr) => {
        const fullName = normalizeName((user.lastName || "") + (user.firstName || ""));
        for (const shiftUserName of Object.keys(shiftMap)) {
            if (normalizeName(shiftUserName) === fullName) {
                const dayShift = shiftMap[shiftUserName]?.[dateStr];
                if (dayShift) return dayShift;
            }
        }
        return null;
    }, [shiftMap]);

    // ユーザーが派遣属性かチェック
    const isDispatchUser = useCallback((user) => {
        if (user.employmentType === "派遣") return true;
        const fullName = normalizeName((user.lastName || "") + (user.firstName || ""));
        for (const shiftUserName of Object.keys(shiftMap)) {
            if (normalizeName(shiftUserName) === fullName) {
                const userShifts = shiftMap[shiftUserName];
                for (const dateStr of Object.keys(userShifts || {})) {
                    if (userShifts[dateStr]?.isDispatch) return true;
                }
            }
        }
        return false;
    }, [shiftMap]);

    // セルデータ取得
    const getCellData = useCallback((user, dateStr) => {
        // メインuserIdで検索、見つからなければaltUserIdsで検索
        let att = attendanceMap[`${user.userId}_${dateStr}`];
        if (!att && user.altUserIds) {
            for (const altId of user.altUserIds) {
                const altAtt = attendanceMap[`${altId}_${dateStr}`];
                if (altAtt) { att = altAtt; break; }
            }
        }
        const shift = getUserShift(user, dateStr);
        const p = att ? parseComment(att.comment) : null;
        const app = p?.application;

        let status = "no_shift";
        let clockIn = "";
        let clockOut = "";
        let hours = "";
        let confirmedBy = null;

        // シフトがある場合
        if (shift && !shift.isOff && (shift.start || shift.end)) {
            status = "scheduled";
        }

        if (att) {
            clockIn = att.clockIn || "";
            clockOut = att.clockOut || "";

            if (app) {
                if (app.confirmedBy) {
                    status = "confirmed";
                    confirmedBy = app.confirmedBy;
                    clockIn = app.appliedIn || clockIn;
                    clockOut = app.appliedOut || clockOut;
                } else if (app.status === "approved") {
                    status = "approved";
                    clockIn = app.appliedIn || clockIn;
                    clockOut = app.appliedOut || clockOut;
                } else if (app.status === "resubmission_requested") {
                    status = "resubmission";
                } else if (app.status === "pending") {
                    status = "pending";
                    clockIn = app.appliedIn || clockIn;
                    clockOut = app.appliedOut || clockOut;
                } else if (app.status === "cancelled") {
                    status = "cancelled";
                }
            } else if (clockIn && !clockOut) {
                status = "working";
            } else if (clockIn) {
                status = "no_application";
            }
        }

        // 表示用の開始/終了/時間を決定
        let displayIn = "";
        let displayOut = "";

        if (status === "scheduled") {
            // シフトのみ（打刻なし）→ 時刻は表示しない（背景色のみ白にする）
            // 実際の勤怠データがないため空のまま
        } else if (clockIn) {
            // 打刻がある場合
            const isDispatch = (shift && shift.isDispatch) || (!shift && isDispatchUser(user));
            if (isDispatch && shift && shift.partTimeRange) {
                // 派遣: シフトにバイト時間範囲がある場合 → そこだけ計算
                const ptStart = toMin(shift.partTimeRange.start);
                const inMin = toMin(clockIn);
                const actualStartMin = Math.max(inMin, ptStart);
                displayIn = `${String(Math.floor(actualStartMin / 60)).padStart(2, "0")}:${String(actualStartMin % 60).padStart(2, "0")}`;
                displayOut = clockOut ? clockOut.substring(0, 5) : "";
                if (clockOut) {
                    const outMin = toMin(clockOut);
                    const workMin = Math.max(0, outMin - actualStartMin);
                    hours = roundHalf(workMin / 60);
                }
            } else if (isDispatch && !shift) {
                // 派遣: 過去月などシフトデータなし → 打刻時間をそのままバイト時間として表示
                displayIn = clockIn.substring(0, 5);
                displayOut = clockOut ? clockOut.substring(0, 5) : "";
                if (clockOut) {
                    hours = calcHours(clockIn, clockOut);
                }
            } else {
                displayIn = clockIn.substring(0, 5);
                displayOut = clockOut ? clockOut.substring(0, 5) : "";
                if (clockOut) {
                    hours = calcHours(clockIn, clockOut);
                }
            }
        }

        return { status, clockIn, clockOut, displayIn, displayOut, hours, confirmedBy, att, shift, app };
    }, [attendanceMap, getUserShift, isDispatchUser]);

    // セルクリック → モーダル表示（データがあるセル全般）
    const handleCellClick = useCallback((user, dateStr) => {
        if (!isAdmin) return;
        const cell = getCellData(user, dateStr);
        // データがあるセル（no_shift以外）でモーダルを表示
        if (cell.status !== "no_shift" && cell.status !== "scheduled") {
            setConfirmModal({ open: true, user, dateStr, cell });
        }
    }, [getCellData, isAdmin]);

    // モーダルから承認実行
    const executeConfirm = async () => {
        const { user, dateStr } = confirmModal;
        if (!user) return;
        const key = `${user.userId}_${dateStr}`;
        const att = attendanceMap[key];
        if (!att) return;
        const p = parseComment(att.comment);
        if (!p.application || p.application.status !== "approved") return;
        if (p.application.confirmedBy) return;
        const newApp = { ...p.application, confirmedBy: "上位管理者", confirmedAt: new Date().toISOString() };
        const newComment = JSON.stringify({
            segments: p.segments, text: p.text, application: newApp,
            auditLog: [...(p.auditLog || []), { action: "confirmed", by: "上位管理者", at: new Date().toISOString(), detail: "最終承認しました" }]
        });
        try {
            await fetch(`${API_BASE}/attendance/update`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId: att.userId, workDate: att.workDate, clockIn: att.clockIn, clockOut: att.clockOut, breaks: att.breaks || [], comment: newComment })
            });
            setAttendanceMap(prev => ({ ...prev, [key]: { ...att, comment: newComment } }));
        } catch (e) { alert("エラーが発生しました"); }
        setConfirmModal({ open: false, user: null, dateStr: "", cell: null });
    };

    const closeConfirmModal = () => setConfirmModal({ open: false, user: null, dateStr: "", cell: null });

    // セルの背景色
    const getCellBg = (status) => {
        switch (status) {
            case "confirmed": return "#fef08a";
            case "approved": return "#ffffff";
            case "pending": return "#fed7aa";
            case "resubmission": return "#e9d5ff";
            case "no_shift": return "#f3f4f6";
            case "scheduled": return "#ffffff";
            case "working": return "#dbeafe";
            case "cancelled": return "#fecaca";
            case "no_application": return "#fed7aa"; // 承認待ちと同じオレンジ
            default: return "#f9fafb";
        }
    };

    const prevMonth = () => setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
    const nextMonth = () => setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));

    // 各ユーザーの月次合計
    const getUserMonthTotal = useCallback((user) => {
        let totalHours = 0;
        let workDays = 0;
        days.forEach(day => {
            const dateStr = format(day, "yyyy-MM-dd");
            const cell = getCellData(user, dateStr);
            if (cell.hours && parseFloat(cell.hours) > 0) {
                totalHours += parseFloat(cell.hours);
                workDays++;
            }
        });
        return { totalHours: totalHours.toFixed(1), workDays };
    }, [days, getCellData]);

    const cellBorder = "1px solid #d1d5db";
    const userSeparator = "2px solid #9ca3af";

    return (
        <div style={{ padding: "16px", maxWidth: "100%", overflow: "hidden", display: "flex", flexDirection: "column", height: "calc(100vh - 70px)" }}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px", flexShrink: 0 }}>
                <h2 style={{ margin: 0, fontSize: "1.3rem", color: "#1f2937" }}>📊 勤怠確認シート</h2>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <button onClick={prevMonth} style={{ border: "1px solid #d1d5db", background: "#fff", borderRadius: "6px", padding: "6px 12px", cursor: "pointer", fontSize: "1rem" }}>&lt;</button>
                    <span style={{ fontWeight: "bold", fontSize: "1.1rem", minWidth: "160px", textAlign: "center" }}>
                        {format(currentMonth, "yyyy年M月", { locale: ja })}
                    </span>
                    <button onClick={nextMonth} style={{ border: "1px solid #d1d5db", background: "#fff", borderRadius: "6px", padding: "6px 12px", cursor: "pointer", fontSize: "1rem" }}>&gt;</button>
                </div>
            </div>

            {/* 凡例 */}
            <div style={{ display: "flex", gap: "12px", marginBottom: "10px", flexWrap: "wrap", fontSize: "12px", flexShrink: 0 }}>
                {[
                    { color: "#f3f4f6", label: "休み" },
                    { color: "#ffffff", label: "出勤/承認済" },
                    { color: "#fed7aa", label: "未承認" },
                    { color: "#e9d5ff", label: "再提出" },
                    { color: "#fef08a", label: "最終承認" },
                    { color: "#dbeafe", label: "出勤中" },
                    { color: "#fbbf24", border: true, label: "本日" },
                    { color: "#c7d2fe", label: "派遣" },
                ].map(({ color, label, border }) => (
                    <div key={label} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                        <div style={{
                            width: "16px", height: "16px", background: color,
                            border: border ? "2px solid #f59e0b" : "1px solid #d1d5db", borderRadius: "3px"
                        }} />
                        <span>{label}</span>
                    </div>
                ))}
            </div>

            {loading ? (
                <div style={{ textAlign: "center", padding: "60px 0", color: "#6b7280", flex: 1 }}>
                    <div style={{ fontSize: "24px", marginBottom: "8px" }}>⏳</div>
                    データ読み込み中...
                </div>
            ) : (
                /* 単一テーブル方式: tfoot を sticky で固定 */
                <div ref={tableRef} style={{
                    flex: 1, overflow: "auto", border: "1px solid #d1d5db", borderRadius: "8px",
                    position: "relative"
                }}>
                    <table style={{ borderCollapse: "collapse", fontSize: "11px", whiteSpace: "nowrap", width: "max-content", minWidth: "100%" }}>
                        <thead>
                            {/* ユーザー名ヘッダー */}
                            <tr style={{ position: "sticky", top: 0, zIndex: 5 }}>
                                <th style={{
                                    position: "sticky", left: 0, zIndex: 6, background: "#1f2937", color: "#fff",
                                    padding: "8px 6px", borderRight: userSeparator, borderBottom: "1px solid #374151",
                                    textAlign: "center", minWidth: "80px"
                                }}>
                                    日付
                                </th>
                                {users.map((u, idx) => {
                                    const dispatch = isDispatchUser(u);
                                    return (
                                        <th key={u.userId} colSpan={3} style={{
                                            background: dispatch ? "#4338ca" : "#1f2937",
                                            color: "#fff", padding: "8px 4px",
                                            borderRight: idx < users.length - 1 ? userSeparator : cellBorder,
                                            borderBottom: "1px solid #374151", textAlign: "center",
                                            cursor: "pointer"
                                        }}
                                            onClick={() => navigate(`/admin/history?userId=${u.userId}`)}
                                            title={`${(u.lastName || "") + (u.firstName || "")}の個人履歴へ`}
                                        >
                                            {dispatch && <span style={{ fontSize: "9px", background: "#a5b4fc", color: "#312e81", padding: "1px 4px", borderRadius: "3px", marginRight: "4px" }}>派遣</span>}
                                            <span style={{ textDecoration: "underline", textUnderlineOffset: "3px" }}>
                                                {(u.lastName || "") + (u.firstName || "")}
                                            </span>
                                        </th>
                                    );
                                })}
                            </tr>
                            {/* サブヘッダー */}
                            <tr style={{ position: "sticky", top: "35px", zIndex: 5 }}>
                                <th style={{
                                    position: "sticky", left: 0, zIndex: 6, background: "#374151", color: "#d1d5db",
                                    padding: "4px 6px", borderRight: userSeparator, borderBottom: "2px solid #4b5563",
                                    fontSize: "10px", minWidth: "80px"
                                }}>
                                    曜日
                                </th>
                                {users.map((u, idx) => (
                                    <React.Fragment key={u.userId}>
                                        <th style={{ background: "#374151", color: "#d1d5db", padding: "4px 2px", borderBottom: "2px solid #4b5563", fontSize: "10px", textAlign: "center", minWidth: "42px" }}>開始</th>
                                        <th style={{ background: "#374151", color: "#d1d5db", padding: "4px 2px", borderBottom: "2px solid #4b5563", fontSize: "10px", textAlign: "center", minWidth: "42px" }}>終了</th>
                                        <th style={{ background: "#374151", color: "#d1d5db", padding: "4px 2px", borderBottom: "2px solid #4b5563", fontSize: "10px", textAlign: "center", borderRight: idx < users.length - 1 ? userSeparator : cellBorder, minWidth: "36px" }}>合計</th>
                                    </React.Fragment>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {days.map((day) => {
                                const dateStr = format(day, "yyyy-MM-dd");
                                const dow = getDay(day);
                                const isWeekend = dow === 0 || dow === 6;
                                const isTodayRow = dateStr === todayStr;
                                const dayLabel = `${format(day, "d")}日`;

                                return (
                                    <tr
                                        key={dateStr}
                                        ref={isTodayRow ? todayRowRef : undefined}
                                        style={{ background: isTodayRow ? "#fffbeb" : isWeekend ? "#f9fafb" : "transparent" }}
                                    >
                                        <td style={{
                                            position: "sticky", left: 0, zIndex: 2,
                                            background: isTodayRow ? "#f59e0b" : isWeekend ? "#f3f4f6" : "#fff",
                                            color: isTodayRow ? "#fff" : dow === 0 ? "#dc2626" : dow === 6 ? "#2563eb" : "#374151",
                                            padding: "4px 6px", borderRight: userSeparator,
                                            borderBottom: cellBorder, fontWeight: "bold",
                                            textAlign: "center",
                                            boxShadow: isTodayRow ? "inset 0 0 0 2px #f59e0b" : "none"
                                        }}>
                                            {dayLabel}({DAY_LABELS[dow]})
                                        </td>
                                        {users.map((u, uIdx) => {
                                            const cell = getCellData(u, dateStr);
                                            const bg = getCellBg(cell.status);
                                            const hasData = isAdmin && cell.status !== "no_shift" && cell.status !== "scheduled";
                                            const isLastUser = uIdx === users.length - 1;

                                            const baseCellStyle = {
                                                padding: "3px 4px",
                                                borderBottom: cellBorder,
                                                borderRight: cellBorder,
                                                textAlign: "center",
                                                background: isTodayRow && cell.status === "no_shift" ? "#fef3c7" : bg,
                                                cursor: hasData ? "pointer" : "default",
                                                transition: "background 0.15s",
                                                boxShadow: isTodayRow ? "inset 0 1px 0 0 #fbbf24, inset 0 -1px 0 0 #fbbf24" : "none",
                                                overflow: "hidden",
                                                minWidth: "42px"
                                            };

                                            const handleClick = () => { if (hasData) handleCellClick(u, dateStr); };

                                            return (
                                                <React.Fragment key={u.userId}>
                                                    <td style={baseCellStyle} onClick={handleClick} title={hasData ? "クリックで詳細表示" : ""}>
                                                        {cell.displayIn}
                                                    </td>
                                                    <td style={baseCellStyle} onClick={handleClick}>
                                                        {cell.displayOut}
                                                    </td>
                                                    <td style={{
                                                        ...baseCellStyle,
                                                        borderRight: isLastUser ? cellBorder : userSeparator,
                                                        fontWeight: cell.hours ? "bold" : "normal",
                                                        minWidth: "36px"
                                                    }} onClick={handleClick}>
                                                        {cell.hours && parseFloat(cell.hours) > 0 ? cell.hours : ""}
                                                    </td>
                                                </React.Fragment>
                                            );
                                        })}
                                    </tr>
                                );
                            })}
                        </tbody>
                        {/* 合計行 - 同じテーブル内のtfootでsticky固定 → 列ズレなし */}
                        <tfoot>
                            <tr style={{
                                position: "sticky", bottom: 0, zIndex: 3,
                                background: "#dbeafe", fontWeight: "bold"
                            }}>
                                <td style={{
                                    position: "sticky", left: 0, zIndex: 4,
                                    background: "#1e40af", color: "#fff",
                                    padding: "8px 6px", borderRight: userSeparator,
                                    borderTop: "2px solid #1e40af",
                                    textAlign: "center", fontSize: "11px",
                                }}>
                                    合計
                                </td>
                                {users.map((u, uIdx) => {
                                    const totals = getUserMonthTotal(u);
                                    const isLastUser = uIdx === users.length - 1;
                                    return (
                                        <React.Fragment key={u.userId}>
                                            <td colSpan={2} style={{
                                                padding: "8px 4px", background: "#dbeafe",
                                                textAlign: "center", borderRight: cellBorder,
                                                borderTop: "2px solid #1e40af",
                                                fontSize: "11px", color: "#1e40af"
                                            }}>
                                                {totals.workDays}日
                                            </td>
                                            <td style={{
                                                padding: "8px 4px", background: "#dbeafe",
                                                textAlign: "center",
                                                borderRight: isLastUser ? cellBorder : userSeparator,
                                                borderTop: "2px solid #1e40af",
                                                fontSize: "11px", color: "#1e40af", fontWeight: "bold"
                                            }}>
                                                {totals.totalHours}h
                                            </td>
                                        </React.Fragment>
                                    );
                                })}
                            </tr>
                        </tfoot>
                    </table>
                </div>
            )}

            {/* 承認モーダル */}
            {confirmModal.open && confirmModal.user && (() => {
                const modalCell = confirmModal.cell;
                const canApprove = modalCell?.status === "approved";
                const STATUS_LABELS = {
                    approved: { icon: "✅", label: "承認済み", color: "#16a34a" },
                    pending: { icon: "⏳", label: "承認待ち", color: "#f59e0b" },
                    resubmission: { icon: "🔄", label: "再提出", color: "#8b5cf6" },
                    confirmed: { icon: "🏆", label: "最終承認済み", color: "#2563eb" },
                    working: { icon: "💼", label: "出勤中", color: "#3b82f6" },
                    no_application: { icon: "📋", label: "未申請", color: "#d97706" },
                    cancelled: { icon: "❌", label: "取消済み", color: "#dc2626" },
                };
                const st = STATUS_LABELS[modalCell?.status] || { icon: "📊", label: "勤怠情報", color: "#374151" };
                return (
                    <div style={{
                        position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
                        background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center",
                        zIndex: 1000
                    }} onClick={closeConfirmModal}>
                        <div style={{
                            background: "#fff", borderRadius: "16px", padding: "32px",
                            maxWidth: "420px", width: "90%", boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
                            textAlign: "center"
                        }} onClick={e => e.stopPropagation()}>
                            <div style={{ fontSize: "36px", marginBottom: "12px" }}>{st.icon}</div>
                            <h3 style={{ margin: "0 0 4px 0", fontSize: "1.2rem", color: "#1f2937" }}>
                                {canApprove ? "最終承認" : st.label}
                            </h3>
                            <div style={{
                                display: "inline-block", padding: "2px 10px", borderRadius: "12px",
                                background: st.color + "18", color: st.color, fontSize: "0.8rem", fontWeight: "600",
                                marginBottom: "16px"
                            }}>
                                {st.label}
                            </div>
                            <p style={{ color: "#6b7280", marginBottom: "20px", lineHeight: "1.6" }}>
                                <strong style={{ color: "#1f2937" }}>
                                    {(confirmModal.user.lastName || "") + (confirmModal.user.firstName || "")}
                                </strong> さん<br />
                                <strong style={{ color: "#2563eb" }}>{confirmModal.dateStr}</strong>
                                {canApprove && <><br />の勤怠を最終承認しますか？</>}
                            </p>
                            {modalCell && (
                                <div style={{
                                    background: "#f0f9ff", borderRadius: "8px", padding: "12px",
                                    marginBottom: "20px", fontSize: "0.9rem"
                                }}>
                                    <div style={{ display: "flex", justifyContent: "center", gap: "16px" }}>
                                        <span>出勤: <strong>{modalCell.displayIn || "-"}</strong></span>
                                        <span>退勤: <strong>{modalCell.displayOut || "-"}</strong></span>
                                        <span>合計: <strong>{modalCell.hours || "-"}h</strong></span>
                                    </div>
                                </div>
                            )}
                            <div style={{ display: "flex", gap: "12px" }}>
                                <button
                                    onClick={closeConfirmModal}
                                    style={{
                                        flex: 1, padding: "12px", borderRadius: "10px",
                                        border: "1px solid #d1d5db", background: "#fff",
                                        color: "#374151", fontSize: "0.95rem", fontWeight: "600",
                                        cursor: "pointer", transition: "background 0.2s"
                                    }}
                                    onMouseEnter={e => e.target.style.background = "#f3f4f6"}
                                    onMouseLeave={e => e.target.style.background = "#fff"}
                                >
                                    閉じる
                                </button>
                                {canApprove && (
                                    <button
                                        onClick={executeConfirm}
                                        style={{
                                            flex: 1, padding: "12px", borderRadius: "10px",
                                            border: "none", background: "#2563eb",
                                            color: "#fff", fontSize: "0.95rem", fontWeight: "600",
                                            cursor: "pointer", transition: "background 0.2s"
                                        }}
                                        onMouseEnter={e => e.target.style.background = "#1d4ed8"}
                                        onMouseLeave={e => e.target.style.background = "#2563eb"}
                                    >
                                        承認する
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}
