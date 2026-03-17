import React, { useEffect, useState, useMemo, useCallback } from "react";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, X, CheckCircle } from "lucide-react";
import HistoryReport from "../components/HistoryReport";
import { fetchShiftData, normalizeName } from "../utils/shiftParser";
import { REASON_OPTIONS, REASON_SUB_OPTIONS, LOCATIONS, DEPARTMENTS } from "../constants";

const API_BASE = "https://lfsu60xvw7.execute-api.ap-northeast-1.amazonaws.com";

const toMin = (t) => { if (!t) return 0; const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const roundTimeToHalfHour = (time, dir) => {
    if (!time) return "";
    const [h, m] = time.split(":").map(Number);
    const total = h * 60 + m;
    const rounded = dir === "ceil" ? Math.ceil(total / 30) * 30 : Math.floor(total / 30) * 30;
    return `${String(Math.floor(rounded / 60)).padStart(2, "0")}:${String(rounded % 60).padStart(2, "0")}`;
};

function parseComment(raw) {
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw);
        if (parsed.application) parsed.application._raw = raw;
        return parsed;
    } catch {
        return {};
    }
}

export default function StaffReport() {
    const navigate = useNavigate();
    const [user, setUser] = useState(null);
    const [items, setItems] = useState([]);
    const [shiftMap, setShiftMap] = useState({});
    const [currentDate, setCurrentDate] = useState(new Date());
    const [loading, setLoading] = useState(true);

    // モーダル用ステート
    const [editModal, setEditModal] = useState(null); // { dateStr, item }
    const [formIn, setFormIn] = useState("");
    const [formOut, setFormOut] = useState("");
    const [formBreakDuration, setFormBreakDuration] = useState(0);
    const [reason, setReason] = useState("-");
    const [subReason, setSubReason] = useState("");
    const [subReasonText, setSubReasonText] = useState("");
    const [formText, setFormText] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [formSegments, setFormSegments] = useState([]);

    // ユーザー情報取得
    useEffect(() => {
        const uid = localStorage.getItem("userId");
        if (!uid) return;
        setUser({
            userId: uid,
            userName: localStorage.getItem("userName"),
            defaultLocation: localStorage.getItem("defaultLocation") || "未記載",
            defaultDepartment: localStorage.getItem("defaultDepartment") || "未記載",
            employmentType: localStorage.getItem("employmentType") || ""
        });
    }, []);

    // シフトデータ取得
    useEffect(() => {
        try {
            const cached = localStorage.getItem("shift_data_cache");
            if (cached) {
                const parsed = JSON.parse(cached);
                if (Object.keys(parsed).length > 0) setShiftMap(parsed);
            }
        } catch (e) { /* ignore */ }
        fetchShiftData().then(setShiftMap).catch(console.error);
    }, []);

    // 勤怠データ取得
    const fetchData = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        try {
            const loginId = localStorage.getItem("loginId") || "";
            let allUserIds = [user.userId];
            if (loginId) {
                try {
                    const usersRes = await fetch(`${API_BASE}/users`);
                    const usersData = await usersRes.json();
                    const userList = usersData.items || usersData.Items || (Array.isArray(usersData) ? usersData : []);
                    userList.forEach(u => {
                        if ((u.loginId || "").toLowerCase() === loginId.toLowerCase() && u.userId !== user.userId) {
                            allUserIds.push(u.userId);
                        }
                    });
                } catch (e) { /* fallback */ }
            }
            let allItems = [];
            for (const uid of [...new Set(allUserIds)]) {
                try {
                    const res = await fetch(`${API_BASE}/attendance?userId=${uid}`);
                    const data = await res.json();
                    if (data.success && Array.isArray(data.items)) allItems.push(...data.items);
                } catch (e) { /* skip */ }
            }
            const monthStr = format(currentDate, "yyyy-MM");
            const dateMap = new Map();
            allItems.filter(item => (item.workDate || "").startsWith(monthStr)).forEach(item => {
                const existing = dateMap.get(item.workDate);
                if (!existing) {
                    dateMap.set(item.workDate, item);
                } else {
                    const existApp = parseComment(existing.comment)?.application;
                    const newApp = parseComment(item.comment)?.application;
                    const existWithdrawn = existApp?.withdrawn || false;
                    const newWithdrawn = newApp?.withdrawn || false;
                    if (existWithdrawn && !newWithdrawn) dateMap.set(item.workDate, item);
                    else if (!existWithdrawn && newWithdrawn) { /* keep */ }
                    else if ((item.updatedAt || "") > (existing.updatedAt || "")) dateMap.set(item.workDate, item);
                }
            });
            const filtered = Array.from(dateMap.values()).map(item => ({
                ...item,
                _application: parseComment(item.comment)?.application || null,
            }));
            setItems(filtered);
        } catch (e) {
            console.error("StaffReport fetch error:", e);
        }
        setLoading(false);
    }, [user, currentDate]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const handlePrevMonth = () => setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
    const handleNextMonth = () => setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));

    // シフト取得ヘルパー
    const getShift = (dateStr) => {
        if (!shiftMap || !user) return null;
        const ln = (user.userName || "").replace(/\s/g, "");
        const normalized = normalizeName(ln);
        const userShifts = shiftMap[normalized] || shiftMap[normalizeName(user.userName)] || {};
        return userShifts[dateStr] || null;
    };

    // 行クリック → モーダルオープン
    const handleRowClick = (dateStr, item) => {
        const shift = getShift(dateStr);
        const p = parseComment(item?.comment);
        const app = p.application || {};

        const clockInRounded = roundTimeToHalfHour(item?.clockIn, "ceil");
        const clockOutRounded = roundTimeToHalfHour(item?.clockOut, "floor");
        setFormIn(clockInRounded || app.appliedIn || shift?.start || "09:00");
        setFormOut(clockOutRounded || app.appliedOut || shift?.end || "18:00");
        setFormBreakDuration(app.breakDuration || 0);
        setFormText(p.text || "");
        if (app.reason && REASON_OPTIONS.includes(app.reason)) {
            setReason(app.reason);
            setSubReason(app.subReason || "");
            setSubReasonText(app.subReasonText || "");
        } else {
            setReason(REASON_OPTIONS[0]);
            setSubReason("");
            setSubReasonText("");
        }
        setFormSegments(p.segments?.length > 0 ? p.segments : [{
            location: user.defaultLocation || LOCATIONS[0],
            department: user.defaultDepartment || DEPARTMENTS[0],
            hours: ""
        }]);
        setEditModal({ dateStr, item: item || { workDate: dateStr } });
    };

    // 申請送信
    const handleSubmit = async () => {
        if (!editModal) return;
        if (!reason || reason === "-") { alert("修正・申請理由を選択してください"); return; }
        const subOpts = REASON_SUB_OPTIONS[reason] || [];
        if (subOpts.length > 0 && !subReason) { alert(`${reason}の詳細理由を選択してください`); return; }
        if (subReason === "その他" && !subReasonText.trim()) { alert("詳細理由を入力してください"); return; }
        if (!formIn || !formOut) { alert("出勤・退勤時間を入力してください"); return; }

        setSubmitting(true);
        try {
            const originalItem = editModal.item;
            const p = parseComment(originalItem?.comment);
            const existingLog = p.auditLog || [];
            existingLog.push({ action: "staff_edit", by: user.userName, at: new Date().toISOString(), detail: `修正申請（${reason}）` });

            const newComment = JSON.stringify({
                segments: formSegments,
                text: formText,
                application: {
                    status: "pending",
                    reason: reason,
                    subReason: subReason || undefined,
                    subReasonText: subReasonText || undefined,
                    appliedIn: formIn,
                    appliedOut: formOut,
                    breakDuration: formBreakDuration,
                },
                auditLog: existingLog
            });

            const payload = {
                userId: user.userId,
                workDate: originalItem.workDate || editModal.dateStr,
                clockIn: originalItem.clockIn || formIn,
                clockOut: originalItem.clockOut || formOut,
                breaks: originalItem.breaks || [],
                comment: newComment
            };

            const res = await fetch(`${API_BASE}/attendance/update`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            if (!res.ok) { alert(`保存に失敗しました: ${res.status}`); return; }
            alert("申請を保存しました");
            setEditModal(null);
            fetchData();
        } catch (e) {
            console.error(e);
            alert("エラーが発生しました");
        } finally {
            setSubmitting(false);
        }
    };

    if (!user) return <div style={{ padding: "40px", textAlign: "center" }}>ログインしてください</div>;

    const subOptions = REASON_SUB_OPTIONS[reason] || [];
    const shift = editModal ? getShift(editModal.dateStr) : null;

    // 時間オプション生成
    const timeOptions = Array.from({ length: 48 }, (_, i) => {
        const h = String(Math.floor(i / 2)).padStart(2, "0");
        const m = i % 2 === 0 ? "00" : "30";
        return `${h}:${m}`;
    });

    return (
        <div style={{ width: "100%", padding: "20px", boxSizing: "border-box" }}>
            <div className="card" style={{ padding: "0", overflow: "hidden" }}>
                <div style={{ padding: "24px", borderBottom: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <h3 style={{ fontSize: "1.1rem", fontWeight: "bold", margin: 0 }}>勤務履歴・レポート</h3>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <button onClick={handlePrevMonth} style={{ background: "#fff", border: "1px solid #d1d5db", borderRadius: "6px", padding: "6px 12px", cursor: "pointer", display: "flex", alignItems: "center" }}>
                            <ChevronLeft size={16} /> <span style={{ fontSize: "0.85rem", marginLeft: "4px" }}>先月</span>
                        </button>
                        <span style={{ fontWeight: "bold", fontSize: "1rem", minWidth: "100px", textAlign: "center" }}>{format(currentDate, "yyyy年 M月")}</span>
                        <button onClick={handleNextMonth} style={{ background: "#fff", border: "1px solid #d1d5db", borderRadius: "6px", padding: "6px 12px", cursor: "pointer", display: "flex", alignItems: "center" }}>
                            <span style={{ fontSize: "0.85rem", marginRight: "4px" }}>翌月</span> <ChevronRight size={16} />
                        </button>
                    </div>
                </div>
                <div style={{ padding: "24px" }}>
                    {loading ? (
                        <div style={{ textAlign: "center", padding: "40px", color: "#6b7280" }}>読み込み中...</div>
                    ) : (
                        <HistoryReport
                            user={user}
                            items={items}
                            baseDate={format(currentDate, "yyyy-MM-dd")}
                            viewMode="month"
                            shiftMap={shiftMap}
                            onRowClick={handleRowClick}
                        />
                    )}
                </div>
            </div>

            {/* === 修正申請モーダル === */}
            {editModal && (
                <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: "20px" }}
                    onClick={() => setEditModal(null)}>
                    <div style={{ background: "#fff", borderRadius: "16px", maxWidth: "480px", width: "100%", maxHeight: "85vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}
                        onClick={(e) => e.stopPropagation()}>
                        {/* ヘッダー */}
                        <div style={{ padding: "20px 24px", borderBottom: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div>
                                <div style={{ fontWeight: "bold", fontSize: "1.1rem" }}>修正申請</div>
                                <div style={{ fontSize: "0.85rem", color: "#6b7280" }}>
                                    {format(new Date(editModal.dateStr), "yyyy年MM月dd日 (E)", { locale: ja })}
                                    {shift && !shift.isOff && <span style={{ marginLeft: "8px", color: "#2563eb" }}>シフト {shift.start}〜{shift.end}</span>}
                                </div>
                            </div>
                            <button onClick={() => setEditModal(null)} style={{ background: "none", border: "none", cursor: "pointer", padding: "4px" }}>
                                <X size={24} color="#9ca3af" />
                            </button>
                        </div>

                        <div style={{ padding: "20px 24px" }}>
                            {/* 打刻情報 */}
                            {editModal.item?.clockIn && (
                                <div style={{ background: "#f9fafb", borderRadius: "8px", padding: "12px", marginBottom: "16px", fontSize: "0.85rem", color: "#6b7280" }}>
                                    実際の打刻: {editModal.item.clockIn}{editModal.item.clockOut ? ` 〜 ${editModal.item.clockOut}` : " 〜 (未退勤)"}
                                </div>
                            )}

                            {/* 申請時間 */}
                            <div style={{ marginBottom: "16px" }}>
                                <label style={{ fontWeight: "bold", fontSize: "0.85rem", marginBottom: "6px", display: "block" }}>申請時間</label>
                                <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: "8px", alignItems: "center" }}>
                                    <select value={formIn} onChange={e => setFormIn(e.target.value)}
                                        style={{ padding: "10px", borderRadius: "8px", border: "1px solid #d1d5db", fontSize: "0.95rem" }}>
                                        {timeOptions.map(t => <option key={t} value={t}>{t}</option>)}
                                    </select>
                                    <span style={{ color: "#9ca3af" }}>〜</span>
                                    <select value={formOut} onChange={e => setFormOut(e.target.value)}
                                        style={{ padding: "10px", borderRadius: "8px", border: "1px solid #d1d5db", fontSize: "0.95rem" }}>
                                        {timeOptions.map(t => <option key={t} value={t}>{t}</option>)}
                                    </select>
                                </div>
                            </div>

                            {/* 休憩時間 */}
                            <div style={{ marginBottom: "16px" }}>
                                <label style={{ fontWeight: "bold", fontSize: "0.85rem", marginBottom: "6px", display: "block" }}>休憩時間</label>
                                <select value={formBreakDuration} onChange={e => setFormBreakDuration(Number(e.target.value))}
                                    style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid #d1d5db", fontSize: "0.95rem" }}>
                                    <option value={0}>なし</option>
                                    <option value={15}>15分</option>
                                    <option value={30}>30分</option>
                                    <option value={45}>45分</option>
                                    <option value={60}>1時間</option>
                                    <option value={90}>1時間30分</option>
                                </select>
                            </div>

                            {/* 修正理由 */}
                            <div style={{ marginBottom: "16px" }}>
                                <label style={{ fontWeight: "bold", fontSize: "0.85rem", marginBottom: "6px", display: "block" }}>修正・申請理由</label>
                                <select value={reason} onChange={e => { setReason(e.target.value); setSubReason(""); setSubReasonText(""); }}
                                    style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid #d1d5db", fontSize: "0.95rem" }}>
                                    {REASON_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                                </select>
                            </div>

                            {/* サブ理由 */}
                            {subOptions.length > 0 && (
                                <div style={{ marginBottom: "16px" }}>
                                    <label style={{ fontWeight: "bold", fontSize: "0.85rem", marginBottom: "6px", display: "block" }}>{reason}の詳細</label>
                                    <select value={subReason} onChange={e => setSubReason(e.target.value)}
                                        style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid #d1d5db", fontSize: "0.95rem" }}>
                                        <option value="">選択してください</option>
                                        {subOptions.map(o => <option key={o} value={o}>{o}</option>)}
                                    </select>
                                    {subReason === "その他" && (
                                        <textarea value={subReasonText} onChange={e => setSubReasonText(e.target.value)}
                                            placeholder="詳細を入力してください"
                                            style={{ width: "100%", marginTop: "8px", padding: "10px", borderRadius: "8px", border: "1px solid #d1d5db", fontSize: "0.85rem", minHeight: "60px", resize: "vertical" }} />
                                    )}
                                </div>
                            )}

                            {/* 備考 */}
                            <div style={{ marginBottom: "20px" }}>
                                <label style={{ fontWeight: "bold", fontSize: "0.85rem", marginBottom: "6px", display: "block" }}>備考（任意）</label>
                                <textarea value={formText} onChange={e => setFormText(e.target.value)}
                                    placeholder="補足事項があれば記入"
                                    style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid #d1d5db", fontSize: "0.85rem", minHeight: "50px", resize: "vertical" }} />
                            </div>

                            {/* 送信ボタン */}
                            <div style={{ display: "flex", gap: "10px" }}>
                                <button onClick={() => setEditModal(null)}
                                    style={{ flex: 1, padding: "12px", borderRadius: "8px", border: "1px solid #d1d5db", background: "#fff", cursor: "pointer", fontWeight: "bold", fontSize: "0.95rem" }}>
                                    キャンセル
                                </button>
                                <button onClick={handleSubmit} disabled={submitting}
                                    style={{
                                        flex: 2, padding: "12px", borderRadius: "8px", border: "none",
                                        background: submitting ? "#93c5fd" : reason === "欠勤" ? "#ef4444" : "#2563eb",
                                        color: "#fff", fontWeight: "bold", cursor: submitting ? "default" : "pointer",
                                        fontSize: "0.95rem", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
                                        boxShadow: "0 4px 6px rgba(37, 99, 235, 0.2)"
                                    }}>
                                    {submitting ? "送信中..." : <><CheckCircle size={18} /> {reason === "欠勤" ? "欠勤申請" : "申請を保存"}</>}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
