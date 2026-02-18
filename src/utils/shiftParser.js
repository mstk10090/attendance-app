const SOURCES = [
    {
        monthLabel: "2026-02",
        year: 2026,
        month: 2,
        id: "1dsMYXjC_Q8SCRlavdWncVUxDhTskZXiJXWH25ialGeo",
        sheets: [
            {
                name: "sokujitsu",
                gid: "1824179107",
                nameColIndex: 0,
                dateRowIndex: 1,
                dataStartRowIndex: 3,
            },
            {
                name: "kaitori",
                gid: "102139393",
                nameColIndex: 1,
                dateRowIndex: 2,
                dataStartRowIndex: 4
            },
            {
                name: "haken",
                gid: "841582142",
                nameColIndex: 0,
                dateRowIndex: 0,
                dataStartRowIndex: 2
            }
        ]
    },
    {
        monthLabel: "2026-01",
        year: 2026,
        month: 1,
        id: "17hTQGn-idWTiXeQQ9in65C86DQml0jQVe9J7AWEpnTY",
        sheets: [
            {
                name: "sokujitsu",
                gid: "1824179107", // Checked via CSV: This is the correct GID for Jan Sokujitsu
                nameColIndex: 0,
                dateRowIndex: 1,
                dataStartRowIndex: 3,
            }
        ]
    }
];

export const SPECIAL_SHIFTS = {
    // 派遣シフト: dispatchEndは派遣先での終了時刻、endは全体の終了時刻
    "朝": { start: "07:00", end: "17:00", dispatchEnd: "15:00" },  // 派遣7-15、バイト15-17
    "早": { start: "09:00", end: "19:00", dispatchEnd: "17:00" },  // 派遣9-17、バイト17-19
    "中": { start: "10:00", end: "19:00", dispatchEnd: "17:00" },  // 派遣10-17、バイト17-19
    "遅": { start: "12:00", end: "22:00", dispatchEnd: "20:00" },  // 派遣12-20、バイト20-22（デフォルト）
    "深": { start: "17:00", end: "03:00", dispatchEnd: "01:00" }   // 深夜シフト
};

// ユーザー固有のシフトオーバーライド（名前の部分一致で適用）
const USER_SHIFT_OVERRIDES = {
    "遅": [
        { nameIncludes: ["鈴木", "平松"], start: "13:00", end: "22:00", dispatchEnd: "21:00" }
    ]
};

const SHIFT_CACHE_KEY = "shift_data_cache";

// キャッシュの読み込み
function loadShiftCache() {
    try {
        const raw = localStorage.getItem(SHIFT_CACHE_KEY);
        if (!raw) return {};
        return JSON.parse(raw);
    } catch (e) {
        console.warn("Shift cache parse error:", e);
        return {};
    }
}

// キャッシュの保存
function saveShiftCache(cache) {
    try {
        localStorage.setItem(SHIFT_CACHE_KEY, JSON.stringify(cache));
    } catch (e) {
        console.warn("Shift cache save error:", e);
    }
}

