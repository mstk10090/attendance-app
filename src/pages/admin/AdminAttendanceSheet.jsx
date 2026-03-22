import React, { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, addDays, subDays, isSaturday, isSunday } from "date-fns";
import { ja } from "date-fns/locale";
import { fetchShiftData, normalizeName } from "../../utils/shiftParser";
import { HOLIDAYS } from "../../constants";

const API_BASE = "https://lfsu60xvw7.execute-api.ap-northeast-1.amazonaws.com";
const API_USER_URL = `${API_BASE}/users`;

const DAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];
const EXCLUDED_NAMES = new Set(["bb", "テスト", "テストユーザー"]);
const HOLIDAY_SET = new Set(HOLIDAYS);

// --- 締日計算ユーティリティ ---
// 平日かどうか判定（土日・日曜・祝日を除く）
function isBusinessDay(date) {
    if (isSaturday(date) || isSunday(date)) return false;
    return !HOLIDAY_SET.has(format(date, "yyyy-MM-dd"));
}

// 当月の最後の平日（給料日）を取得
function getLastBusinessDay(year, month) {
    // month: 0-indexed
    const lastDay = endOfMonth(new Date(year, month, 1));
    let d = lastDay;
    while (!isBusinessDay(d)) {
        d = subDays(d, 1);
    }
    return d;
}

// 締日（給料日の前日）を取得
function getCutoffDate(year, month) {
    const payday = getLastBusinessDay(year, month);
    return subDays(payday, 1);
}

// 給与計算対象期間を取得（前月締日翌日 〜 当月締日）
function getPayPeriod(year, month) {
    // 当月の締日
    const currentCutoff = getCutoffDate(year, month);
    // 前月の締日
    const prevMonth = month === 0 ? 11 : month - 1;
    const prevYear = month === 0 ? year - 1 : year;
    const prevCutoff = getCutoffDate(prevYear, prevMonth);
    // 前月締日翌日 = 開始日
    const start = addDays(prevCutoff, 1);
    return { start, end: currentCutoff };
}

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

