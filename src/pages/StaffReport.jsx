import React, { useEffect, useState, useMemo } from "react";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";
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
    const navigate = useNavigate();
    const [user, setUser] = useState(null);
    const [items, setItems] = useState([]);
    const [shiftMap, setShiftMap] = useState({});
    const [currentDate, setCurrentDate] = useState(new Date());
    const [loading, setLoading] = useState(true);

    // ユーザー情報取得（AttendanceRecordと同じ方式）
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

    // シフトデータ取得（キャッシュ優先でバックグラウンド更新）
    useEffect(() => {
        // ① キャッシュから即座に読み込み
        try {
            const cached = localStorage.getItem("shift_data_cache");
            if (cached) {
                const parsed = JSON.parse(cached);
                if (Object.keys(parsed).length > 0) {
                    setShiftMap(parsed);
                }
            }
        } catch (e) { /* ignore */ }
        // ② バックグラウンドで最新を取得
        fetchShiftData().then(setShiftMap).catch(console.error);
    }, []);

    // 勤怠データ取得（代替userId含めて統合取得）
    useEffect(() => {
        if (!user) return;
        const fetchData = async () => {
            setLoading(true);
            try {
                // 同一loginIdの代替userIdを取得
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
                    } catch (e) { /* フォールバック: 現在のIDのみ */ }
                }

                // 全IDのデータを取得
                let allItems = [];
                for (const uid of [...new Set(allUserIds)]) {
                    try {
                        const res = await fetch(`${API_BASE}/attendance?userId=${uid}`);
                        const data = await res.json();
                        if (data.success && Array.isArray(data.items)) {
                            allItems.push(...data.items);
                        }
                    } catch (e) { /* skip */ }
                }

                const monthStr = format(currentDate, "yyyy-MM");
                // workDateで重複排除（updatedAtが新しいレコードを優先、withdrawn除外）
                const dateMap = new Map();
                allItems
                    .filter(item => (item.workDate || "").startsWith(monthStr))
                    .forEach(item => {
                        const existing = dateMap.get(item.workDate);
                        if (!existing) {
                            dateMap.set(item.workDate, item);
                        } else {
                            // withdrawnでないレコードを優先
                            const existApp = parseComment(existing.comment)?.application;
                            const newApp = parseComment(item.comment)?.application;
                            const existWithdrawn = existApp?.withdrawn || false;
                            const newWithdrawn = newApp?.withdrawn || false;
                            if (existWithdrawn && !newWithdrawn) {
                                dateMap.set(item.workDate, item);
                            } else if (!existWithdrawn && newWithdrawn) {
                                // keep existing
                            } else if ((item.updatedAt || "") > (existing.updatedAt || "")) {
                                dateMap.set(item.workDate, item);
                            }
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
        <div style={{ width: "100%", padding: "20px", boxSizing: "border-box" }}>
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
                            onRowClick={(dateStr) => {
                                navigate(`/attendance?editDate=${dateStr}`);
                            }}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
