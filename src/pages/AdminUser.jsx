// src/pages/AdminUser.jsx
import React, { useState } from "react";

// ★ /users の URL
const API_USER_URL =
  "https://cma9brof8g.execute-api.ap-northeast-1.amazonaws.com/prod/users";

export default function AdminUser() {
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [userId, setUserId] = useState(""); // 任意入力欄

  const [lastName, setLastName] = useState("");   // 姓
  const [firstName, setFirstName] = useState(""); // 名
  const [startDate, setStartDate] = useState(""); // 勤務開始日

  const [employmentType, setEmploymentType] = useState("派遣"); // 派遣 / バイト
  const [livingAlone, setLivingAlone] = useState("no");        // yes / no

  const [hourlyWage, setHourlyWage] = useState("2200");
  const [message, setMessage] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage("");

    // いちおうフロント側でも必須チェック
    if (!loginId.trim() || !password.trim()) {
      setMessage("❌ loginId と password は必須です");
      return;
    }

    // userId が空なら自動採番（例: user-20251122123456）
    const trimmedUserId = userId.trim();
    const finalUserId =
      trimmedUserId !== ""
        ? trimmedUserId
        : `user-${new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14)}`;

    try {
      const payload = {
        loginId: loginId.trim(),
        password: password, // パスワードはそのまま（ハッシュは Lambda 側）
        userId: finalUserId,
        lastName: lastName.trim() || null,
        firstName: firstName.trim() || null,
        startDate: startDate || null,
        employmentType, // "派遣" or "バイト"
        livingAlone: livingAlone === "yes", // true / false
        hourlyWage: hourlyWage ? Number(hourlyWage) : null,
      };

      console.log("Admin user payload:", payload);

      const res = await fetch(API_USER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const text = await res.text();
      console.log("Admin user response raw:", text);

      let outer = null;
      let data = null;

      try {
        outer = text ? JSON.parse(text) : null;
      } catch (e) {
        console.error("JSON parse error (outer):", e, text);
      }

      if (outer && typeof outer === "object" && outer.body) {
        try {
          data = JSON.parse(outer.body);
        } catch (e) {
          console.error("JSON parse error (body):", e, outer.body);
          data = null;
        }
      } else {
        data = outer;
      }

      const statusCode =
        outer && typeof outer.statusCode === "number"
          ? outer.statusCode
          : res.status;

      if (statusCode !== 200) {
        const msg =
          (data && data.message) || `エラーが発生しました (status ${statusCode})`;
        setMessage(`❌ ${msg}`);
        return;
      }

      setMessage(
        `✅ 保存しました (userId: ${
          (data && data.user && data.user.userId) || finalUserId
        })`
      );

      // 入力リセット
      setLoginId("");
      setPassword("");
      setUserId("");
      setLastName("");
      setFirstName("");
      setStartDate("");
      setEmploymentType("派遣");
      setLivingAlone("no");
      setHourlyWage("2200");
    } catch (err) {
      console.error("Admin user error:", err);
      setMessage("❌ 通信エラーが発生しました");
    }
  };

  return (
    <div style={{ maxWidth: "480px", margin: "40px auto" }}>
      <h2 style={{ marginBottom: "16px" }}>管理者用：ユーザー登録・更新</h2>
      <p style={{ marginBottom: "12px", color: "#555" }}>
        新規スタッフのログインID / パスワードや基本情報を登録する画面です。
      </p>

      <form onSubmit={handleSubmit}>
        {/* ログイン情報 */}
        <div style={{ marginBottom: "12px" }}>
          <label>
            ログインID（必須）
            <input
              type="text"
              value={loginId}
              onChange={(e) => setLoginId(e.target.value)}
              required
              style={{ width: "100%", padding: "8px", marginTop: "4px" }}
            />
          </label>
        </div>

        <div style={{ marginBottom: "12px" }}>
          <label>
            パスワード（必須）
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{ width: "100%", padding: "8px", marginTop: "4px" }}
            />
          </label>
        </div>

        <div style={{ marginBottom: "12px" }}>
          <label>
            userId（任意・未入力なら自動採番）
            <input
              type="text"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="例：user-001"
              style={{ width: "100%", padding: "8px", marginTop: "4px" }}
            />
          </label>
        </div>

        {/* 名前 */}
        <div
          style={{
            display: "flex",
            gap: "8px",
            marginBottom: "12px",
          }}
        >
          <div style={{ flex: 1 }}>
            <label>
              姓
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                style={{ width: "100%", padding: "8px", marginTop: "4px" }}
              />
            </label>
          </div>
          <div style={{ flex: 1 }}>
            <label>
              名
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                style={{ width: "100%", padding: "8px", marginTop: "4px" }}
              />
            </label>
          </div>
        </div>

        {/* 勤務開始日 */}
        <div style={{ marginBottom: "12px" }}>
          <label>
            勤務開始日
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              style={{ width: "100%", padding: "8px", marginTop: "4px" }}
            />
          </label>
        </div>

        {/* 区分・一人暮らし */}
        <div style={{ marginBottom: "12px" }}>
          <label>
            区分
            <select
              value={employmentType}
              onChange={(e) => setEmploymentType(e.target.value)}
              style={{
                width: "100%",
                padding: "8px",
                marginTop: "4px",
              }}
            >
              <option value="派遣">派遣</option>
              <option value="バイト">バイト</option>
            </select>
          </label>
        </div>

        <div style={{ marginBottom: "12px" }}>
          <label>一人暮らしかどうか</label>
          <div style={{ marginTop: "4px" }}>
            <label style={{ marginRight: "12px" }}>
              <input
                type="radio"
                value="yes"
                checked={livingAlone === "yes"}
                onChange={(e) => setLivingAlone(e.target.value)}
              />
              一人暮らし
            </label>
            <label>
              <input
                type="radio"
                value="no"
                checked={livingAlone === "no"}
                onChange={(e) => setLivingAlone(e.target.value)}
              />
              実家など
            </label>
          </div>
        </div>

        {/* 時給 */}
        <div style={{ marginBottom: "16px" }}>
          <label>
            時給（円）
            <input
              type="number"
              min="0"
              value={hourlyWage}
              onChange={(e) => setHourlyWage(e.target.value)}
              style={{ width: "100%", padding: "8px", marginTop: "4px" }}
            />
          </label>
        </div>

        <button
          type="submit"
          style={{
            width: "100%",
            padding: "10px",
            border: "none",
            borderRadius: "4px",
            background: "#1976d2",
            color: "#fff",
            fontSize: "16px",
            cursor: "pointer",
          }}
        >
          登録 / 更新
        </button>
      </form>

      {message && (
        <div style={{ marginTop: "12px", fontWeight: "bold" }}>{message}</div>
      )}
    </div>
  );
}