// 今日の日付を YYYY-MM-DD で取得
function getTodayStr() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export async function fetchShiftData(forceRefresh = false, additionalSources = []) {
    const shifts = {};

    const SHEET_TO_LOCATION = {
        "sokujitsu": "即日",
        "kaitori": "買取",
        "koukoku": "広告",
        "ceo": "CEO",
        "haken": "派遣"
    };

    // Combine hardcoded sources with any dynamic ones provided
    const allSources = [...SOURCES, ...additionalSources];

    const tasks = [];

    // Create fetch tasks preserving order
    for (const source of allSources) {
        // Validation: If dynamic source lacks structure, skip safely
        if (!source || !source.sheets) continue;

        for (const sheet of source.sheets) {
            tasks.push(async () => {
                try {
                    let url = `https://docs.google.com/spreadsheets/d/${source.id}/export?format=csv&gid=${sheet.gid}`;
                    if (forceRefresh) {
                        url += `&t=${Date.now()}`;
                    }

                    // 30s Timeout (延長してAbortError対策)
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 30000);

                    const response = await fetch(url, { signal: controller.signal });
                    clearTimeout(timeoutId);

                    if (!response.ok) {
                        console.warn(`Shift fetch failed: ${response.status} for ${source.monthLabel} - ${sheet.name}`);
                        return null;
                    }
                    const text = await response.text();
                    return { text, source, sheet };
                } catch (e) {
                    console.error(`Shift fetch error (${source.monthLabel} - ${sheet.name}):`, e);
                    return null;
                }
            });
        }
    }

    // Execute in parallel
    const results = await Promise.all(tasks.map(t => t()));

    // Process sequentially to maintain merge order
    for (const res of results) {
        if (!res) continue;
        const { text, source, sheet } = res;
        const locationName = SHEET_TO_LOCATION[sheet.name] || sheet.name;
        // parseCsv mutates 'shifts'
        parseCsv(text, sheet, source.year, source.month, shifts, locationName, SPECIAL_SHIFTS);
    }

    // --- キャッシュ確定ロジック ---
    // 当日以前: キャッシュがあればキャッシュを優先（スプシの後日修正を無視）
    // 翌日以降: スプシ最新データを使用し、キャッシュを更新
    const todayStr = getTodayStr();
    const cache = loadShiftCache();

    const mergedShifts = {};

    // まず、スプシから取得した最新データを基にする
    for (const userName of Object.keys(shifts)) {
        mergedShifts[userName] = {};

        for (const dateKey of Object.keys(shifts[userName])) {
            // prescribed_YYYY_MM 等のメタデータはそのまま通す
            if (dateKey.startsWith("prescribed_")) {
                mergedShifts[userName][dateKey] = shifts[userName][dateKey];
                continue;
            }

            if (dateKey <= todayStr) {
                // 当日以前: キャッシュがあればキャッシュを使用（確定済み）
                if (cache[userName] && cache[userName][dateKey]) {
                    mergedShifts[userName][dateKey] = cache[userName][dateKey];
                } else {
                    // キャッシュがない場合は初回読み込みとしてスプシ値を使用しキャッシュに保存
                    mergedShifts[userName][dateKey] = shifts[userName][dateKey];
                }
            } else {
                // 翌日以降: スプシ最新データを使用
                mergedShifts[userName][dateKey] = shifts[userName][dateKey];
            }
        }
    }

    // キャッシュにあるが今回のスプシデータにない過去の日付も保持
    for (const userName of Object.keys(cache)) {
        if (!mergedShifts[userName]) mergedShifts[userName] = {};
        for (const dateKey of Object.keys(cache[userName])) {
            if (dateKey.startsWith("prescribed_")) continue;
            if (dateKey <= todayStr && !mergedShifts[userName][dateKey]) {
                mergedShifts[userName][dateKey] = cache[userName][dateKey];
            }
        }
    }

    // キャッシュを更新: 全データを保存（当日以前 = 確定値、翌日以降 = 最新値）
    const newCache = {};
    for (const userName of Object.keys(mergedShifts)) {
        newCache[userName] = {};
        for (const dateKey of Object.keys(mergedShifts[userName])) {
            if (dateKey.startsWith("prescribed_")) continue;
            newCache[userName][dateKey] = mergedShifts[userName][dateKey];
        }
    }
    saveShiftCache(newCache);

    return mergedShifts;
}

