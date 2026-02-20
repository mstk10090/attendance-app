import React, { useEffect, useState, useMemo } from "react";
import { format, addDays } from "date-fns";
import { ja } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Calendar, MapPin, Briefcase } from "lucide-react";
import "../App.css";
import { LOCATIONS, DEPARTMENTS } from "../constants";
import { fetchShiftData, normalizeName } from "../utils/shiftParser";

const API_USER_URL = "https://lfsu60xvw7.execute-api.ap-northeast-1.amazonaws.com/users";

// --- Utilities ---
// ユーザーのシフトデータを検索（normalizeName正規化対応）
const getUserShifts = (shiftMap, user) => {
    const key = normalizeName((user.lastName || "") + (user.firstName || ""));
    return shiftMap[key] || {};
};

const toMin = (t) => {
    if (!t) return 0;
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
};

export default function ShiftGantt() {
    const [baseDate, setBaseDate] = useState(format(new Date(), "yyyy-MM-dd"));
    const [shiftMap, setShiftMap] = useState({});
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(false);

    // フィルタ
    const [filterLocation, setFilterLocation] = useState("all");
    const [filterDepartment, setFilterDepartment] = useState("all");

    // シフトデータ取得（dispatchRange/partTimeRangeを含む最新データを取得）
    useEffect(() => {
        fetchShiftData(true).then(data => {
            console.log("Shift data loaded:", data);
            setShiftMap(data);
        });
    }, []);

    // ユーザーデータ取得
    useEffect(() => {
        const fetchUsers = async () => {
            setLoading(true);
            try {
                const token = localStorage.getItem("token");
                const headers = {};
                if (token) headers["Authorization"] = token;

                const res = await fetch(API_USER_URL, { headers });

                if (res.ok) {
                    const text = await res.text();
                    const outer = JSON.parse(text);
                    const data = (outer.body && typeof outer.body === "string") ? JSON.parse(outer.body) : outer;
                    const list = Array.isArray(data) ? data : (data.items || []);

                    // loginIdベースで重複排除
                    const deduped = new Map();
                    list.forEach(u => {
                        const key = u.loginId || u.userId;
                        const existing = deduped.get(key);
                        if (!existing || (!existing.defaultLocation && u.defaultLocation)) {
                            deduped.set(key, u);
                        }
                    });
                    // フルネームベースでも重複排除
                    const nameDeduped = new Map();
                    Array.from(deduped.values()).forEach(u => {
                        const fullName = ((u.lastName || "") + (u.firstName || "")).replace(/\s/g, "");
                        if (!fullName) { nameDeduped.set(u.userId, u); return; }
                        const existing = nameDeduped.get(fullName);
                        if (!existing || (!existing.defaultLocation && u.defaultLocation)) {
                            nameDeduped.set(fullName, u);
                        }
                    });
                    setUsers(Array.from(nameDeduped.values()));
                }
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        };
        fetchUsers();
    }, []);

    // 日付ナビゲーション
    const goToPreviousDay = () => {
        const d = new Date(baseDate);
        setBaseDate(format(addDays(d, -1), "yyyy-MM-dd"));
    };

    const goToNextDay = () => {
        const d = new Date(baseDate);
        setBaseDate(format(addDays(d, 1), "yyyy-MM-dd"));
    };

    const goToToday = () => {
        setBaseDate(format(new Date(), "yyyy-MM-dd"));
    };

    // フィルタリングされたユーザー（重複排除・ソート済み）
    const filteredUsers = useMemo(() => {
        const DEPT_ORDER = ["即日", "買取", "広告", "CEO", "アビエス", "未記載"];

        const filtered = users.filter(u => {
            const userShifts = getUserShifts(shiftMap, u);
            const shift = userShifts ? userShifts[baseDate] : null;

            if (!shift || !shift.start || !shift.end) return false;

            const rawLocation = (shift && !shift.isOff && shift.location)
                ? shift.location
                : (u.defaultLocation || "未記載");
            const department = u.defaultDepartment || "未記載";

            if (filterLocation !== "all" && !rawLocation.includes(filterLocation)) return false;
            if (filterDepartment !== "all" && department !== filterDepartment) return false;

            return true;
        });

        // フルネームベースで重複排除（表示レベル）
        const seen = new Set();
        const deduped = filtered.filter(u => {
            const fullName = ((u.lastName || "") + (u.firstName || "")).replace(/\s/g, "");
            const key = fullName || u.userId;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        // ソート: 部署順 → シフト開始時刻順
        deduped.sort((a, b) => {
            const deptA = a.defaultDepartment || "未記載";
            const deptB = b.defaultDepartment || "未記載";
            const deptIdxA = DEPT_ORDER.indexOf(deptA) === -1 ? DEPT_ORDER.length : DEPT_ORDER.indexOf(deptA);
            const deptIdxB = DEPT_ORDER.indexOf(deptB) === -1 ? DEPT_ORDER.length : DEPT_ORDER.indexOf(deptB);
            if (deptIdxA !== deptIdxB) return deptIdxA - deptIdxB;

            const shiftsA = getUserShifts(shiftMap, a);
            const shiftsB = getUserShifts(shiftMap, b);
            const shiftA = shiftsA ? shiftsA[baseDate] : null;
            const shiftB = shiftsB ? shiftsB[baseDate] : null;
            const startA = shiftA && shiftA.start ? toMin(shiftA.start) : 9999;
            const startB = shiftB && shiftB.start ? toMin(shiftB.start) : 9999;
            return startA - startB;
        });

        return deduped;
    }, [users, filterLocation, filterDepartment, shiftMap, baseDate]);

    // シフトある人数のカウント（重複排除済み）
    const totalShiftCount = useMemo(() => {
        const seen = new Set();
        return users.filter(u => {
            const fullName = ((u.lastName || "") + (u.firstName || "")).replace(/\s/g, "");
            const key = fullName || u.userId;
            if (seen.has(key)) return false;
            seen.add(key);
            const userShifts = getUserShifts(shiftMap, u);
            const shift = userShifts ? userShifts[baseDate] : null;
            return shift && shift.start && shift.end;
        }).length;
    }, [users, shiftMap, baseDate]);

    return (
        <div className="admin-container" style={{ padding: "20px", maxWidth: "1400px", margin: "0 auto" }}>
            {/* ヘッダー */}
            <div style={{ marginBottom: "24px" }}>
                <h2 style={{
                    fontSize: "1.5rem",
                    fontWeight: "bold",
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    color: "#1f2937",
                    marginBottom: "8px"
                }}>
                    <div style={{
                        background: "#e0f2fe",
                        padding: "10px",
                        borderRadius: "12px",
                        color: "#0284c7"
                    }}>
                        <Calendar size={28} />
                    </div>
                    シフト確認
                </h2>
                <p style={{ color: "#6b7280", fontSize: "0.9rem" }}>
                    本日のシフトをガントチャート形式で確認できます
                </p>
            </div>

            {/* 日付ナビゲーション + フィルタ */}
            <div className="card" style={{ padding: "16px", marginBottom: "20px" }}>
                <div style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: "12px"
                }}>
                    {/* 日付コントロール */}
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <button
                            onClick={goToPreviousDay}
                            style={{
                                padding: "8px",
                                borderRadius: "8px",
                                border: "1px solid #d1d5db",
                                background: "#fff",
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center"
                            }}
                        >
                            <ChevronLeft size={20} />
                        </button>

                        <div style={{
                            fontSize: "1.1rem",
                            fontWeight: "bold",
                            color: "#1f2937",
                            minWidth: "180px",
                            textAlign: "center"
                        }}>
                            {format(new Date(baseDate), "yyyy年M月d日 (E)", { locale: ja })}
                        </div>

                        <button
                            onClick={goToNextDay}
                            style={{
                                padding: "8px",
                                borderRadius: "8px",
                                border: "1px solid #d1d5db",
                                background: "#fff",
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center"
                            }}
                        >
                            <ChevronRight size={20} />
                        </button>

                        <button
                            onClick={goToToday}
                            style={{
                                padding: "6px 14px",
                                borderRadius: "6px",
                                border: "1px solid #2563eb",
                                background: "#eff6ff",
                                color: "#2563eb",
                                cursor: "pointer",
                                fontSize: "0.85rem",
                                fontWeight: "500"
                            }}
                        >
                            今日
                        </button>
                    </div>

                    {/* フィルタ */}
                    <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
                        {/* 勤務地フィルタ */}
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <MapPin size={16} color="#6b7280" />
                            <label style={{ fontSize: "13px", color: "#6b7280" }}>勤務地:</label>
                            <select
                                value={filterLocation}
                                onChange={(e) => setFilterLocation(e.target.value)}
                                style={{
                                    padding: "6px 12px",
                                    borderRadius: "6px",
                                    border: "1px solid #d1d5db",
                                    fontSize: "13px",
                                    background: "#fff"
                                }}
                            >
                                <option value="all">すべて</option>
                                {LOCATIONS.map(loc => <option key={loc} value={loc}>{loc}</option>)}
                            </select>
                        </div>

                        {/* 勤務部署フィルタ */}
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <Briefcase size={16} color="#6b7280" />
                            <label style={{ fontSize: "13px", color: "#6b7280" }}>部署:</label>
                            <select
                                value={filterDepartment}
                                onChange={(e) => setFilterDepartment(e.target.value)}
                                style={{
                                    padding: "6px 12px",
                                    borderRadius: "6px",
                                    border: "1px solid #d1d5db",
                                    fontSize: "13px",
                                    background: "#fff"
                                }}
                            >
                                <option value="all">すべて</option>
                                {DEPARTMENTS.map(dept => <option key={dept} value={dept}>{dept}</option>)}
                            </select>
                        </div>
                    </div>
                </div>

                {/* フィルタ結果の件数表示 */}
                <div style={{
                    marginTop: "12px",
                    paddingTop: "12px",
                    borderTop: "1px solid #f3f4f6",
                    display: "flex",
                    gap: "16px",
                    fontSize: "0.85rem",
                    color: "#6b7280"
                }}>
                    <span>
                        表示: <strong style={{ color: "#1f2937" }}>{filteredUsers.length}</strong>名
                    </span>
                    <span>
                        (全 {totalShiftCount}名がシフトあり)
                    </span>
                </div>
            </div>

            {/* ガントチャート */}
            <div className="card" style={{ padding: "24px" }}>
                {loading ? (
                    <div style={{ textAlign: "center", padding: "40px", color: "#6b7280" }}>
                        読み込み中...
                    </div>
                ) : filteredUsers.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "40px", color: "#9ca3af" }}>
                        {totalShiftCount === 0
                            ? "この日はシフトが登録されていません"
                            : "条件に一致するシフトがありません"}
                    </div>
                ) : (
                    <div style={{ overflowX: "auto", maxHeight: "70vh", overflowY: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                            <thead>
                                <tr style={{ background: "#f3f4f6" }}>
                                    <th style={{
                                        padding: "8px",
                                        textAlign: "left",
                                        minWidth: "100px",
                                        borderRight: "1px solid #e5e7eb",
                                        position: "sticky",
                                        left: 0,
                                        background: "#f3f4f6",
                                        zIndex: 10,
                                        fontWeight: "600",
                                        color: "#4b5563"
                                    }}>
                                        氏名
                                    </th>
                                    <th style={{
                                        padding: "8px",
                                        textAlign: "center",
                                        minWidth: "60px",
                                        borderRight: "1px solid #e5e7eb",
                                        fontWeight: "600",
                                        color: "#4b5563"
                                    }}>
                                        シフト
                                    </th>
                                    {/* 7時〜24時の時間ヘッダー */}
                                    {Array.from({ length: 18 }, (_, i) => i + 7).map(hour => (
                                        <th
                                            key={hour}
                                            style={{
                                                padding: "4px",
                                                textAlign: "center",
                                                minWidth: "30px",
                                                borderRight: "1px solid #e5e7eb",
                                                fontSize: "10px",
                                                fontWeight: "500",
                                                color: "#6b7280"
                                            }}
                                        >
                                            {hour}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {filteredUsers.map(u => {
                                    const userName = `${u.lastName || ""} ${u.firstName || ""}`.trim();
                                    const userShifts = getUserShifts(shiftMap, u);
                                    const shift = userShifts ? userShifts[baseDate] : null;

                                    // シフト時間をバーに変換
                                    let shiftStart = null;
                                    let shiftEnd = null;
                                    if (shift && shift.start && shift.end) {
                                        shiftStart = toMin(shift.start);
                                        shiftEnd = toMin(shift.end);
                                    }

                                    // 勤務地・部署表示
                                    const location = (shift && shift.location) || u.defaultLocation || "";
                                    const department = u.defaultDepartment || "";

                                    const loggedInUserName = localStorage.getItem("userName") || "";
                                    const isCurrentUser = userName === loggedInUserName ||
                                        userName.replace(/\s/g, "") === loggedInUserName.replace(/\s/g, "");

                                    return (
                                        <tr key={u.userId} style={{
                                            borderBottom: "1px solid #f3f4f6",
                                            background: isCurrentUser ? "#fefce8" : "transparent"
                                        }}>
                                            <td style={{
                                                padding: "8px",
                                                fontWeight: isCurrentUser ? "700" : "500",
                                                borderRight: "1px solid #e5e7eb",
                                                position: "sticky",
                                                left: 0,
                                                background: isCurrentUser ? "#fefce8" : "#fff",
                                                zIndex: 5
                                            }}>
                                                <div style={{ fontSize: "13px", color: isCurrentUser ? "#92400e" : "#1f2937" }}>
                                                    {userName}
                                                    {isCurrentUser && <span style={{ marginLeft: "4px", fontSize: "10px", color: "#d97706" }}>★</span>}
                                                </div>

                                            </td>
                                            <td style={{
                                                padding: "4px 6px",
                                                textAlign: "center",
                                                fontSize: "10px",
                                                borderRight: "1px solid #e5e7eb",
                                                fontWeight: shift ? "500" : "normal"
                                            }}>
                                                {shift ? (
                                                    (shift.dispatchRange || shift.partTimeRange) ? (
                                                        <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
                                                            {shift.dispatchRange && (
                                                                <div style={{ color: "#1d4ed8" }}>
                                                                    <span style={{ fontSize: "8px", fontWeight: "bold", background: "#dbeafe", padding: "0 3px", borderRadius: "2px", marginRight: "2px" }}>派</span>
                                                                    {shift.dispatchRange.start}-{shift.dispatchRange.end}
                                                                </div>
                                                            )}
                                                            {shift.partTimeRange && (
                                                                <div style={{ color: "#15803d" }}>
                                                                    <span style={{ fontSize: "8px", fontWeight: "bold", background: "#dcfce7", padding: "0 3px", borderRadius: "2px", marginRight: "2px" }}>バ</span>
                                                                    {shift.partTimeRange.start}-{shift.partTimeRange.end}
                                                                </div>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <span style={{ color: "#2563eb" }}>{shift.start}-{shift.end}</span>
                                                    )
                                                ) : "-"}
                                            </td>
                                            {/* 7時〜24時の各時間セル */}
                                            {Array.from({ length: 18 }, (_, i) => i + 7).map(hour => {
                                                const cellStart = hour * 60;
                                                const cellEnd = (hour + 1) * 60;

                                                // シフトがこの時間帯にあるかチェック
                                                let hasShift = false;
                                                let isDispatchHour = false;
                                                let isPartTimeHour = false;

                                                if (shiftStart !== null && shiftEnd !== null) {
                                                    hasShift = shiftStart < cellEnd && shiftEnd > cellStart;

                                                    // 派遣区間とバイト区間をチェック
                                                    if (hasShift && shift) {
                                                        if (shift.dispatchRange) {
                                                            const dispStart = toMin(shift.dispatchRange.start);
                                                            const dispEnd = toMin(shift.dispatchRange.end);
                                                            isDispatchHour = dispStart < cellEnd && dispEnd > cellStart;
                                                        }
                                                        if (shift.partTimeRange) {
                                                            const partStart = toMin(shift.partTimeRange.start);
                                                            const partEnd = toMin(shift.partTimeRange.end);
                                                            isPartTimeHour = partStart < cellEnd && partEnd > cellStart;
                                                        }
                                                        // dispatchRange/partTimeRangeがない場合のフォールバック
                                                        if (!shift.dispatchRange && !shift.partTimeRange && shift.isDispatch) {
                                                            isDispatchHour = true;
                                                        } else if (!shift.dispatchRange && !shift.partTimeRange && !shift.isDispatch) {
                                                            isPartTimeHour = true;
                                                        }
                                                    }
                                                }

                                                // 色を決定: 派遣=青、バイト=緑
                                                let bgColor = "#fff";
                                                if (isDispatchHour && isPartTimeHour) {
                                                    // 両方の区間にまたがる場合は、より正確に判定
                                                    const cellMid = (cellStart + cellEnd) / 2;
                                                    const dispEnd = shift.dispatchRange ? toMin(shift.dispatchRange.end) : cellEnd;
                                                    bgColor = cellMid < dispEnd ? "#3b82f6" : "#22c55e";
                                                } else if (isDispatchHour) {
                                                    bgColor = "#3b82f6";  // 派遣: 青
                                                } else if (isPartTimeHour) {
                                                    bgColor = "#22c55e";  // バイト: 緑
                                                } else if (hasShift) {
                                                    // フォールバック: dispatchRange/partTimeRangeがない場合
                                                    // isDispatchフラグで判定、なければシフトの種類で判定
                                                    if (shift.isDispatch) {
                                                        bgColor = "#3b82f6";  // 派遣: 青
                                                    } else {
                                                        bgColor = "#22c55e";  // バイト: 緑
                                                    }
                                                }

                                                return (
                                                    <td
                                                        key={hour}
                                                        style={{
                                                            padding: "4px",
                                                            borderRight: "1px solid #e5e7eb",
                                                            background: bgColor,
                                                            minHeight: "24px"
                                                        }}
                                                    />
                                                );
                                            })}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* 凡例 */}
            <div style={{
                marginTop: "16px",
                display: "flex",
                gap: "20px",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "0.85rem",
                color: "#6b7280"
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <div style={{
                        width: "24px",
                        height: "16px",
                        background: "#3b82f6",
                        borderRadius: "3px"
                    }} />
                    <span>派遣</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <div style={{
                        width: "24px",
                        height: "16px",
                        background: "#22c55e",
                        borderRadius: "3px"
                    }} />
                    <span>バイト</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <div style={{
                        width: "24px",
                        height: "16px",
                        background: "#fff",
                        border: "1px solid #e5e7eb",
                        borderRadius: "3px"
                    }} />
                    <span>シフトなし</span>
                </div>
            </div>
        </div>
    );
}
