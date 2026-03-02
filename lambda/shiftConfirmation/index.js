// ShiftConfirmation Lambda - 毎日23:30 JSTにEventBridgeから実行
// Googleスプシから翌日のシフトを取得し、DynamoDBに確定保存する

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
    DynamoDBDocumentClient,
    BatchWriteCommand,
    QueryCommand
} = require("@aws-sdk/lib-dynamodb");
const https = require("https");

const TABLE_NAME = process.env.TABLE_NAME || "ConfirmedShifts";
const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

// ---------- シフトソース定義（フロントのshiftParser.jsと同一） ----------
const SOURCES = [
    {
        monthLabel: "2026-03",
        year: 2026,
        month: 3,
        id: "1dVNnALFuubY1YTVVfVbGHO-I5USXtvy6ODSlru9w3SA",
        sheets: [
            { name: "sokujitsu", gid: "1824179107", nameColIndex: 0, dateRowIndex: 1, dataStartRowIndex: 3 },
            { name: "kaitori", gid: "102139393", nameColIndex: 1, dateRowIndex: 2, dataStartRowIndex: 4 },
            { name: "haken", gid: "841582142", nameColIndex: 0, dateRowIndex: 0, dataStartRowIndex: 2 }
        ]
    },
    {
        monthLabel: "2026-02",
        year: 2026,
        month: 2,
        id: "1dsMYXjC_Q8SCRlavdWncVUxDhTskZXiJXWH25ialGeo",
        sheets: [
            { name: "sokujitsu", gid: "1824179107", nameColIndex: 0, dateRowIndex: 1, dataStartRowIndex: 3 },
            { name: "kaitori", gid: "102139393", nameColIndex: 1, dateRowIndex: 2, dataStartRowIndex: 4 },
            { name: "haken", gid: "841582142", nameColIndex: 0, dateRowIndex: 0, dataStartRowIndex: 2 }
        ]
    },
    {
        monthLabel: "2026-01",
        year: 2026,
        month: 1,
        id: "17hTQGn-idWTiXeQQ9in65C86DQml0jQVe9J7AWEpnTY",
        sheets: [
            { name: "sokujitsu", gid: "1824179107", nameColIndex: 0, dateRowIndex: 1, dataStartRowIndex: 3 }
        ]
    }
];

const SPECIAL_SHIFTS = {
    "朝": { start: "07:00", end: "17:00", dispatchEnd: "15:00" },
    "早": { start: "09:00", end: "19:00", dispatchEnd: "17:00" },
    "中": { start: "10:00", end: "19:00", dispatchEnd: "18:00" },
    "遅": { start: "12:00", end: "22:00", dispatchEnd: "20:00" },
    "深": { start: "17:00", end: "03:00", dispatchEnd: "01:00" }
};

const USER_SHIFT_OVERRIDES = {
    "遅": [
        { nameIncludes: ["鈴木", "平松"], start: "13:00", end: "22:00", dispatchEnd: "21:00" }
    ]
};

const SHEET_TO_LOCATION = {
    "sokujitsu": "即日",
    "kaitori": "買取",
    "koukoku": "広告",
    "ceo": "CEO",
    "haken": "派遣"
};

// ---------- ヘルパー関数（shiftParser.jsと同一） ----------
function normalizeName(name) {
    if (!name) return "";
    return name
        .replace(/[\s\u3000]+/g, "")
        .replace(/髙/g, "高").replace(/凜/g, "凛").replace(/穩/g, "穏")
        .replace(/栁/g, "柳").replace(/﨑/g, "崎").replace(/邉/g, "辺")
        .replace(/邊/g, "辺").replace(/齊/g, "斉").replace(/齋/g, "斉")
        .replace(/龍/g, "竜").replace(/嶋/g, "島").replace(/塚/g, "塚")
        .replace(/德/g, "徳").replace(/惠/g, "恵").replace(/瀨/g, "瀬")
        .replace(/澤/g, "沢").replace(/櫻/g, "桜").replace(/眞/g, "真")
        .replace(/廣/g, "広").replace(/藝/g, "芸").replace(/學/g, "学")
        .replace(/國/g, "国").replace(/鷗/g, "鷹");
}

function normalizeTime(t) {
    if (!t) return "";
    if (t.includes(":")) return t.padStart(5, "0");
    if (t.includes(".")) {
        const parts = t.split(".");
        const hours = parts[0].padStart(2, "0");
        const decimalPart = parseFloat("0." + parts[1]);
        const minutes = Math.round(decimalPart * 60);
        return `${hours}:${String(minutes).padStart(2, "0")}`;
    }
    return `${t.padStart(2, "0")}:00`;
}

