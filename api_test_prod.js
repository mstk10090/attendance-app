
const API_BASE = "https://lfsu60xvw7.execute-api.ap-northeast-1.amazonaws.com/prod";

async function testLfsuProd() {
    console.log("Testing LFSU Prod Login...");
    try {
        const res = await fetch(`${API_BASE}/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ loginId: "admin", password: "0" })
        });
        console.log("LFSU Prod Login Status:", res.status);
        console.log("LFSU Prod Login Body:", await res.text());
    } catch (e) {
        console.log("LFSU Prod Login Error:", e.message);
    }

    console.log("Testing LFSU Prod User Write...");
    try {
        const res = await fetch(`${API_BASE}/users`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ loginId: "test_sync", userId: "test_sync_prod", lastName: "TestProd" })
        });
        console.log("LFSU Prod Write Status:", res.status);
        console.log("LFSU Prod Write Body:", await res.text());
    } catch (e) {
        console.log("LFSU Prod Write Error:", e.message);
    }
}

testLfsuProd();
