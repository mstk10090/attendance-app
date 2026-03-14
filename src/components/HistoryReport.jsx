import React, { useMemo, useEffect, useState } from "react";
import { format, startOfYear, endOfYear, eachDayOfInterval, isSaturday, isSunday } from "date-fns";
import { ja } from "date-fns/locale";
import { Calendar, Clock, PieChart, CheckCircle, AlertTriangle } from "lucide-react";
import { HOLIDAYS } from "../constants";
import { normalizeName } from "../utils/shiftParser";

/* --- UTILS --- */
const toMin = (t) => {
    if (!t) return 0;
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
};

// 秒を切り捨ててHH:mm形式に変換
const formatTimeHHMM = (timeStr) => {
    if (!timeStr) return null;
    // HH:mm:ss形式の場合はHH:mmに変換
    if (timeStr.includes(":")) {
        const parts = timeStr.split(":");
        return `${parts[0]}:${parts[1]}`;
    }
    return timeStr;
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

const parseComment = (comment) => {
    if (!comment) return { segments: [], text: "", application: null };
    try {
        const parsed = JSON.parse(comment);
        return {
            segments: parsed.segments || [],
            text: parsed.text || "",
            application: parsed.application || null
        };
    } catch {
        return { segments: [], text: comment || "", application: null };
    }
};

const parseStatus = (item) => {
    if (!item.comment) return null;
    try {
        const p = JSON.parse(item.comment);
        if (p && p.application) {
            // 取り下げ済みの場合はステータスなし（未申請）として扱う
            if (p.application.withdrawn) return null;
            return p.application.status;
        }
        return null;
    } catch {
        return null;
    }
};

const extractReason = (item) => {
    if (!item.comment) return null;
    try {
        const p = JSON.parse(item.comment);
        if (p && p.application && p.application.reason) {
            // 大枠のみ返す（括弧部分を除去）
            const reason = p.application.reason;
            const parenIdx = reason.indexOf('（');
            if (parenIdx > 0) return reason.substring(0, parenIdx);
            const parenIdx2 = reason.indexOf('(');
            if (parenIdx2 > 0) return reason.substring(0, parenIdx2).trim();
            return reason;
        }
        if (p.text && p.text.includes("[管理者修正]:")) {
            return "管理者修正";
        }
        return null;
    } catch {
        return null;
    }
}

// 理由の詳細部分（subReason / subReasonText / text）を取得
const extractReasonDetail = (item) => {
    if (!item.comment) return null;
    try {
        const p = JSON.parse(item.comment);
        if (!p || !p.application) return p.text || null;
        const app = p.application;
        const parts = [];
        // subReasonがある場合
        if (app.subReason && app.subReason !== '-') {
            if (app.subReason === 'その他' && app.subReasonText) {
                parts.push(app.subReasonText);
            } else {
                parts.push(app.subReason);
            }
        }
        // 既存データ: reasonに括弧が含まれている場合はそこから詳細を抽出
        if (parts.length === 0 && app.reason) {
            const match = app.reason.match(/[\uff08(](.+?)[\uff09)]/);
            if (match) parts.push(match[1]);
        }
        // textフィールド（出張場所、残業理由、打刻間違い詳細など）
        if (p.text && p.text.trim()) {
            // 既にpartsに同じ内容がない場合のみ追加
            if (!parts.includes(p.text.trim())) {
                parts.push(p.text.trim());
            }
        }
        return parts.length > 0 ? parts.join(' / ') : null;
    } catch {
        return null;
    }
}

const extractAppliedTime = (item) => {
    if (!item.comment) return null;
    try {
        const p = JSON.parse(item.comment);
        if (p && p.application && p.application.appliedIn && p.application.appliedOut) {
            return {
                appliedIn: p.application.appliedIn,
                appliedOut: p.application.appliedOut,
                breakDuration: p.application.breakDuration || 0
            };
        }
        return null;
    } catch {
        return null;
    }
}

const extractAdminComment = (item) => {
    if (!item.comment) return null;
    try {
        const p = JSON.parse(item.comment);
        if (p && p.application && p.application.adminComment) {
            return p.application.adminComment;
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

// shiftMapからユーザーのシフトを取得（複数キーのフォールバック）
const getUserShifts = (shiftMap, user) => {
    if (!shiftMap || !user) return {};
    const ln = (user.lastName || "").trim();
    const fn = (user.firstName || "").trim();
    const normalized = normalizeName(ln + fn);
    if (normalized && shiftMap[normalized]) return shiftMap[normalized];
    if (user.userName && shiftMap[normalizeName(user.userName)]) return shiftMap[normalizeName(user.userName)];
    if (user.loginId && shiftMap[user.loginId]) return shiftMap[user.loginId];
    return {};
};

export default function HistoryReport({ user, items, baseDate, viewMode, shiftMap, onRowClick, onWithdraw, adminMode }) {
    const [expandedReasonId, setExpandedReasonId] = useState(null);


    // Render Stats
    const stats = useMemo(() => {
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

        // 当月のアイテムのみにフィルタリング
        const startStr = format(startD, "yyyy-MM-dd");
        const endStr = format(endD, "yyyy-MM-dd");
        const monthItems = items.filter(i => {
            const d = i.displayDate || i.workDate;
            return d >= startStr && d <= endStr;
        });

        const approvedItems = monthItems.filter(i => {
            const p = parseComment(i.comment);
            const st = p?.application?.status;
            return st === "approved" || (p?.application?.confirmedBy);
        });
        const attendedDates = new Set(approvedItems.filter(i => {
            const p = parseComment(i.comment);
            const effectiveIn = p?.application?.appliedIn || i.clockIn;
            return !!effectiveIn;
        }).map(i => i.displayDate || i.workDate));
        const userShifts = getUserShifts(shiftMap, user);

        // シフト日数（休み以外）
        const today = format(new Date(), "yyyy-MM-dd");
        let shiftDays = 0;
        const allDays = eachDayOfInterval({ start: startD, end: endD });
        allDays.forEach(day => {
            const ds = format(day, "yyyy-MM-dd");
            if (ds > today) return;
            const s = userShifts[ds];
            if (s && !s.isOff) shiftDays++;
        });

        // 遅刻・欠勤カウント
        let lateCount = 0;
        let absentCount = 0;
        let earlyCount = 0;
        let dispatchMin = 0;
        let partTimeMin = 0;

        monthItems.forEach(i => {
            const parsed = parseComment(i.comment);
            const app = parsed?.application;
            // 欠勤
            if (app?.status === "absent") absentCount++;
            // 遅刻
            const dateStr = i.displayDate || i.workDate;
            const shiftForDay = userShifts[dateStr] || null;
            const effectiveClockIn = app?.appliedIn || i.clockIn;
            if (shiftForDay && shiftForDay.start && effectiveClockIn) {
                const lateCancelled = app?.lateCancelled || false;
                const inMin = toMin(effectiveClockIn);
                const startMin = toMin(shiftForDay.start);
                // 申請時間(appliedIn)は「>」で判定（ちょうどは遅刻でない）
                // 打刻(clockIn)は「>=」で判定（ちょうどでも遅刻）
                const isLate = app?.appliedIn ? inMin > startMin : inMin >= startMin;
                if (isLate && !lateCancelled) {
                    lateCount++;
                }
            }
            // 早退
            const earlyCancelled = app?.earlyCancelled || false;
            if (app?.reason && app.reason.includes("早退") && !earlyCancelled) earlyCount++;
        });

        // 派遣/バイト時間の計算（承認済みのみ）— 勤怠管理と同じフルレンジ方式
        approvedItems.forEach(i => {
            const parsed = parseComment(i.comment);
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

            let dayDispatch = 0;
            let dayPartTime = 0;

            if (shift && (shift.dispatchRange || shift.partTimeRange)) {
                // 勤怠管理と同じロジック: dispatchRangeのフルレンジを派遣時間として使用
                if (shift.dispatchRange) {
                    const dS = toMin(shift.dispatchRange.start);
                    const dE = toMin(shift.dispatchRange.end);
                    dayDispatch = dE - dS; // シフト範囲固定
                }
                if (dayDispatch > 8 * 60) {
                    dayPartTime += dayDispatch - 8 * 60;
                    dayDispatch = 8 * 60;
                }
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
            const parsed = parseComment(i.comment);
            const app = parsed?.application || {};
            // appliedIn/Out（申請時間）があればそちらを優先、なければ打刻時間を使用
            const effectiveIn = app.appliedIn || i.clockIn;
            const effectiveOut = app.appliedOut || i.clockOut;
            if (!effectiveIn || !effectiveOut) return acc;
            const inMin = toMin(effectiveIn);
            const outMin = toMin(effectiveOut);
            const breakDur = app.breakDuration || calcBreakTime(i);
            let wm = Math.max(0, outMin - inMin - breakDur);
            wm = Math.floor(wm / 30) * 30; // 30分単位に丸め
            return acc + wm;
        }, 0);
        const missingOut = monthItems.filter(i => i.clockIn && !i.clockOut).length;
        const days = attendedDates.size;

        return {
            totalMin, missingOut, days, shiftDays,
            lateCount, absentCount, earlyCount,
            dispatchMin, partTimeMin
        };
    }, [items, user, baseDate, viewMode, shiftMap]);

    if (!stats) return null;

    const fmtTime = (min) => {
        const h = Math.floor(min / 60);
        const m = min % 60;
        return `${h}h ${m}m`;
    };

    return (
        <div>
            {/* サマリーカード */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "12px", marginBottom: "20px" }}>
                <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: "12px", padding: "14px", textAlign: "center" }}>
                    <div style={{ fontSize: "0.75rem", color: "#0369a1", marginBottom: "4px" }}>シフト日数</div>
                    <div style={{ fontSize: "1.6rem", fontWeight: "bold", color: "#0c4a6e" }}>{stats.shiftDays}<span style={{ fontSize: "0.8rem", fontWeight: "normal" }}>日</span></div>
                </div>
                <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "12px", padding: "14px", textAlign: "center" }}>
                    <div style={{ fontSize: "0.75rem", color: "#15803d", marginBottom: "4px" }}>出勤日数</div>
                    <div style={{ fontSize: "1.6rem", fontWeight: "bold", color: "#14532d" }}>{stats.days}<span style={{ fontSize: "0.8rem", fontWeight: "normal" }}>日</span></div>
                </div>
                <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: "12px", padding: "14px", textAlign: "center" }}>
                    <div style={{ fontSize: "0.75rem", color: "#1d4ed8", marginBottom: "4px" }}>派遣時間</div>
                    <div style={{ fontSize: "1.2rem", fontWeight: "bold", color: "#1e3a5f" }}>{stats.dispatchMin > 0 ? fmtTime(stats.dispatchMin) : "-"}</div>
                </div>
                <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "12px", padding: "14px", textAlign: "center" }}>
                    <div style={{ fontSize: "0.75rem", color: "#16a34a", marginBottom: "4px" }}>バイト時間</div>
                    <div style={{ fontSize: "1.2rem", fontWeight: "bold", color: "#14532d" }}>{stats.partTimeMin > 0 ? fmtTime(stats.partTimeMin) : "-"}</div>
                </div>
                <div style={{ background: stats.lateCount > 0 ? "#fffbeb" : "#f9fafb", border: `1px solid ${stats.lateCount > 0 ? "#fde68a" : "#e5e7eb"}`, borderRadius: "12px", padding: "14px", textAlign: "center" }}>
                    <div style={{ fontSize: "0.75rem", color: "#92400e", marginBottom: "4px" }}>遅刻</div>
                    <div style={{ fontSize: "1.6rem", fontWeight: "bold", color: stats.lateCount > 0 ? "#b45309" : "#9ca3af" }}>{stats.lateCount}<span style={{ fontSize: "0.8rem", fontWeight: "normal" }}>件</span></div>
                </div>
                <div style={{ background: stats.absentCount > 0 ? "#fef2f2" : "#f9fafb", border: `1px solid ${stats.absentCount > 0 ? "#fecaca" : "#e5e7eb"}`, borderRadius: "12px", padding: "14px", textAlign: "center" }}>
                    <div style={{ fontSize: "0.75rem", color: "#991b1b", marginBottom: "4px" }}>欠勤</div>
                    <div style={{ fontSize: "1.6rem", fontWeight: "bold", color: stats.absentCount > 0 ? "#dc2626" : "#9ca3af" }}>{stats.absentCount}<span style={{ fontSize: "0.8rem", fontWeight: "normal" }}>件</span></div>
                </div>
                <div style={{ background: stats.earlyCount > 0 ? "#fffbeb" : "#f9fafb", border: `1px solid ${stats.earlyCount > 0 ? "#fde68a" : "#e5e7eb"}`, borderRadius: "12px", padding: "14px", textAlign: "center" }}>
                    <div style={{ fontSize: "0.75rem", color: "#92400e", marginBottom: "4px" }}>早退</div>
                    <div style={{ fontSize: "1.6rem", fontWeight: "bold", color: stats.earlyCount > 0 ? "#b45309" : "#9ca3af" }}>{stats.earlyCount}<span style={{ fontSize: "0.8rem", fontWeight: "normal" }}>件</span></div>
                </div>
                <div style={{ background: stats.missingOut > 0 ? "#fef2f2" : "#f9fafb", border: `1px solid ${stats.missingOut > 0 ? "#fecaca" : "#e5e7eb"}`, borderRadius: "12px", padding: "14px", textAlign: "center" }}>
                    <div style={{ fontSize: "0.75rem", color: "#991b1b", marginBottom: "4px" }}>打刻漏れ</div>
                    <div style={{ fontSize: "1.6rem", fontWeight: "bold", color: stats.missingOut > 0 ? "#dc2626" : "#9ca3af" }}>{stats.missingOut}<span style={{ fontSize: "0.8rem", fontWeight: "normal" }}>件</span></div>
                </div>
            </div>
            {/* Table List */}
            <div className="table-wrap" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.05)", borderRadius: "8px", overflow: "hidden", border: "1px solid #e5e7eb", maxHeight: "60vh", overflowY: "auto" }}>
                <table className="admin-table" style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
                    <thead>
                        <tr>
                            <th style={{ position: "sticky", top: 0, zIndex: 10, background: "#f9fafb", padding: "12px 16px", textAlign: "left", fontSize: "0.85rem", color: "#6b7280", borderBottom: "1px solid #e5e7eb" }}>日付</th>
                            <th style={{ position: "sticky", top: 0, zIndex: 10, background: "#f9fafb", padding: "12px 16px", textAlign: "center", fontSize: "0.85rem", color: "#6b7280", borderBottom: "1px solid #e5e7eb" }}>シフト</th>
                            <th style={{ position: "sticky", top: 0, zIndex: 10, background: "#f9fafb", padding: "12px 16px", textAlign: "center", fontSize: "0.85rem", color: "#6b7280", borderBottom: "1px solid #e5e7eb" }}>出勤</th>
                            <th style={{ position: "sticky", top: 0, zIndex: 10, background: "#f9fafb", padding: "12px 16px", textAlign: "center", fontSize: "0.85rem", color: "#6b7280", borderBottom: "1px solid #e5e7eb" }}>退勤</th>
                            <th style={{ position: "sticky", top: 0, zIndex: 10, background: "#f9fafb", padding: "12px 16px", textAlign: "center", fontSize: "0.85rem", color: "#6b7280", borderBottom: "1px solid #e5e7eb" }}>申請時間</th>
                            <th style={{ position: "sticky", top: 0, zIndex: 10, background: "#f9fafb", padding: "12px 16px", textAlign: "center", fontSize: "0.85rem", color: "#6b7280", borderBottom: "1px solid #e5e7eb" }}>実働</th>
                            <th style={{ position: "sticky", top: 0, zIndex: 10, background: "#f9fafb", padding: "12px 16px", textAlign: "center", fontSize: "0.85rem", color: "#6b7280", borderBottom: "1px solid #e5e7eb" }}>ステータス</th>
                            <th style={{ position: "sticky", top: 0, zIndex: 10, background: "#f9fafb", padding: "12px 16px", textAlign: "center", fontSize: "0.85rem", color: "#6b7280", borderBottom: "1px solid #e5e7eb" }}>理由</th>
                        </tr>
                    </thead>
                    <tbody>
                        {(() => {
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
                            const attendanceMap = {};
                            items.forEach(i => attendanceMap[i.displayDate || i.workDate] = i);

                            return daysToRender.map(dateObj => {
                                const dateStr = format(dateObj, "yyyy-MM-dd");
                                const item = attendanceMap[dateStr] || { workDate: dateStr };
                                const hasAttendance = !!attendanceMap[dateStr];

                                const todayStr = format(new Date(), "yyyy-MM-dd");
                                const isFuture = dateStr > todayStr;

                                const workMin = calcWorkMin(item);
                                const rounded = calcRoundedWorkMin(item);
                                const isError = (item.clockIn && item.clockOut && workMin <= 0);
                                const incomplete = (item.clockIn && !item.clockOut);
                                const status = parseStatus(item);
                                const reason = extractReason(item);
                                const isApproved = status === "approved";
                                const isPending = status === "pending";
                                const isToday = dateStr === todayStr; // 本日かどうか

                                // 承認済み・承認待ちは編集不可（取り下げ or 再申請で編集可能）
                                // 本日は退勤済みの場合のみ編集可能
                                const todayClockedOut = isToday && item.clockIn && item.clockOut;
                                const isInteractive = adminMode ? (!isFuture || !!status) : (!isApproved && (!isToday || todayClockedOut) && (!isFuture || status));

                                // Shift Lookup（背景色判定のために先に行う）
                                let shift = null;
                                if (shiftMap && user) {
                                    const userShiftsMap = getUserShifts(shiftMap, user);
                                    if (userShiftsMap[dateStr]) {
                                        shift = userShiftsMap[dateStr];
                                    }
                                }

                                // シフトがあるのに出勤・退勤していない場合（過去の日付のみ）
                                const hasShift = shift && !shift.isOff;
                                const noAttendance = !item.clockIn && !item.clockOut;
                                const isPast = dateStr < todayStr;
                                const isShiftMissing = hasShift && noAttendance && isPast && status !== "approved" && status !== "pending" && status !== "absent";

                                // 行全体の背景色を決定
                                const isImplicitPending = hasAttendance && item.clockIn && item.clockOut && !status;
                                let bg = "#fff";
                                if (isApproved) {
                                    bg = "#f0fdf4"; // 緑（済）
                                } else if (isPending || isImplicitPending) {
                                    bg = "#fff7ed"; // オレンジ（承認待ち）
                                } else if (isError || incomplete || status === "absent" || isShiftMissing) {
                                    bg = "#fef2f2"; // 赤（異常/未退勤/欠勤/シフト未出勤）
                                }

                                // 申請時刻の取得
                                const appliedTime = extractAppliedTime(item);

                                // Work Time Display Logic
                                let workTimeDisplay = <span style={{ color: "#e5e7eb" }}>-</span>;
                                let workTimeColor = "#111827"; // デフォルトは黒


                                // 申請時間がある場合はそちらで計算（ステータスに関係なく）
                                const appliedTimeForCalc = extractAppliedTime(item);
                                if (appliedTimeForCalc && appliedTimeForCalc.appliedIn && appliedTimeForCalc.appliedOut) {
                                    const inMin = toMin(appliedTimeForCalc.appliedIn);
                                    const outMin = toMin(appliedTimeForCalc.appliedOut);
                                    const breakDur = appliedTimeForCalc.breakDuration || 0;
                                    const appliedDuration = outMin - inMin - breakDur;

                                    if (appliedDuration > 0) {
                                        let roundedDuration = Math.floor(appliedDuration / 30) * 30;
                                        const hours = Math.floor(roundedDuration / 60);
                                        const mins = roundedDuration % 60;
                                        workTimeDisplay = `${hours}:${String(mins).padStart(2, '0')}`;
                                        if (isApproved) workTimeColor = "#16a34a"; // 緑色（承認済み）
                                    }
                                } else if (rounded > 0) {
                                    let adjustedRounded = rounded;
                                    workTimeDisplay = `${Math.floor(adjustedRounded / 60)}:${String(adjustedRounded % 60).padStart(2, '0')}`;
                                } else if (item.clockIn && item.clockOut) {
                                    workTimeDisplay = "0:00";
                                }

                                // ステータス表示（承認済み・欠勤を最優先で判定）
                                let statusDisplay = <span style={{ color: "#d1d5db" }}>-</span>;
                                if (status === "approved") {
                                    statusDisplay = <span className="status-badge green">済</span>;
                                } else if (status === "absent") {
                                    statusDisplay = (
                                        <>
                                            <span className="status-badge red">欠勤</span>
                                            {onWithdraw && !adminMode && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        if (window.confirm("欠勤を取り下げますか？")) {
                                                            onWithdraw(item.workDate, item);
                                                        }
                                                    }}
                                                    style={{
                                                        marginLeft: "6px",
                                                        background: "#ef4444",
                                                        color: "#fff",
                                                        border: "none",
                                                        padding: "2px 8px",
                                                        borderRadius: "4px",
                                                        fontSize: "0.7rem",
                                                        cursor: "pointer"
                                                    }}
                                                >
                                                    取下げ
                                                </button>
                                            )}
                                        </>
                                    );
                                } else if (status === "resubmission_requested") {
                                    const adminComment = extractAdminComment(item);
                                    statusDisplay = (
                                        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                                            <span className="status-badge purple">再提出依頼</span>
                                            {adminComment && (
                                                <span style={{ fontSize: "10px", color: "#9333ea", maxWidth: "120px", wordBreak: "break-word" }}>
                                                    ⚠️ {adminComment}
                                                </span>
                                            )}
                                        </div>
                                    );
                                } else if (isToday && item.clockIn && !item.clockOut) {
                                    // 本日出勤中（退勤していない）
                                    statusDisplay = <span className="status-badge blue">出勤中</span>;
                                } else if (incomplete) {
                                    // 本日以外で未退勤
                                    statusDisplay = (
                                        <>
                                            <span className="status-badge orange">未退勤</span>
                                            {onWithdraw && isPending && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onWithdraw(item.workDate, item);
                                                    }}
                                                    style={{
                                                        marginLeft: "6px",
                                                        background: "#ef4444",
                                                        color: "#fff",
                                                        border: "none",
                                                        padding: "2px 8px",
                                                        borderRadius: "4px",
                                                        fontSize: "0.7rem",
                                                        cursor: "pointer"
                                                    }}
                                                >
                                                    取下げ
                                                </button>
                                            )}
                                        </>
                                    );
                                } else if (status === "pending") {
                                    // 承認待ち（本日含む）- 異常やシフト未出勤より優先
                                    statusDisplay = (
                                        <>
                                            <span className="status-badge orange">承認待</span>
                                            {onWithdraw && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onWithdraw(item.workDate, item);
                                                    }}
                                                    style={{
                                                        marginLeft: "6px",
                                                        background: "#ef4444",
                                                        color: "#fff",
                                                        border: "none",
                                                        padding: "2px 8px",
                                                        borderRadius: "4px",
                                                        fontSize: "0.7rem",
                                                        cursor: "pointer"
                                                    }}
                                                >
                                                    取下げ
                                                </button>
                                            )}
                                        </>
                                    );
                                } else if (isError) {
                                    statusDisplay = <span className="status-badge red">異常</span>;
                                } else if (isShiftMissing) {
                                    statusDisplay = <span className="status-badge red">シフト未出勤</span>;
                                } else if (hasAttendance && item.clockIn && !item.clockOut) {
                                    // 未退勤（出勤しているが退勤していない）- 既に上部で判定済み
                                } else if (hasAttendance && item.clockIn && item.clockOut) {
                                    // 出退勤済みだがステータスなし → 承認待ちとして表示（勤怠管理と統一）
                                    statusDisplay = <span className="status-badge orange">承認待</span>;
                                }

                                return (
                                    <tr
                                        key={dateStr}
                                        id={`row-${dateStr}`}
                                        className={`history-row ${!isInteractive ? "read-only-row" : ""}`}
                                        style={{
                                            background: bg,
                                            borderBottom: "1px solid #f3f4f6",
                                            cursor: (onRowClick && isInteractive) ? "pointer" : "default",
                                            transition: "background-color 0.2s",
                                            opacity: isFuture ? 0.6 : 1
                                        }}
                                        onClick={() => {
                                            if (onRowClick && isInteractive) {
                                                onRowClick(dateStr, item);
                                            }
                                        }}
                                        title={
                                            isApproved && !adminMode ? "承認済みのため修正できません" :
                                                isFuture ? "翌日以降の修正はできません" :
                                                    adminMode ? "クリックで勤怠管理画面を開く" :
                                                        "クリックで修正"
                                        }
                                    >
                                        <td style={{ padding: "12px 16px", borderRight: "1px solid #f3f4f6", fontWeight: "500", color: "#374151" }}>
                                            {format(dateObj, "MM/dd (E)", { locale: ja })}
                                        </td>
                                        <td style={{ padding: "12px 16px", textAlign: "center", fontSize: "0.9rem", color: shift ? "#2563eb" : "#9ca3af" }}>
                                            {shift ? (
                                                <>
                                                    {shift.isOff ? "休み" : `${shift.start}-${shift.end}`}
                                                    {/* 派遣シフトコード表示 */}
                                                    {!shift.isOff && shift.original && (() => {
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
                                            ) : "-"}
                                        </td>
                                        <td style={{ padding: "12px 16px", textAlign: "center", fontFamily: "monospace", fontSize: "1rem" }}>
                                            {item.clockIn ? (
                                                <div>
                                                    <span>{formatTimeHHMM(item.clockIn)}</span>
                                                    {/* 遅刻判定：申請時間はシフト開始より厳密に遅い場合のみ、打刻はちょうどでも遅刻 */}
                                                    {shift && shift.start && (() => {
                                                        const parsed = parseComment(item.comment);
                                                        const app = parsed?.application;
                                                        const effectiveIn = app?.appliedIn || item.clockIn;
                                                        if (!effectiveIn) return null;
                                                        const inMin = toMin(effectiveIn);
                                                        const startMin = toMin(shift.start);
                                                        const isLate = app?.appliedIn ? inMin > startMin : inMin >= startMin;
                                                        if (!isLate) return null;
                                                        const lateCancelled = parsed?.application?.lateCancelled;
                                                        if (lateCancelled) {
                                                            const reason = parsed?.application?.lateCancelReason;
                                                            return <span style={{ marginLeft: "4px", color: "#6b7280", fontSize: "0.7rem" }} title={reason || ""}>取消済{reason ? ` (${reason})` : ""}</span>;
                                                        }
                                                        return <span style={{ marginLeft: "4px", color: "#ef4444", fontSize: "0.75rem", fontWeight: "bold" }}>遅刻</span>;
                                                    })()}
                                                </div>
                                            ) : (
                                                <span style={{ color: "#d1d5db" }}>-</span>
                                            )}
                                        </td>
                                        <td style={{ padding: "12px 16px", textAlign: "center", fontFamily: "monospace", fontSize: "1rem" }}>
                                            {item.clockIn && !item.clockOut ? (
                                                // 本日は空欄、本日以外は「未退勤」
                                                isToday ? (
                                                    <span style={{ color: "#d1d5db" }}>-</span>
                                                ) : (
                                                    <span style={{ color: "#ef4444", fontWeight: "bold" }}>未退勤</span>
                                                )
                                            ) : item.clockOut ? (
                                                formatTimeHHMM(item.clockOut)
                                            ) : (
                                                <span style={{ color: "#d1d5db" }}>-</span>
                                            )}
                                        </td>
                                        <td style={{ padding: "12px 16px", textAlign: "center", fontFamily: "monospace", fontSize: "0.9rem", color: "#2563eb" }}>
                                            {appliedTime ? (
                                                <>
                                                    {appliedTime.appliedIn.slice(0, 5)}-{appliedTime.appliedOut.slice(0, 5)}
                                                    {appliedTime.breakDuration > 0 && (
                                                        <div style={{ fontSize: "0.7rem", color: "#9ca3af" }}>
                                                            休憩{appliedTime.breakDuration >= 60 ? `${Math.floor(appliedTime.breakDuration / 60)}h` : ''}{appliedTime.breakDuration % 60 > 0 ? `${appliedTime.breakDuration % 60}m` : ''}
                                                        </div>
                                                    )}
                                                </>
                                            ) : <span style={{ color: "#d1d5db" }}>-</span>}
                                        </td>
                                        <td style={{ padding: "12px 16px", textAlign: "center", fontWeight: "bold", color: workTimeColor }}>
                                            {workTimeDisplay}
                                        </td>
                                        <td style={{ padding: "12px 16px", textAlign: "center" }}>
                                            {statusDisplay}
                                        </td>
                                        <td style={{ padding: "12px 16px" }}>
                                            {(() => {
                                                if (!reason || reason === "欠勤") {
                                                    return <span style={{ color: "#d1d5db" }}>-</span>;
                                                }
                                                const reasonDetail = extractReasonDetail(item);
                                                const itemKey = `${dateStr}`;
                                                const isExpanded = expandedReasonId === itemKey;
                                                return (
                                                    <div
                                                        style={{ display: "flex", alignItems: "flex-start", gap: "8px", lineHeight: "1.3", cursor: reasonDetail ? "pointer" : "default" }}
                                                        onClick={(e) => {
                                                            if (reasonDetail) {
                                                                e.stopPropagation();
                                                                setExpandedReasonId(isExpanded ? null : itemKey);
                                                            }
                                                        }}
                                                    >
                                                        {(() => {
                                                            const parsed = parseComment(item.comment);
                                                            const app = parsed?.application;
                                                            const lc = app?.lateCancelled;
                                                            const ec = app?.earlyCancelled;
                                                            const isCancelled = (reason === "遅刻" && lc) || (reason === "早退" && ec) || (reason === "遅刻+早退" && lc && ec);
                                                            return isCancelled
                                                                ? <span style={{ textDecoration: "line-through", color: "#9ca3af" }}>{reason}（取消済）</span>
                                                                : <span className="status-badge gray" style={{ flexShrink: 0 }}>{reason}</span>;
                                                        })()}
                                                        {reasonDetail && reasonDetail.trim() && (
                                                            <span style={{
                                                                color: "#6b7280", fontSize: "11px",
                                                                ...(isExpanded
                                                                    ? { whiteSpace: "pre-wrap", wordBreak: "break-word", textAlign: "left" }
                                                                    : { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "140px" })
                                                            }}>
                                                                {reasonDetail}
                                                            </span>
                                                        )}
                                                    </div>
                                                );
                                            })()}
                                        </td>
                                    </tr>
                                );
                            });
                        })()}
                    </tbody>
                </table>
            </div>

            <style>{`
                .status-badge {
                  padding: 2px 8px;
                  border-radius: 99px;
                  font-size: 0.75rem;
                  font-weight: bold;
                  display: inline-block;
                }
                .status-badge.red { background: #fef2f2; color: #ef4444; border: 1px solid #fecaca; }
                .status-badge.orange { background: #fff7ed; color: #f97316; border: 1px solid #ffedd5; }
                .status-badge.purple { background: #faf5ff; color: #a855f7; border: 1px solid #e9d5ff; }
                .status-badge.green { background: #f0fdf4; color: #16a34a; border: 1px solid #bbf7d0; }
                .status-badge.gray { background: #f3f4f6; color: #4b5563; border: 1px solid #e5e7eb; }
                .status-badge.blue { background: #eff6ff; color: #2563eb; border: 1px solid #bfdbfe; }

                /* Hover Effect for non-approved rows */
                .history-row:not(.read-only-row):hover {
                    filter: brightness(0.96);
                }
            `}</style>
        </div>
    );
}