function fetchUrl(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { timeout: 30000 }, (res) => {
            // Google Sheetsのリダイレクトをフォロー
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                fetchUrl(res.headers.location).then(resolve).catch(reject);
                return;
            }
            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }
            let data = "";
            res.on("data", chunk => data += chunk);
            res.on("end", () => resolve(data));
        });
        req.on("error", reject);
        req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
    });
}

// ---------- CSVパース（shiftParser.jsのparseCsvと同一ロジック） ----------
function parseCsv(csvText, config, year, month, shifts, locationName) {
    const lines = csvText.split(/\r?\n/).map(line => line.split(","));
    if (lines.length < config.dataStartRowIndex) return;

    const dateRow = lines[config.dateRowIndex];
    if (!dateRow) return;

    const dayMap = {};
    for (let i = 0; i < dateRow.length; i++) {
        const cell = dateRow[i].trim();
        const match = cell.match(/^(\d+)日?$/);
        if (match) {
            const day = parseInt(match[1]);
            if (!(day in dayMap)) dayMap[day] = i;
        }
    }

    let isSplit = false;
    const days = Object.keys(dayMap).map(Number).sort((a, b) => a - b);
    if (days.length > 1) {
        const d1 = days[0], d2 = days[1];
        if (dayMap[d2] - dayMap[d1] === 2) isSplit = true;
    }

    for (let i = config.dataStartRowIndex; i < lines.length; i++) {
        const row = lines[i];
        const rawName = row[config.nameColIndex]?.trim();
        if (!rawName) continue;
        const name = normalizeName(rawName);
        if (!shifts[name]) shifts[name] = {};

        Object.keys(dayMap).forEach(day => {
            const colIdx = dayMap[day];
            const val1 = row[colIdx]?.trim();
            let start = "", end = "";
            let isOff = false;
            let specialShiftCode = null;

            if (val1 && SPECIAL_SHIFTS[val1]) {
                let spec = SPECIAL_SHIFTS[val1];
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
                if (isSplit) {
                    const val2 = row[colIdx + 1]?.trim();
                    if (val1 && val2) { start = val1; end = val2; }
                } else {
                    if (val1) {
                        const parts = val1.split(/\s+/);
                        if (parts.length >= 2) { start = parts[0]; end = parts[1]; }
                    }
                }
            }

            if ((start && end) || isOff) {
                const dayNum = parseInt(day);
                const testDate = new Date(year, month - 1, dayNum);
                if (testDate.getMonth() !== month - 1 || testDate.getDate() !== dayNum) return;
                const dateKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

                const isDispatch = (locationName === "派遣") || (specialShiftCode !== null);
                let dispatchRange = null, partTimeRange = null;

                if (isDispatch && !isOff && specialShiftCode && SPECIAL_SHIFTS[specialShiftCode]?.dispatchEnd) {
                    let spec = { ...SPECIAL_SHIFTS[specialShiftCode] };
                    if (USER_SHIFT_OVERRIDES[specialShiftCode]) {
                        for (const override of USER_SHIFT_OVERRIDES[specialShiftCode]) {
                            if (override.nameIncludes.some(n => name.includes(n))) {
                                spec = { ...spec, ...override };
                                break;
                            }
                        }
                    }
                    dispatchRange = { start: normalizeTime(spec.start), end: normalizeTime(spec.dispatchEnd) };
                } else if (isDispatch && !isOff) {
                    dispatchRange = { start: normalizeTime(start), end: normalizeTime(end) };
                } else if (!isDispatch && !isOff) {
                    partTimeRange = { start: normalizeTime(start), end: normalizeTime(end) };
                }

                const newShift = {
                    start: isOff ? "" : normalizeTime(start),
                    end: isOff ? "" : (dispatchRange && !partTimeRange ? dispatchRange.end : normalizeTime(end)),
                    location: locationName,
                    isOff,
                    isDispatch,
                    dispatchRange,
                    partTimeRange
                };

                const existing = shifts[name][dateKey];
                if (existing) {
                    if (existing.isOff && !newShift.isOff) {
                        shifts[name][dateKey] = newShift;
                    } else if (!existing.isOff && !newShift.isOff) {
                        const mergedStart = existing.start < newShift.start ? existing.start : newShift.start;
                        const mergedLoc = existing.location === newShift.location ? existing.location : `${existing.location}・${newShift.location}`;
                        let mergedDispatchRange = existing.dispatchRange || newShift.dispatchRange;
                        let mergedPartTimeRange = existing.partTimeRange || newShift.partTimeRange;

                        if (existing.dispatchRange && newShift.dispatchRange) {
                            mergedDispatchRange = {
                                start: existing.dispatchRange.start < newShift.dispatchRange.start ? existing.dispatchRange.start : newShift.dispatchRange.start,
                                end: existing.dispatchRange.end > newShift.dispatchRange.end ? existing.dispatchRange.end : newShift.dispatchRange.end
                            };
                        }
                        if (existing.partTimeRange && newShift.partTimeRange) {
                            mergedPartTimeRange = {
                                start: existing.partTimeRange.start < newShift.partTimeRange.start ? existing.partTimeRange.start : newShift.partTimeRange.start,
                                end: existing.partTimeRange.end > newShift.partTimeRange.end ? existing.partTimeRange.end : newShift.partTimeRange.end
                            };
                        }

                        let mergedEnd;
                        if (mergedDispatchRange && mergedPartTimeRange) {
                            mergedEnd = mergedPartTimeRange.end > mergedDispatchRange.end ? mergedPartTimeRange.end : mergedDispatchRange.end;
                        } else if (mergedDispatchRange) {
                            mergedEnd = mergedDispatchRange.end;
                        } else if (mergedPartTimeRange) {
                            mergedEnd = mergedPartTimeRange.end;
                        } else {
                            mergedEnd = existing.end > newShift.end ? existing.end : newShift.end;
                        }

                        shifts[name][dateKey] = {
                            ...existing,
                            start: mergedStart,
                            end: mergedEnd,
                            location: mergedLoc,
                            isDispatch: existing.isDispatch || newShift.isDispatch,
                            dispatchRange: mergedDispatchRange,
                            partTimeRange: mergedPartTimeRange
                        };
                    }
                } else {
                    shifts[name][dateKey] = newShift;
                }
            }
        });
    }
}

