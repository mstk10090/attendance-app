import fs from 'fs';
import { fetchShiftData } from './src/utils/shiftParser.js';

// We need to mock localStorage to run fetchShiftData in Node.js
global.localStorage = {
    getItem: () => null,
    setItem: () => {}
};

async function main() {
    try {
        const shiftMap = await fetchShiftData(true);
        const names = Object.keys(shiftMap);
        const nakaKey = names.find(n => n.includes("中崎"));
        if (nakaKey) {
            console.log(`All shifts for ${nakaKey}:`);
            const userShifts = shiftMap[nakaKey];
            for (const dateStr of Object.keys(userShifts)) {
                if (dateStr.startsWith("prescribed_")) continue;
                if (userShifts[dateStr]?.isDispatch) {
                    console.log(`Found dispatch shift on ${dateStr}:`, userShifts[dateStr]);
                }
            }
        } else {
            console.log("Nakazaki not found in shiftMap.");
        }
    } catch (e) {
        console.error(e);
    }
}

main();