// normalizeName は shiftParser.js からインポート（異体字変換含む完全版）

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
    const [attendanceLoading, setAttendanceLoading] = useState(true);
    const tableRef = useRef(null);
    const todayRowRef = useRef(null);

    // 承認モーダル
    const [confirmModal, setConfirmModal] = useState({ open: false, user: null, dateStr: "", cell: null });
    const [sheetActionComment, setSheetActionComment] = useState("");

    const isAdmin = ["admin", "super_admin"].includes(localStorage.getItem("role"));
    const isSuperAdmin = localStorage.getItem("role") === "super_admin";

    // 締日基準の期間を算出
    const payPeriod = useMemo(() => {
        return getPayPeriod(currentMonth.getFullYear(), currentMonth.getMonth());
    }, [currentMonth]);

    const days = useMemo(() => {
        return eachDayOfInterval({ start: payPeriod.start, end: payPeriod.end });
    }, [payPeriod]);

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

            // 入社日順でソート（スプレッドシートの名簿順）
            const HIRE_ORDER = [
                "眞葛澪", "黒宮悠太", "斉藤七海", "伊藤麻哉", "小河原愛実",
                "平山士穏", "加藤朝陽", "小河原豪", "黒木統丞", "西川菜緒", "小野麻梨花",
                "島田絢菜", "冨工元晴", "山口紘生", "籔中悠太", "関口将聡",
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

    // 勤怠データ取得（並列度UP）
    const fetchAttendances = useCallback(async () => {
        setAttendanceLoading(true);
        try {
            // 10日ずつチャンクで取得（APIの負荷と速度のバランス）
            const CHUNK_SIZE = 10;
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
                // チャンク間の待機を短縮
                if (i + CHUNK_SIZE < days.length) {
                    await new Promise(res => setTimeout(res, 30));
                }
            }
            setAttendanceMap(map);

            // シフトデータ取得
            try {
                const shiftData = await fetchShiftData();
                setShiftMap(shiftData || {});
            } catch (e) {
                console.error("Failed to fetch shift data:", e);
            }
        } catch (e) { console.error("Failed to fetch data:", e); }
        setAttendanceLoading(false);
        setLoading(false);
    }, [currentMonth, days, payPeriod]);

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
        const targetMonthPrefix = format(currentMonth, "yyyy-MM");
        for (const shiftUserName of Object.keys(shiftMap)) {
            if (normalizeName(shiftUserName) === fullName) {
                const userShifts = shiftMap[shiftUserName];
                for (const dateStr of Object.keys(userShifts || {})) {
                    if (dateStr.startsWith(targetMonthPrefix) && userShifts[dateStr]?.isDispatch) return true;
                }
            }
        }
        return false;
    }, [shiftMap, currentMonth]);

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
                } else if (app.status === "sa_return_admin") {
                    status = "sa_return_admin";
                } else if (app.status === "sa_return_staff") {
                    status = "sa_return_staff";
                } else if (app.status === "pending") {
                    status = "pending";
                    clockIn = app.appliedIn || clockIn;
                    clockOut = app.appliedOut || clockOut;
                } else if (app.status === "absent") {
                    status = "absent";
                } else if (app.status === "day_off") {
                    status = "day_off";
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
        let dispatchHours = "";
        let partTimeHours = "";

        if (status === "scheduled") {
            // シフトのみ（打刻なし）→ 時刻は表示しない
        } else if (clockIn) {
            displayIn = clockIn.substring(0, 5);
            displayOut = clockOut ? clockOut.substring(0, 5) : "";

            if (clockIn && clockOut) {
                const inMin = toMin(clockIn);
                const outMin = toMin(clockOut);
                // 休憩時間を考慮
                const breakDur = app?.breakDuration || 0;
                const totalMin = Math.max(0, outMin - inMin - breakDur);
                // 30分単位に丸める
                const roundedMin = Math.floor(totalMin / 30) * 30;

                const isDispatch = (shift && shift.isDispatch) || (!shift && isDispatchUser(user));

                if (isDispatch && shift) {
                    // 派遣ユーザー: 派遣時間優先で計算
                    let dMin = 0;
                    if (shift.dispatchRange) {
                        const dispStart = toMin(shift.dispatchRange.start);
                        const dispEnd = toMin(shift.dispatchRange.end);
                        dMin = Math.min(dispEnd - dispStart, roundedMin);
                    } else {
                        dMin = Math.min(roundedMin, 8 * 60);
                    }
                    const pMin = Math.max(0, roundedMin - dMin);
                    dispatchHours = roundHalf(dMin / 60);
                    partTimeHours = roundHalf(pMin / 60);
                    // 勤怠確認シートにはバイト時間のみ表示
                    hours = partTimeHours;
                    // バイト時間が0の場合（派遣のみ）は全て空白ではなく、緑のステータスにする
                    if (pMin <= 0) {
                        displayIn = "";
                        displayOut = "バイトなし";
                        hours = "";
                        status = "dispatch_only";
                    } else if (pMin > 0 && displayOut) {
                        // 開始時間 = 終了時間 - バイト時間
                        const outMinVal = toMin(displayOut);
                        const partStartMin = outMinVal - pMin;
                        const pH = String(Math.floor(partStartMin / 60)).padStart(2, '0');
                        const pM = String(partStartMin % 60).padStart(2, '0');
                        displayIn = `${pH}:${pM}`;
                    } else {
                        displayIn = "";
                    }
                } else {
                    hours = roundHalf(roundedMin / 60);
                }
            }
        } else if (!clockIn && app && (app.appliedIn && app.appliedOut)) {
            // 打刻なしだが管理者修正で申請時間がある場合
            displayIn = app.appliedIn.substring(0, 5);
            displayOut = app.appliedOut.substring(0, 5);

            const inMin = toMin(app.appliedIn);
            const outMin = toMin(app.appliedOut);
            const breakDur = app.breakDuration || 0;
            const totalMin = Math.max(0, outMin - inMin - breakDur);
            const roundedMin = Math.floor(totalMin / 30) * 30;

            const isDispatch = (shift && shift.isDispatch) || (!shift && isDispatchUser(user));

            if (isDispatch && shift) {
                let dMin = 0;
                if (shift.dispatchRange) {
                    const dispStart = toMin(shift.dispatchRange.start);
                    const dispEnd = toMin(shift.dispatchRange.end);
                    dMin = Math.min(dispEnd - dispStart, roundedMin);
                } else {
                    dMin = Math.min(roundedMin, 8 * 60);
                }
                const pMin = Math.max(0, roundedMin - dMin);
                dispatchHours = roundHalf(dMin / 60);
                partTimeHours = roundHalf(pMin / 60);
                hours = partTimeHours;
                // バイト時間が0の場合（派遣のみ）は緑のステータスにする
                if (pMin <= 0) {
                    displayIn = "";
                    displayOut = "バイトなし";
                    hours = "";
                    status = "dispatch_only";
                } else if (pMin > 0 && displayOut) {
                    // 開始時間 = 終了時間 - バイト時間
                    const outMinVal = toMin(displayOut);
                    const partStartMin = outMinVal - pMin;
                    const pH2 = String(Math.floor(partStartMin / 60)).padStart(2, '0');
                    const pM2 = String(partStartMin % 60).padStart(2, '0');
                    displayIn = `${pH2}:${pM2}`;
                } else {
                    displayIn = "";
                }
            } else {
                hours = roundHalf(roundedMin / 60);
            }
        }

        return { status, clockIn, clockOut, displayIn, displayOut, hours, dispatchHours, partTimeHours, confirmedBy, att, shift, app };
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

    // 最終承認後のアクション実行（井本へ再提出、スタッフへ再提出、承認取消）
    const executeSheetAction = async (actionType) => {
        const { user, dateStr } = confirmModal;
        if (!user) return;

        // attをaltUserIdsでも取得
        let att = attendanceMap[`${user.userId}_${dateStr}`];
        let attKey = `${user.userId}_${dateStr}`;
        if (!att && user.altUserIds) {
            for (const altId of user.altUserIds) {
                const k = `${altId}_${dateStr}`;
                if (attendanceMap[k]) { att = attendanceMap[k]; attKey = k; break; }
            }
        }
        if (!att) { alert("データが見つかりません"); return; }

        const p = parseComment(att.comment);
        const existingApp = p.application || {};
        let newApp, logDetail;

        const comment = sheetActionComment.trim();

        if (actionType === "return_admin") {
            // 井本へ再提出
            newApp = { ...existingApp, status: "sa_return_admin", superAdminComment: comment || null };
            delete newApp.confirmedBy;
            delete newApp.confirmedAt;
            logDetail = `上位管理者が管理者へ再提出を依頼しました${comment ? `: ${comment}` : ""}`;
        } else if (actionType === "return_staff") {
            // スタッフへ再提出
            newApp = { ...existingApp, status: "sa_return_staff", superAdminComment: comment || null };
            delete newApp.confirmedBy;
            delete newApp.confirmedAt;
            logDetail = `上位管理者がスタッフへ再提出を依頼しました${comment ? `: ${comment}` : ""}`;
        } else if (actionType === "cancel") {
            // 承認取消 → approved に戻す
            newApp = { ...existingApp, status: "approved", superAdminComment: comment || null };
            delete newApp.confirmedBy;
            delete newApp.confirmedAt;
            logDetail = `上位管理者が承認を取り消しました${comment ? `: ${comment}` : ""}`;
        }

        const newComment = JSON.stringify({
            segments: p.segments, text: p.text, application: newApp,
            auditLog: [...(p.auditLog || []), { action: `sa_${actionType}`, by: "上位管理者", at: new Date().toISOString(), detail: logDetail }]
        });

        try {
            await fetch(`${API_BASE}/attendance/update`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId: att.userId, workDate: att.workDate, clockIn: att.clockIn, clockOut: att.clockOut, breaks: att.breaks || [], comment: newComment })
            });
            setAttendanceMap(prev => ({ ...prev, [attKey]: { ...att, comment: newComment } }));
        } catch (e) { alert("エラーが発生しました"); }

        setSheetActionComment("");
        setConfirmModal({ open: false, user: null, dateStr: "", cell: null });
    };

    const closeConfirmModal = () => { setConfirmModal({ open: false, user: null, dateStr: "", cell: null }); setSheetActionComment(""); };

    // セルの背景色
    const getCellBg = (status) => {
        switch (status) {
            case "confirmed": return "#fef08a";       // 安保さん承認済み（黄）
            case "approved": return "#ffffff";          // 安保さん承認待ち（白）
            case "pending": return "#fbcfe8";           // 井本承認待ち（桃）
            case "resubmission": return "#e9d5ff";      // 再提出（紫）
            case "absent": return "#800000";            // 欠勤（えんじ）
            case "day_off": return "#2563eb";           // 休み（青）
            case "no_shift": return "#e5e7eb";          // シフトなし（薄灰）
            case "dispatch_only": return "#bbf7d0";     // 派遣かつバイトなし（緑）
            case "scheduled": return "#ffffff";         // シフトあり未出勤（白）
            case "cancelled": return "#fecaca";
            case "no_application": return "#fbcfe8";    // 井本承認待ちと同じ桃
            case "sa_return_admin": return "#fecaca";    // 差戻(管)赤
            case "sa_return_staff": return "#fed7aa";    // 差戻(ス)橙
            default: return "#ffffff";
        }
    };

    const prevMonth = () => setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
    const nextMonth = () => setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));

    // 各ユーザーの月次合計（安保さん承認待ち + 安保さん承認済みのみ）
    const getUserMonthTotal = useCallback((user) => {
        let totalHours = 0;
        let workDays = 0;
        days.forEach(day => {
            const dateStr = format(day, "yyyy-MM-dd");
            const cell = getCellData(user, dateStr);
            // approved = 安保さん承認待ち、confirmed = 安保さん承認済み
            if ((cell.status === "approved" || cell.status === "confirmed") && cell.hours && parseFloat(cell.hours) > 0) {
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
                    <span style={{ fontWeight: "bold", fontSize: "1.1rem", minWidth: "240px", textAlign: "center" }}>
                        {format(currentMonth, "yyyy年M月", { locale: ja })}
                        <span style={{ fontSize: "0.8rem", fontWeight: "normal", color: "#6b7280", marginLeft: "8px" }}>
                            ({format(payPeriod.start, "M/d")} 〜 {format(payPeriod.end, "M/d")})
                        </span>
                    </span>
                    <button onClick={nextMonth} style={{ border: "1px solid #d1d5db", background: "#fff", borderRadius: "6px", padding: "6px 12px", cursor: "pointer", fontSize: "1rem" }}>&gt;</button>
                </div>
            </div>

            {/* 凡例 */}
            <div style={{ display: "flex", gap: "12px", marginBottom: "10px", flexWrap: "wrap", fontSize: "12px", flexShrink: 0, alignItems: "center" }}>
                {[
                    { color: "#e5e7eb", label: "シフトなし" },
                    { color: "#2563eb", label: "休み", textColor: "#fff" },
                    { color: "#bbf7d0", label: "バイトなし(派遣)" },
                    { color: "#800000", label: "欠勤", textColor: "#fff" },
                    { color: "#e9d5ff", label: "再提出" },
                    { color: "#fbcfe8", label: "井本承認待ち" },
                    { color: "#ffffff", label: "安保さん承認待ち" },
                    { color: "#fef08a", label: "安保さん承認済み" },
                    { color: "transparent", border: true, label: "本日" },
                ].map(({ color, label, border, textColor }) => (
                    <div key={label} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                        <div style={{
                            width: "16px", height: "16px", background: color,
                            border: border ? "2px solid #f59e0b" : "1px solid #d1d5db", borderRadius: "3px",
                            color: textColor || "inherit", fontSize: "8px", display: "flex", alignItems: "center", justifyContent: "center"
                        }} />
                        <span>{label}</span>
                    </div>
                ))}
                <div style={{
                    marginLeft: "16px", padding: "4px 12px", borderRadius: "6px",
                    background: "#dbeafe", border: "1px solid #93c5fd",
                    display: "flex", alignItems: "center", gap: "6px",
                    fontSize: "11px", color: "#1e40af", fontWeight: "bold"
                }}>
                    📊 合計集計対象：
                    <span style={{ background: "#ffffff", border: "1px solid #d1d5db", padding: "1px 6px", borderRadius: "4px", fontSize: "10px" }}>安保さん承認待ち</span>
                    <span style={{ fontSize: "10px" }}>＋</span>
                    <span style={{ background: "#fef08a", border: "1px solid #eab308", padding: "1px 6px", borderRadius: "4px", fontSize: "10px" }}>安保さん承認済み</span>
                </div>
            </div>

            {users.length === 0 && loading ? (
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
                                        style={{ background: isWeekend ? "#f9fafb" : "transparent" }}
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
                                                background: bg,
                                                color: (cell.status === "absent" || cell.status === "day_off") ? "#fff" : "inherit",
                                                cursor: hasData ? "pointer" : "default",
                                                transition: "background 0.15s",
                                                boxShadow: isTodayRow ? "inset 0 2px 0 0 #f59e0b, inset 0 -2px 0 0 #f59e0b" : "none",
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
                                                        {cell.hours !== "" && cell.hours !== undefined ? cell.hours : ""}
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
                const canApprove = modalCell?.status === "approved" && isSuperAdmin;
                const STATUS_LABELS = {
                    approved: { icon: "✅", label: "承認済み", color: "#16a34a" },
                    pending: { icon: "⏳", label: "承認待ち", color: "#f59e0b" },
                    resubmission: { icon: "🔄", label: "再提出", color: "#8b5cf6" },
                    absent: { icon: "🚫", label: "欠勤", color: "#800000" },
                    confirmed: { icon: "🏆", label: "最終承認済み", color: "#2563eb" },
                    working: { icon: "💼", label: "出勤中", color: "#3b82f6" },
                    no_application: { icon: "📋", label: "未申請", color: "#d97706" },
                    cancelled: { icon: "❌", label: "取消済み", color: "#dc2626" },
                    sa_return_admin: { icon: "🔴", label: "上位差戻(管理者へ)", color: "#be123c" },
                    sa_return_staff: { icon: "🟠", label: "上位差戻(スタッフへ)", color: "#c2410c" },
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
                            {modalCell && (() => {
                                const shift = modalCell.shift;
                                const att = modalCell.att;
                                const app = modalCell.app;
                                const rawClockIn = att?.clockIn ? att.clockIn.substring(0, 5) : "-";
                                const rawClockOut = att?.clockOut ? att.clockOut.substring(0, 5) : "-";
                                const reason = app?.reason && app.reason !== "-" ? app.reason : null;
                                const adminComment = app?.adminComment || null;
                                return (
                                    <div style={{
                                        background: "#f9fafb", borderRadius: "10px", padding: "16px",
                                        marginBottom: "20px", fontSize: "0.85rem", textAlign: "left"
                                    }}>
                                        <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                            <tbody>
                                                {/* シフト */}
                                                <tr>
                                                    <td style={{ padding: "6px 8px", color: "#6b7280", fontWeight: "600", whiteSpace: "nowrap", borderBottom: "1px solid #e5e7eb" }}>📅 シフト</td>
                                                    <td style={{ padding: "6px 8px", borderBottom: "1px solid #e5e7eb", fontWeight: "bold" }}>
                                                        {shift && shift.start ? `${shift.start} - ${shift.end}` : "-"}
                                                        {shift?.isDispatch && <span style={{ marginLeft: "6px", background: "#a5b4fc", color: "#312e81", padding: "1px 6px", borderRadius: "4px", fontSize: "10px" }}>派遣</span>}
                                                    </td>
                                                </tr>
                                                {/* 実績（打刻） */}
                                                <tr>
                                                    <td style={{ padding: "6px 8px", color: "#6b7280", fontWeight: "600", whiteSpace: "nowrap", borderBottom: "1px solid #e5e7eb" }}>⏱ 実績（打刻）</td>
                                                    <td style={{ padding: "6px 8px", borderBottom: "1px solid #e5e7eb" }}>
                                                        {rawClockIn} ~ {rawClockOut}
                                                    </td>
                                                </tr>
                                                {/* 申請時間（井本承認時間） */}
                                                <tr style={{ background: "#eff6ff" }}>
                                                    <td style={{ padding: "6px 8px", color: "#2563eb", fontWeight: "600", whiteSpace: "nowrap", borderBottom: "1px solid #e5e7eb" }}>✅ 申請時間</td>
                                                    <td style={{ padding: "6px 8px", borderBottom: "1px solid #e5e7eb", fontWeight: "bold", color: "#1e40af" }}>
                                                        {modalCell.displayIn || "-"} ~ {modalCell.displayOut || "-"}
                                                        <span style={{ marginLeft: "12px", color: "#059669", fontWeight: "bold" }}>
                                                            合計: {modalCell.hours || "-"}h
                                                        </span>
                                                    </td>
                                                </tr>
                                                {/* 休憩時間（申請時間の長さ - 合計時間から計算） */}
                                                {(() => {
                                                    let breakMin = app?.breakDuration || 0;
                                                    // breakDurationが未設定の場合は差分から計算
                                                    if (!breakMin && modalCell.displayIn && modalCell.displayOut && modalCell.hours) {
                                                        const [h1, m1] = modalCell.displayIn.split(":").map(Number);
                                                        const [h2, m2] = modalCell.displayOut.split(":").map(Number);
                                                        const spanMin = (h2 * 60 + m2) - (h1 * 60 + m1);
                                                        const workMin = Math.round(parseFloat(modalCell.hours) * 60);
                                                        breakMin = spanMin - workMin;
                                                    }
                                                    if (breakMin > 0) {
                                                        const bH = Math.floor(breakMin / 60);
                                                        const bM = breakMin % 60;
                                                        return (
                                                            <tr>
                                                                <td style={{ padding: "6px 8px", color: "#6b7280", fontWeight: "600", whiteSpace: "nowrap", borderBottom: "1px solid #e5e7eb" }}>☕ 休憩</td>
                                                                <td style={{ padding: "6px 8px", borderBottom: "1px solid #e5e7eb", color: "#374151" }}>
                                                                    {bH > 0 ? `${bH}時間${bM > 0 ? `${bM}分` : ""}` : `${bM}分`}
                                                                </td>
                                                            </tr>
                                                        );
                                                    }
                                                    return null;
                                                })()}
                                                {/* 申請理由 */}
                                                {reason && (
                                                    <tr>
                                                        <td style={{ padding: "6px 8px", color: "#6b7280", fontWeight: "600", whiteSpace: "nowrap", borderBottom: "1px solid #e5e7eb" }}>📝 申請理由</td>
                                                        <td style={{ padding: "6px 8px", borderBottom: "1px solid #e5e7eb", color: "#374151" }}>
                                                            {reason}
                                                            {(() => {
                                                                const sub = app?.subReason;
                                                                const subText = app?.subReasonText;
                                                                const detail = app?.detailText;
                                                                const parts = [];
                                                                if (sub && sub !== "-") parts.push(sub);
                                                                if (subText && sub === "その他") parts.push(subText);
                                                                if (detail) parts.push(detail);
                                                                if (parts.length > 0) {
                                                                    return <span style={{ color: "#6b7280", fontSize: "0.85em" }}>（理由: {parts.join(" / ")}）</span>;
                                                                }
                                                                return null;
                                                            })()}
                                                        </td>
                                                    </tr>
                                                )}
                                                {/* 管理者コメント */}
                                                {adminComment && (
                                                    <tr>
                                                        <td style={{ padding: "6px 8px", color: "#6b7280", fontWeight: "600", whiteSpace: "nowrap", borderBottom: "1px solid #e5e7eb" }}>💬 管理者メモ</td>
                                                        <td style={{ padding: "6px 8px", color: "#374151", borderBottom: "1px solid #e5e7eb" }}>
                                                            {adminComment}
                                                        </td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                        {/* 操作ログ */}
                                        {(() => {
                                            const p = att ? parseComment(att.comment) : null;
                                            const logs = p?.auditLog || [];
                                            if (logs.length === 0) return null;
                                            return (
                                                <div style={{ marginTop: "12px", borderTop: "1px solid #e5e7eb", paddingTop: "10px" }}>
                                                    <div style={{ fontSize: "0.78rem", color: "#6b7280", fontWeight: "600", marginBottom: "6px" }}>
                                                        📋 操作ログ
                                                    </div>
                                                    <div style={{ maxHeight: "140px", overflowY: "auto" }}>
                                                        {logs.slice().reverse().map((log, idx) => {
                                                            const d = log.at ? new Date(log.at) : null;
                                                            const timeStr = d ? `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : "";
                                                            return (
                                                                <div key={idx} style={{
                                                                    display: "flex", alignItems: "flex-start", gap: "8px",
                                                                    padding: "4px 0", borderBottom: idx < logs.length - 1 ? "1px solid #f3f4f6" : "none",
                                                                    fontSize: "0.75rem"
                                                                }}>
                                                                    <span style={{ color: "#9ca3af", whiteSpace: "nowrap", minWidth: "70px" }}>{timeStr}</span>
                                                                    <span style={{ color: "#6b7280", whiteSpace: "nowrap", fontWeight: "600" }}>{log.by || "-"}</span>
                                                                    <span style={{ color: "#374151", wordBreak: "break-word" }}>{log.detail || log.action || "-"}</span>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            );
                                        })()}
                                    </div>
                                );
                            })()}
                            {/* 最終承認後のアクション（confirmed + isSuperAdmin） */}
                            {modalCell?.status === "confirmed" && isSuperAdmin && (
                                <div style={{ marginBottom: "16px" }}>
                                    <textarea
                                        placeholder="コメント・理由を入力（任意）"
                                        value={sheetActionComment}
                                        onChange={e => setSheetActionComment(e.target.value)}
                                        style={{
                                            width: "100%", minHeight: "60px", padding: "10px",
                                            borderRadius: "8px", border: "1px solid #d1d5db",
                                            fontSize: "0.85rem", resize: "vertical", boxSizing: "border-box",
                                            marginBottom: "12px"
                                        }}
                                    />
                                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                                        <button
                                            onClick={() => executeSheetAction("return_admin")}
                                            style={{
                                                flex: 1, padding: "10px 8px", borderRadius: "8px",
                                                border: "none", background: "#2563eb", color: "#fff",
                                                fontSize: "0.8rem", fontWeight: "600", cursor: "pointer"
                                            }}
                                        >
                                            🔵 井本へ再提出
                                        </button>
                                        <button
                                            onClick={() => executeSheetAction("return_staff")}
                                            style={{
                                                flex: 1, padding: "10px 8px", borderRadius: "8px",
                                                border: "none", background: "#f97316", color: "#fff",
                                                fontSize: "0.8rem", fontWeight: "600", cursor: "pointer"
                                            }}
                                        >
                                            🟠 スタッフへ再提出
                                        </button>
                                        <button
                                            onClick={() => executeSheetAction("cancel")}
                                            style={{
                                                flex: 1, padding: "10px 8px", borderRadius: "8px",
                                                border: "1px solid #fca5a5", background: "#fee2e2", color: "#991b1b",
                                                fontSize: "0.8rem", fontWeight: "600", cursor: "pointer"
                                            }}
                                        >
                                            ❌ 承認取消
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* 承認待ち（approved）→ コメント付き承認 */}
                            {canApprove && (
                                <div style={{ marginBottom: "16px" }}>
                                    <textarea
                                        placeholder="承認コメント（任意）"
                                        value={sheetActionComment}
                                        onChange={e => setSheetActionComment(e.target.value)}
                                        style={{
                                            width: "100%", minHeight: "50px", padding: "10px",
                                            borderRadius: "8px", border: "1px solid #d1d5db",
                                            fontSize: "0.85rem", resize: "vertical", boxSizing: "border-box",
                                            marginBottom: "12px"
                                        }}
                                    />
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