// ---------- DynamoDBへの書き込み ----------
async function saveShiftsToDynamo(shifts, targetDate) {
    const items = [];

    for (const userName of Object.keys(shifts)) {
        const shiftData = shifts[userName][targetDate];
        if (!shiftData) continue;

        items.push({
            PutRequest: {
                Item: {
                    dateKey: targetDate,
                    userName: userName,
                    start: shiftData.start || "",
                    end: shiftData.end || "",
                    isOff: shiftData.isOff || false,
                    location: shiftData.location || "",
                    isDispatch: shiftData.isDispatch || false,
                    dispatchRange: shiftData.dispatchRange || null,
                    partTimeRange: shiftData.partTimeRange || null,
                    confirmedAt: new Date().toISOString()
                }
            }
        });
    }

    // DynamoDB BatchWrite は最大25件ずつ
    for (let i = 0; i < items.length; i += 25) {
        const batch = items.slice(i, i + 25);
        await docClient.send(new BatchWriteCommand({
            RequestItems: { [TABLE_NAME]: batch }
        }));
    }

    return items.length;
}

// ---------- メインハンドラー ----------
exports.handler = async (event) => {
    console.log("ShiftConfirmation Lambda started at", new Date().toISOString());

    try {
        // 翌日の日付を計算（JST基準）
        const now = new Date();
        const jstOffset = 9 * 60 * 60 * 1000;
        const jstNow = new Date(now.getTime() + jstOffset);
        const tomorrow = new Date(jstNow);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const targetDate = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;

        console.log(`Confirming shifts for: ${targetDate}`);

        // 該当月のソースを特定
        const targetMonth = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}`;
        const relevantSources = SOURCES.filter(s => s.monthLabel === targetMonth);

        if (relevantSources.length === 0) {
            console.warn(`No SOURCES found for month ${targetMonth}`);
            return { statusCode: 200, body: JSON.stringify({ message: `No sources for ${targetMonth}`, confirmed: 0 }) };
        }

        // スプシからCSV取得
        const shifts = {};
        const tasks = [];

        for (const source of relevantSources) {
            for (const sheet of source.sheets) {
                tasks.push(async () => {
                    try {
                        const url = `https://docs.google.com/spreadsheets/d/${source.id}/export?format=csv&gid=${sheet.gid}&t=${Date.now()}`;
                        const text = await fetchUrl(url);
                        return { text, source, sheet };
                    } catch (e) {
                        console.error(`Fetch error (${source.monthLabel} - ${sheet.name}):`, e.message);
                        return null;
                    }
                });
            }
        }

        const results = await Promise.all(tasks.map(t => t()));

        for (const res of results) {
            if (!res) continue;
            const { text, source, sheet } = res;
            const locationName = SHEET_TO_LOCATION[sheet.name] || sheet.name;
            parseCsv(text, sheet, source.year, source.month, shifts, locationName);
        }

        // DynamoDBに書き込み
        const count = await saveShiftsToDynamo(shifts, targetDate);

        console.log(`Confirmed ${count} shifts for ${targetDate}`);
        return {
            statusCode: 200,
            body: JSON.stringify({
                message: `Confirmed ${count} shifts for ${targetDate}`,
                targetDate,
                confirmed: count
            })
        };
    } catch (err) {
        console.error("ShiftConfirmation error:", err);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Error", error: err.message })
        };
    }
};
