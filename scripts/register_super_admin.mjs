// super_admin ユーザー登録スクリプト
// ID: abo, PW: 9999, role: super_admin

const API_URL = "https://lfsu60xvw7.execute-api.ap-northeast-1.amazonaws.com/users";

async function registerSuperAdmin() {
    const payload = {
        userId: `super-admin-${Date.now()}`,
        loginId: "abo",
        lastName: "上位",
        firstName: "管理者",
        userName: "上位管理者",
        role: "super_admin",
        password: "9999",
        passwordDisplay: "9999",
        hourlyWage: 0,
        employmentType: "管理者",
        defaultLocation: "本社",
        defaultDepartment: "管理部",
    };

    console.log("Registering super_admin user...");
    console.log("loginId:", payload.loginId);
    console.log("role:", payload.role);

    const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });

    if (res.ok) {
        const data = await res.json();
        console.log("✅ super_admin registered successfully:", data);
    } else {
        const text = await res.text();
        console.error("❌ Failed:", res.status, text);
    }
}

registerSuperAdmin();