export function parseCsv(csvText, config, year, month, shifts, locationName, specialShifts) {
    const lines = csvText.split(/\r?\n/).map(line => line.split(","));

    if (lines.length < config.dataStartRowIndex) return;

    const dateRow = lines[config.dateRowIndex];
    if (!dateRow) return;

    const dayMap = {};
    let prescribedDaysColIndex = -1;

    for (let i = 0; i < dateRow.length; i++) {
        const cell = dateRow[i].trim();
        // Match "1日" or just "1"
        const match = cell.match(/^(\d+)日?$/);
        if (match) {
            dayMap[parseInt(match[1])] = i;
        } else if (cell === "規定出勤日数" || cell === "規定日数") {
            prescribedDaysColIndex = i;
        }
    }

    // Determine Stride / Format
    let isSplit = false;
    const days = Object.keys(dayMap).map(Number).sort((a, b) => a - b);
    if (days.length > 1) {
        const d1 = days[0];
        const d2 = days[1];
        if (dayMap[d2] - dayMap[d1] === 2) {
            isSplit = true;
        }
    }

    for (let i = config.dataStartRowIndex; i < lines.length; i++) {
        const row = lines[i];
        const name = row[config.nameColIndex]?.trim();
        if (!name) continue;

        if (!shifts[name]) shifts[name] = {};

        // Parse Prescribed Days
        if (prescribedDaysColIndex !== -1) {
            const val = row[prescribedDaysColIndex]?.trim();
            if (val) {
                shifts[name][`prescribed_${year}_${month}`] = val;
            }
        }

        Object.keys(dayMap).forEach(day => {
            const colIdx = dayMap[day];
            const val1 = row[colIdx]?.trim();

            let start = "", end = "";
            let isOff = false;

            // Check for special single-char codes first (for non-split, usually)
            let specialShiftCode = null;
            if (val1 && specialShifts && specialShifts[val1]) {
                // ユーザー固有のオーバーライドが存在するか確認
                let spec = specialShifts[val1];
                if (USER_SHIFT_OVERRIDES[val1]) {
                    for (const override of USER_SHIFT_OVERRIDES[val1]) {
                        if (override.nameIncludes.some(n => name.includes(n))) {
                            spec = { ...spec, ...override };
                            break;
                        }
                    }
                }
                start = spec.start;
                end = spec.end;
                specialShiftCode = val1;
            } else if (val1 === "休" || val1 === "休み") {
                isOff = true;
            } else {
                // Normal Parsing
                if (isSplit) {
                    // expect start in colIdx, end in colIdx+1
                    const val2 = row[colIdx + 1]?.trim();
                    if (val1 && val2) {
                        start = val1;
                        end = val2;
                    }
                } else {
                    // expect "Start End" in val1
                    if (val1) {
                        const parts = val1.split(/\s+/);
                        if (parts.length >= 2) {
                            start = parts[0];
                            end = parts[1];
                        }
                    }
                }
            }

            if ((start && end) || isOff) {
                // Construct YYYY-MM-DD key
                const dateKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

                // Determine if Dispatch based on special code match or location
                const isDispatch = (locationName === "派遣") || (specialShiftCode !== null);

                // 派遣シフトの場合、dispatchEndを使って派遣区間を設定
                let dispatchRange = null;
                let partTimeRange = null;

                if (isDispatch && !isOff && specialShiftCode && specialShifts[specialShiftCode]?.dispatchEnd) {
                    // 派遣シフト（朝・早・遅・中）の場合 - dispatchEndまでが派遣時間
                    // ユーザー固有のオーバーライドを再適用
                    let spec = { ...specialShifts[specialShiftCode] };
                    if (USER_SHIFT_OVERRIDES[specialShiftCode]) {
                        for (const override of USER_SHIFT_OVERRIDES[specialShiftCode]) {
                            if (override.nameIncludes.some(n => name.includes(n))) {
                                spec = { ...spec, ...override };
                                break;
                            }
                        }
                    }
                    dispatchRange = {
                        start: normalizeTime(spec.start),
                        end: normalizeTime(spec.dispatchEnd)
                    };
                    // 派遣シフト単体の場合はpartTimeRangeは設定しない
                    // （即日シフトがマージされた時にpartTimeRangeが設定される）
                } else if (isDispatch && !isOff) {
                    // dispatchEndがない派遣シフト
                    dispatchRange = { start: normalizeTime(start), end: normalizeTime(end) };
                } else if (!isDispatch && !isOff) {
                    // バイト（即日など）
                    partTimeRange = { start: normalizeTime(start), end: normalizeTime(end) };
                }

                const newShift = {
                    start: isOff ? "" : normalizeTime(start),
                    end: isOff ? "" : normalizeTime(end),
                    original: isSplit ? `${val1} ${row[colIdx + 1] || ""}` : val1,
                    location: locationName,
                    isOff: isOff,
                    isDispatch: isDispatch,
                    dispatchRange: dispatchRange,
                    partTimeRange: partTimeRange
                };

                const existing = shifts[name][dateKey];
                if (existing) {
                    // MERGE LOGIC
                    if (existing.isOff && !newShift.isOff) {
                        // Work overrides Off
                        shifts[name][dateKey] = newShift;
                    } else if (!existing.isOff && newShift.isOff) {
                        // Keep Work (ignore Off)
                    } else if (!existing.isOff && !newShift.isOff) {
                        // Both Work: Extend Range and preserve dispatch/partTime ranges
                        const mergedStart = (existing.start < newShift.start) ? existing.start : newShift.start;
                        const mergedEnd = (existing.end > newShift.end) ? existing.end : newShift.end;
                        const mergedLoc = existing.location === newShift.location ? existing.location : `${existing.location}・${newShift.location}`;

                        // Merge dispatchRange: 既存または新規の派遣区間を保持
                        let mergedDispatchRange = existing.dispatchRange || newShift.dispatchRange;
                        // Merge partTimeRange: 既存または新規のバイト区間を保持
                        let mergedPartTimeRange = existing.partTimeRange || newShift.partTimeRange;

                        // もし両方にdispatchRangeがある場合は、範囲を拡張
                        if (existing.dispatchRange && newShift.dispatchRange) {
                            mergedDispatchRange = {
                                start: existing.dispatchRange.start < newShift.dispatchRange.start ? existing.dispatchRange.start : newShift.dispatchRange.start,
                                end: existing.dispatchRange.end > newShift.dispatchRange.end ? existing.dispatchRange.end : newShift.dispatchRange.end
                            };
                        }

                        // もし両方にpartTimeRangeがある場合は、範囲を拡張
                        if (existing.partTimeRange && newShift.partTimeRange) {
                            mergedPartTimeRange = {
                                start: existing.partTimeRange.start < newShift.partTimeRange.start ? existing.partTimeRange.start : newShift.partTimeRange.start,
                                end: existing.partTimeRange.end > newShift.partTimeRange.end ? existing.partTimeRange.end : newShift.partTimeRange.end
                            };
                        }

                        shifts[name][dateKey] = {
                            ...existing,
                            start: mergedStart,
                            end: mergedEnd,
                            location: mergedLoc,
                            isDispatch: existing.isDispatch || newShift.isDispatch,
                            dispatchRange: mergedDispatchRange,
                            partTimeRange: mergedPartTimeRange,
                            // Append original text for debug/detail
                            original: `${existing.original} / ${newShift.original}`
                        };
                    }
                } else {
                    shifts[name][dateKey] = newShift;
                }
            }
        });
    }
}

function normalizeTime(t) {
    if (!t) return "";
    // 既にHH:MM形式の場合
    if (t.includes(":")) return t.padStart(5, "0");
    // 小数点形式の場合（例: 17.5 → 17:30）
    if (t.includes(".")) {
        const parts = t.split(".");
        const hours = parts[0].padStart(2, "0");
        const decimalPart = parseFloat("0." + parts[1]);
        const minutes = Math.round(decimalPart * 60);
        return `${hours}:${String(minutes).padStart(2, "0")}`;
    }
    // 整数のみの場合（例: 17 → 17:00）
    return `${t.padStart(2, "0")}:00`;
}
