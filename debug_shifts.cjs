const https = require('https');

const SPREADSHEET_ID = "1dsMYXjC_Q8SCRlavdWncVUxDhTskZXiJXWH25ialGeo";
const SHEETS = [
    { name: "sokujitsu", gid: "1824179107" },
    { name: "haken", gid: "841582142" }
];

function fetchCsv(gid) {
    return new Promise((resolve, reject) => {
        const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${gid}`;

        const get = (targetUrl) => {
            https.get(targetUrl, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    get(res.headers.location);
                    return;
                }
                if (res.statusCode !== 200) {
                    reject(new Error(`Failed to fetch gid ${gid}: ${res.statusCode}`));
                    return;
                }
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve(data));
            }).on('error', reject);
        };

        get(url);
    });
}

async function run() {
    for (const sheet of SHEETS) {
        console.log(`\n--- Checking Sheet: ${sheet.name} ---`);
        try {
            const csv = await fetchCsv(sheet.gid);
            const lines = csv.split(/\r?\n/).map(l => l.split(','));

            if (sheet.name === 'haken') {
                console.log("Haken Rows 1-5:");
                lines.slice(0, 5).forEach((r, i) => console.log(`Row ${i + 1}: ${r.slice(0, 10).join(',')}`));
            } else {
                console.log("Header (Row 2):", lines[1].slice(0, 10).join(','));
            }

            // Find Yanagi
            const yanagiRow = lines.find(row => row.some(cell => cell.includes("柳") && cell.includes("有綺")));

            if (yanagiRow) {
                console.log(`Found Yanagi in ${sheet.name}:`);
                console.log(yanagiRow.slice(0, 10).join(',')); // Print first few columns

                // Let's print the specific column for 2nd day (2/2)
                // Row 1 (index 1) has dates.
                const dateRow = lines[1];
                let colIdx = -1;
                dateRow.forEach((cell, idx) => {
                    const m = cell.trim().match(/^(\d+)日?$/);
                    if (m && m[1] === '2') colIdx = idx;
                });

                if (colIdx !== -1) {
                    console.log(`Value for 2/2 (Col ${colIdx}): "${yanagiRow[colIdx]}"`);
                    // Check next col if split
                    console.log(`Value next col: "${yanagiRow[colIdx + 1]}"`);
                } else {
                    console.log("Could not find column for 2/2");
                }
            } else {
                console.log(`Yanagi NOT found in ${sheet.name}`);
                // Print some names to verify
                console.log("Sample names:");
                lines.slice(3, 8).forEach(r => console.log(r[0]));
            }

        } catch (e) {
            console.error(e);
        }
    }
}

run();
