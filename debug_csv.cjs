const fs = require('fs');

function normalizeTime(t) {
    if (!t) return "";
    if (t.includes(":")) return t.padStart(5, "0");
    return `${t.padStart(2, "0")}:00`;
}

function parseCsv(csvText, year, month) {
    const lines = csvText.split(/\r?\n/).map(line => line.split(","));
    if (lines.length < 3) return;

    // config for sokujitsu
    const nameColIndex = 0;
    const dateRowIndex = 1;
    const dataStartRowIndex = 3;

    const dateRow = lines[dateRowIndex];
    const dayMap = {};
    for (let i = 0; i < dateRow.length; i++) {
        const cell = dateRow[i].trim();
        const match = cell.match(/^(\d+)日?$/);
        if (match) {
            dayMap[parseInt(match[1])] = i;
        }
    }

    let isSplit = false;
    const days = Object.keys(dayMap).map(Number).sort((a, b) => a - b);
    if (days.length > 1) {
        const d1 = days[0];
        const d2 = days[1];
        if (dayMap[d2] - dayMap[d1] === 2) {
            isSplit = true;
        }
    }

    console.log(`Debug: isSplit=${isSplit}, Day1Idx=${dayMap[1]}, Day2Idx=${dayMap[2]}, Day6Idx=${dayMap[6]}`);

    for (let i = dataStartRowIndex; i < lines.length; i++) {
        const row = lines[i];
        const name = row[nameColIndex]?.trim();
        if (name === "安藤 祐貴") {
            const d6_idx = dayMap[6];
            console.log(`Name: ${name}`);
            console.log(`Raw Day 6 Col ${d6_idx}: "${row[d6_idx]}"`);
            if (isSplit) {
                console.log(`Raw Day 6 Col ${d6_idx + 1}: "${row[d6_idx + 1]}"`);
            }
            // Parse all
            Object.keys(dayMap).forEach(day => {
                const colIdx = dayMap[day];
                const val1 = row[colIdx]?.trim();
                let start = "", end = "";
                if (isSplit) {
                    const val2 = row[colIdx + 1]?.trim();
                    if (val1 && val2) { start = val1; end = val2; }
                } else {
                    if (val1) {
                        const parts = val1.split(/\s+/);
                        if (parts.length >= 2) { start = parts[0]; end = parts[1]; }
                    }
                }
                if (start && end) {
                    console.log(`Day ${day}: ${start}-${end} (Norm: ${normalizeTime(start)}-${normalizeTime(end)})`);
                }
            });
        }
    }
}

const csv = fs.readFileSync('jan_sokujitsu_1824.csv', 'utf8');
parseCsv(csv, 2026, 1);
