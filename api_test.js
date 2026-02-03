
const API_BASE = "https://lfsu60xvw7.execute-api.ap-northeast-1.amazonaws.com";

async function testLfsu() {
    console.log("Testing LFSU Login...");
    try {
        const res = await fetch(`${API_BASE}/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ loginId: "admin", password: "0" }) // Dummy
        });
        console.log("LFSU Login Status:", res.status);
        console.log("LFSU Login Body:", await res.text());
    } catch (e) {
        console.log("LFSU Login Error:", e.message);
    }

    console.log("Testing LFSU User Write (Dry Run)...");
    try {
        const res = await fetch(`${API_BASE}/users`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ loginId: "test_sync", userId: "test_sync", lastName: "Test" })
        });
        console.log("LFSU Write Status:", res.status);
        console.log("LFSU Write Body:", await res.text());
    } catch (e) {
        console.log("LFSU Write Error:", e.message);
    }
}

testLfsu();
