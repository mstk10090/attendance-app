import React, { useEffect, useState, useMemo } from "react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval } from "date-fns";
import { ja } from "date-fns/locale";
import { User, CheckCircle, AlertTriangle, Calendar, Search } from "lucide-react";
import "../../App.css";

const API_BASE = "https://lfsu60xvw7.execute-api.ap-northeast-1.amazonaws.com";

// Utilities (Reused)
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

export default function AdminHistory() {
    const [baseDate, setBaseDate] = useState(format(new Date(), "yyyy-MM-dd"));
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(false);
    const [historyUser, setHistoryUser] = useState(null); // { userId, userName }
    const [searchQuery, setSearchQuery] = useState("");

    // Fetch Range (Always Monthly for History)
    const fetchRange = useMemo(() => {
        const d = new Date(baseDate);
        return {
            start: format(startOfMonth(d), "yyyy-MM-dd"),
            end: format(endOfMonth(d), "yyyy-MM-dd"),
        };
    }, [baseDate]);

    const fetchAttendances = async () => {
        setLoading(true);
        try {
            const start = new Date(fetchRange.start);
            const end = new Date(fetchRange.end);
            const days = eachDayOfInterval({ start, end });

            // Chunked fetching to avoid 503 Throttling
            const results = [];
            const chunkSize = 5; // Batch size
            for (let i = 0; i < days.length; i += chunkSize) {
                const chunk = days.slice(i, i + chunkSize);
                const promises = chunk.map(day =>
                    fetch(`${API_BASE}/admin/attendance?date=${format(day, "yyyy-MM-dd")}`)
                        .then(r => r.json())
                        .then(d => (d.success ? d.items : []))
                );
                const chunkResults = await Promise.all(promises);
                results.push(...chunkResults);

                // Small delay between chunks
                if (i + chunkSize < days.length) {
                    await new Promise(r => setTimeout(r, 500));
                }
            }
            const allItems = results.flat();

            // De-duplicate
            const uniqueItems = Array.from(new Map(allItems.map(item => [item.userId + item.workDate, item])).values());

            // Sort
            uniqueItems.sort((a, b) => {
                if (a.workDate !== b.workDate) return a.workDate.localeCompare(b.workDate);
                return a.userId.localeCompare(b.userId);
            });

            setItems(uniqueItems);
        } catch (e) {
            console.error(e);
            alert("データの取得に失敗しました");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchAttendances();
        // Reset selection when month changes? keeping it might be better UX, but simple for now
    }, [fetchRange]);

    // Unique Users for Selection
    const users = useMemo(() => {
        const map = new Map();
        items.forEach(i => {
            if (!map.has(i.userId)) {
                map.set(i.userId, { userId: i.userId, userName: i.userName });
            }
        });
        const allUsers = Array.from(map.values());
        if (!searchQuery) return allUsers;
        return allUsers.filter(u => u.userName.includes(searchQuery));
    }, [items, searchQuery]);

    return (
        <div className="admin-container" style={{ paddingBottom: "100px" }}>
            <div className="card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                    <h2 style={{ fontSize: "1.2rem", fontWeight: "bold", display: "flex", alignItems: "center", gap: "8px" }}>
                        <Calendar size={24} /> 個人勤怠履歴
                    </h2>
                </div>

                {/* Month Selector */}
                <div style={{ display: "flex", gap: "16px", marginBottom: "24px", alignItems: "center" }}>
                    <input
                        type="month"
                        className="input"
                        value={baseDate.slice(0, 7)}
                        onChange={e => setBaseDate(e.target.value + "-01")}
                        style={{ maxWidth: "200px" }}
                    />
                </div>

                {loading ? (
                    <div style={{ padding: "20px", textAlign: "center" }}>読み込み中...</div>
                ) : (
                    <div>
                        {!historyUser ? (
                            <div>
                                <h3 style={{ fontSize: "16px", marginBottom: "12px", borderBottom: "1px solid #eee", paddingBottom: "8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                        <Search size={16} /> 履歴を表示するスタッフを選択してください
                                    </div>
                                    <input
                                        type="text"
                                        className="input"
                                        placeholder="名前で検索..."
                                        value={searchQuery}
                                        onChange={e => setSearchQuery(e.target.value)}
                                        style={{ fontSize: "14px", padding: "4px 8px", width: "200px" }}
                                    />
                                </h3>
                                {users.length === 0 ? (
                                    <div style={{ color: "#aaa" }}>データがありません</div>
                                ) : (
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                                        {users.map(u => (
                                            <button
                                                key={u.userId}
                                                className="btn btn-gray"
                                                onClick={() => setHistoryUser(u)}
                                                style={{ padding: "10px 20px", fontSize: "15px" }}
                                            >
                                                <User size={16} style={{ marginRight: "4px" }} /> {u.userName}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", background: "#f3f4f6", padding: "12px", borderRadius: "8px" }}>
                                    <div style={{ fontWeight: "bold", fontSize: "1.1rem" }}>{historyUser.userName} さんの履歴 ({fetchRange.start.slice(0, 7)})</div>
                                    <button className="btn btn-gray" onClick={() => setHistoryUser(null)}>一覧に戻る</button>
                                </div>

                                {(() => {
                                    const hisItems = items.filter(i => i.userId === historyUser.userId);
                                    // Sort by date
                                    hisItems.sort((a, b) => a.workDate.localeCompare(b.workDate));

                                    const totalMin = hisItems.reduce((acc, i) => acc + (i.clockIn && i.clockOut ? calcRoundedWorkMin(i) : 0), 0);
                                    const missingOut = hisItems.filter(i => i.clockIn && !i.clockOut).length;

                                    return (
                                        <>
                                            <div style={{ marginBottom: "20px", display: "flex", gap: "20px", padding: "12px", border: "1px solid #ddd", borderRadius: "8px" }}>
                                                <div><span style={{ color: "#555" }}>出勤日数:</span> <span style={{ fontWeight: "bold", fontSize: "16px" }}>{hisItems.length}日</span></div>
                                                <div><span style={{ color: "#555" }}>総実働:</span> <span style={{ fontWeight: "bold", fontSize: "16px" }}>{Math.floor(totalMin / 60)}時間 {totalMin % 60}分</span></div>
                                                <div><span style={{ color: "#555" }}>退勤漏れ:</span> <span style={{ fontWeight: "bold", fontSize: "16px", color: missingOut > 0 ? "red" : "black" }}>{missingOut}件</span></div>
                                            </div>

                                            <table className="admin-table">
                                                <thead>
                                                    <tr>
                                                        <th style={{ padding: "10px" }}>日付</th>
                                                        <th style={{ padding: "10px" }}>出勤</th>
                                                        <th style={{ padding: "10px" }}>退勤</th>
                                                        <th style={{ padding: "10px" }}>実働</th>
                                                        <th style={{ padding: "10px" }}>状態</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {hisItems.map(item => {
                                                        const workMin = calcWorkMin(item);
                                                        const rounded = calcRoundedWorkMin(item);
                                                        const isError = (item.clockIn && item.clockOut && workMin <= 0);
                                                        const incomplete = (item.clockIn && !item.clockOut);

                                                        // Determine status style
                                                        let bg = "#fff";
                                                        if (isError || incomplete) bg = "#fef2f2";

                                                        return (
                                                            <tr key={item.workDate} style={{ background: bg }}>
                                                                <td style={{ padding: "10px" }}>{format(new Date(item.workDate), "MM/dd(E)", { locale: ja })}</td>
                                                                <td style={{ padding: "10px" }}>{item.clockIn || "-"}</td>
                                                                <td style={{ padding: "10px" }}>{item.clockOut || "-"}</td>
                                                                <td style={{ padding: "10px", fontWeight: "bold" }}>{rounded > 0 ? `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}` : "-"}</td>
                                                                <td style={{ padding: "10px" }}>
                                                                    {incomplete && <span className="status-badge red">未退勤</span>}
                                                                    {isError && <span className="status-badge red">異常</span>}
                                                                    {!incomplete && !isError && <CheckCircle size={16} color="#22c55e" />}
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </>
                                    );
                                })()}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
