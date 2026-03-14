import React, { useEffect, useState, useMemo } from "react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import HistoryReport from "../components/HistoryReport";
import { fetchShiftData, normalizeName } from "../utils/shiftParser";

const API_BASE = "https://lfsu60xvw7.execute-api.ap-northeast-1.amazonaws.com";

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
    const [user, setUser] = useState(null);
    const [items, setItems] = useState([]);
    const [shiftMap, setShiftMap] = useState({});
    const [currentDate, setCurrentDate] = useState(new Date());
    const [loading, setLoading] = useState(true);

    // ユーザー情報取得
    useEffect(() => {
        const stored = localStorage.getItem("user");
        if (stored) {
            try { setUser(JSON.parse(stored)); } catch { }
        }
    }, []);

    // シフトデータ取得
    useEffect(() => {
        fetchShiftData().then(setShiftMap).catch(console.error);
    }, []);

    // 勤怠データ取得
    useEffect(() => {
        if (!user) return;
        const fetchData = async () => {
            setLoading(true);
            const start = startOfMonth(currentDate);
            const end = endOfMonth(currentDate);
            const days = eachDayOfInterval({ start, end });

            const allItems = [];
            const CHUNK = 10;
            for (let i = 0; i < days.length; i += CHUNK) {
                const chunk = days.slice(i, i + CHUNK);
                const results = await Promise.all(
                    chunk.map(async (d) => {
                        const ds = format(d, "yyyy-MM-dd");
                        try {
                            const res = await fetch(`${API_BASE}/attendance?userId=${user.userId}&date=${ds}`);
                            if (!res.ok) return [];
                            const data = await res.json();
                            return (data.items || []).map(item => ({
                                ...item,
                                _application: parseComment(item.comment)?.application || null,
                            }));
                        } catch { return []; }
                    })
                );
                results.forEach(r => allItems.push(...r));
            }
            setItems(allItems);
            setLoading(false);
        };
        fetchData();
    }, [user, currentDate]);

    const handlePrevMonth = () => {
        setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
    };
    const handleNextMonth = () => {
        setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
    };

    if (!user) return <div style={{ padding: "40px", textAlign: "center" }}>ログインしてください</div>;

    return (
        <div style={{ maxWidth: "900px", margin: "0 auto", padding: "20px" }}>
            <div className="card" style={{ padding: "0", overflow: "hidden" }}>
                <div style={{ padding: "24px", borderBottom: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <h3 style={{ fontSize: "1.1rem", fontWeight: "bold", margin: 0 }}>勤務履歴・レポート</h3>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <button
                            onClick={handlePrevMonth}
                            style={{ background: "#fff", border: "1px solid #d1d5db", borderRadius: "6px", padding: "6px 12px", cursor: "pointer", display: "flex", alignItems: "center", transition: "all 0.2s" }}
                        >
                            <ChevronLeft size={16} /> <span style={{ fontSize: "0.85rem", marginLeft: "4px" }}>先月</span>
                        </button>
                        <span style={{ fontWeight: "bold", fontSize: "1rem", minWidth: "100px", textAlign: "center" }}>{format(currentDate, "yyyy年 M月")}</span>
                        <button
                            onClick={handleNextMonth}
                            style={{ background: "#fff", border: "1px solid #d1d5db", borderRadius: "6px", padding: "6px 12px", cursor: "pointer", display: "flex", alignItems: "center", transition: "all 0.2s" }}
                        >
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
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
