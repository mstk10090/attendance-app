import React, { useMemo, useEffect } from "react";
import { format, startOfYear, endOfYear, eachDayOfInterval, isSaturday, isSunday } from "date-fns";
import { ja } from "date-fns/locale";
import { Calendar, Clock, PieChart, CheckCircle } from "lucide-react";
import { HOLIDAYS } from "../constants";

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
        if (p && p.application && p.application.reason) return p.application.reason;
        if (p.text && p.text.includes("[管理者修正]:")) {
            return "管理者修正";
        }
        return null;
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
                appliedOut: p.application.appliedOut
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

export default function HistoryReport({ user, items, baseDate, viewMode, shiftMap, onRowClick, onWithdraw }) {


    // Render Stats (理由別内訳は削除)
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

        const attendedDates = new Set(items.filter(i => i.clockIn).map(i => i.displayDate || i.workDate));
        const totalMin = items.reduce((acc, i) => acc + (i.clockIn && i.clockOut ? calcRoundedWorkMin(i) : 0), 0);
        const missingOut = items.filter(i => i.clockIn && !i.clockOut).length;
        const days = attendedDates.size;

        return { totalMin, missingOut, days };
    }, [items, user, baseDate, viewMode]);

    if (!stats) return null;

    return (
        <div>
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
                                const isInteractive = !isApproved && !isPending && (!isToday || todayClockedOut) && (!isFuture || status);

                                // Shift Lookup（背景色判定のために先に行う）
                                let shift = null;
                                if (shiftMap && user) {
                                    const keysToTry = [
                                        user.userName,
                                        `${user.lastName || ""} ${user.firstName || ""}`.trim(),
                                        `${user.firstName || ""} ${user.lastName || ""}`.trim(),
                                        `${user.lastName || ""}　${user.firstName || ""}`.trim(),
                                        `${user.firstName || ""}　${user.lastName || ""}`.trim(),
                                        `${user.lastName || ""}${user.firstName || ""}`.trim()
                                    ];
                                    for (const k of keysToTry) {
                                        if (k && shiftMap[k] && shiftMap[k][dateStr]) {
                                            shift = shiftMap[k][dateStr];
                                            break;
                                        }
                                    }
                                }

                                // シフトがあるのに出勤・退勤していない場合（過去の日付のみ）
                                const hasShift = shift && !shift.isOff;
                                const noAttendance = !item.clockIn && !item.clockOut;
                                const isPast = dateStr < todayStr;
                                const isShiftMissing = hasShift && noAttendance && isPast && status !== "approved" && status !== "pending" && status !== "absent";

                                // 行全体の背景色を決定
                                let bg = "#fff";
                                if (isApproved) {
                                    bg = "#f0fdf4"; // 緑（済）
                                } else if (isPending) {
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
                                    const appliedDuration = outMin - inMin;

                                    if (appliedDuration > 0) {
                                        const roundedDuration = Math.floor(appliedDuration / 30) * 30;
                                        const hours = Math.floor(roundedDuration / 60);
                                        const mins = roundedDuration % 60;
                                        workTimeDisplay = `${hours}:${String(mins).padStart(2, '0')}`;
                                        if (isApproved) workTimeColor = "#16a34a"; // 緑色（承認済み）
                                    }
                                } else if (rounded > 0) {
                                    workTimeDisplay = `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
                                } else if (item.clockIn && item.clockOut) {
                                    workTimeDisplay = "0:00";
                                }

                                // ステータス表示（承認済み・欠勤を最優先で判定）
                                let statusDisplay = <span style={{ color: "#d1d5db" }}>-</span>;
                                if (status === "approved") {
                                    statusDisplay = <span className="status-badge green">済</span>;
                                } else if (status === "absent") {
                                    statusDisplay = <span className="status-badge red">欠勤</span>;
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
                                    statusDisplay = <span className="status-badge orange">未退勤</span>;
                                } else if (isError) {
                                    statusDisplay = <span className="status-badge red">異常</span>;
                                } else if (isShiftMissing) {
                                    statusDisplay = <span className="status-badge red">シフト未出勤</span>;
                                } else if (status === "pending" && !isToday) {
                                    // 本日以外で承認待ち
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
                                } else if (hasAttendance && item.clockIn && !item.clockOut) {
                                    // 未退勤（出勤しているが退勤していない）- 既に上部で判定済み
                                } else if (hasAttendance) {
                                    statusDisplay = <CheckCircle size={18} color="#22c55e" />;
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
                                            isApproved ? "承認済みのため修正できません" :
                                                isFuture ? "翌日以降の修正はできません" :
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
                                                    {/* 遅刻判定：シフト開始より遅く出勤した場合 */}
                                                    {shift && shift.start && toMin(item.clockIn) >= toMin(shift.start) && (() => {
                                                        const parsed = parseComment(item.comment);
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
                                            {appliedTime ? `${appliedTime.appliedIn.slice(0, 5)}-${appliedTime.appliedOut.slice(0, 5)}` : <span style={{ color: "#d1d5db" }}>-</span>}
                                        </td>
                                        <td style={{ padding: "12px 16px", textAlign: "center", fontWeight: "bold", color: workTimeColor }}>
                                            {workTimeDisplay}
                                        </td>
                                        <td style={{ padding: "12px 16px", textAlign: "center" }}>
                                            {statusDisplay}
                                        </td>
                                        <td style={{ padding: "12px 16px", textAlign: "center" }}>
                                            {reason && reason !== "欠勤" ? (
                                                <span className="status-badge gray">{reason}</span>
                                            ) : (
                                                <span style={{ color: "#d1d5db" }}>-</span>
                                            )}
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
