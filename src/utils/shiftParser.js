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
                dateRowIndex: 1,
                dataStartRowIndex: 3
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

export async function fetchShiftData() {
    const shifts = {};

    const SHEET_TO_LOCATION = {
        "sokujitsu": "即日",
        "kaitori": "買取",
        "koukoku": "広告",
        "ceo": "CEO",
        "haken": "派遣"
    };

    const SPECIAL_SHIFTS = {
        "朝": { start: "07:00", end: "17:00" },
        "早": { start: "09:00", end: "19:00" },
        "中": { start: "10:00", end: "19:00" },
        "遅": { start: "12:00", end: "22:00" }
    };

    for (const source of SOURCES) {
        for (const sheet of source.sheets) {
            try {
                const url = `https://docs.google.com/spreadsheets/d/${source.id}/export?format=csv&gid=${sheet.gid}`;
                const response = await fetch(url);
                if (!response.ok) continue;
                const text = await response.text();
                // Map sheet name to Location/Department (Default to sheet name if not found)
                const locationName = SHEET_TO_LOCATION[sheet.name] || sheet.name;
                parseCsv(text, sheet, source.year, source.month, shifts, locationName, SPECIAL_SHIFTS);
            } catch (e) {
                console.error(`Shift fetch error (${source.monthLabel} - ${sheet.name}):`, e);
            }
        }
    }
    return shifts;
}

function parseCsv(csvText, config, year, month, shifts, locationName, specialShifts) {
    const lines = csvText.split(/\r?\n/).map(line => line.split(","));

    if (lines.length < config.dataStartRowIndex) return;

    const dateRow = lines[config.dateRowIndex];
    if (!dateRow) return;

    const dayMap = {};
    for (let i = 0; i < dateRow.length; i++) {
        const cell = dateRow[i].trim();
        // Match "1日" or just "1"
        const match = cell.match(/^(\d+)日?$/);
        if (match) {
            dayMap[parseInt(match[1])] = i;
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

        Object.keys(dayMap).forEach(day => {
            const colIdx = dayMap[day];
            const val1 = row[colIdx]?.trim();

            let start = "", end = "";
            let isOff = false;

            // Check for special single-char codes first (for non-split, usually)
            if (val1 && specialShifts && specialShifts[val1]) {
                const spec = specialShifts[val1];
                start = spec.start;
                end = spec.end;
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
                const isDispatch = (locationName === "派遣") || (!!(specialShifts && val1 && specialShifts[val1]));

                shifts[name][dateKey] = {
                    start: isOff ? "" : normalizeTime(start),
                    end: isOff ? "" : normalizeTime(end),
                    original: isSplit ? `${val1} ${row[colIdx + 1] || ""}` : val1,
                    location: locationName,
                    isOff: isOff,
                    isDispatch: isDispatch
                };
            }
        });
    }
}

function normalizeTime(t) {
    if (!t) return "";
    if (t.includes(":")) return t.padStart(5, "0");
    return `${t.padStart(2, "0")}:00`;
}
