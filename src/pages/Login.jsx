// src/pages/Login.jsx
import React, { useState } from "react";

const LOGIN_API_URL =
  "https://cma9brof8g.execute-api.ap-northeast-1.amazonaws.com/prod/login";

// 文字列 → JSON を安全にパースするヘルパー
const safeJsonParse = (text) => {
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error("safeJsonParse error:", e, text);
    return null;
  }
};

export default function Login({ onLogin }) {
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage("");
    setLoading(true);

    try {
      const payload = { loginId, password };
      console.log("LOGIN payload:", payload);

      const res = await fetch(LOGIN_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const text = await res.text();
      console.log("LOGIN raw:", text);

      let statusCode = res.status;
      let data = null;

      // 1. outer をパース
      const outer = safeJsonParse(text);

      // 2. API Gateway 形式 { statusCode, body } の場合
      if (outer && typeof outer === "object" && "statusCode" in outer) {
        if (typeof outer.statusCode === "number") {
          statusCode = outer.statusCode;
        }

        if (outer.body) {
          if (typeof outer.body === "string") {
            data = safeJsonParse(outer.body);
          } else if (typeof outer.body === "object") {
            data = outer.body;
          } else {
            data = outer.body;
          }
        } else {
          data = outer;
        }
      } else {
        // 3. 普通の JSON の場合
        data = outer;
      }

      console.log("parsed statusCode:", statusCode);
      console.log("parsed data:", data);

      // data.user があればそれを、なければ data 自体を user とみなす
      let user = null;
      if (data && typeof data === "object") {
        if (data.user) {
          user = data.user;
        } else if (data.userId || data.loginId || data.name) {
          user = data;
        }
      }

      // user が取れなければログイン失敗扱い
      if (statusCode !== 200 || !user) {
        const msg =
          (data && data.message) || "ログインID またはパスワードが違います";
        setMessage(`❌ ${msg}`);
        setLoading(false);
        return;
      }

      // --- ここから保存処理 ---

      const userName =
        user.userName ||
        user.name ||
        `${user.lastName || ""}${user.firstName || ""}`.trim();

      // role を決定（user.role → data.role → loginId === "admin"）
      const role =
        (typeof user.role === "string" && user.role) ||
        (data && typeof data.role === "string" && data.role) ||
        (loginId === "admin" ? "admin" : "staff");

      // ユーザー情報を保存
      localStorage.setItem("userId", user.userId || "");
      localStorage.setItem("loginId", user.loginId || "");
      if (userName) localStorage.setItem("userName", userName);
      if (user.hourlyWage != null) {
        localStorage.setItem("hourlyWage", String(user.hourlyWage));
      }
      if (role) {
        localStorage.setItem("role", role);
      }
      // token はあれば保存、無ければ放置
      if (data && data.token) {
        localStorage.setItem("token", data.token);
      }

      // 雇用形態
      if (user.employmentType) {
        localStorage.setItem("employmentType", user.employmentType);
      } else {
        localStorage.removeItem("employmentType");
      }

      // ★★★ デフォルト勤務地・部署を保存 ★★★
      if (user.defaultLocation) {
        localStorage.setItem("defaultLocation", user.defaultLocation);
      }
      if (user.defaultDepartment) {
        localStorage.setItem("defaultDepartment", user.defaultDepartment);
      }

      // ログインフラグ
      localStorage.setItem("isLoggedIn", "true");

      setMessage("✅ ログインしました");
      setLoading(false);

      if (onLogin) {
        onLogin();
      }
    } catch (err) {
      console.error("LOGIN error:", err);
      setMessage("❌ 通信エラーが発生しました");
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: "#f5f7fa",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 400,
          padding: 32,
          borderRadius: 12,
          background: "#fff",
          boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
        }}
      >
        <h2 style={{ textAlign: "center", marginBottom: 8, fontSize: "1.5rem", color: "#1f2937" }}>勤怠管理システム</h2>

        <p style={{ textAlign: "center", marginBottom: 24, fontSize: "0.85rem", color: "#6b7280" }}>
          ※管理者は管理者用IDでログインしてください
        </p>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", marginBottom: 4, fontWeight: "500", fontSize: "0.9rem", color: "#374151" }}>
              ログインID
            </label>
            <input
              type="text"
              value={loginId}
              onChange={(e) => setLoginId(e.target.value)}
              required
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 6,
                border: "1px solid #d1d5db",
                fontSize: "1rem"
              }}
            />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ display: "block", marginBottom: 4, fontWeight: "500", fontSize: "0.9rem", color: "#374151" }}>
              パスワード（数字4桁）
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 6,
                border: "1px solid #d1d5db",
                fontSize: "1rem"
              }}
            />
            <p style={{ marginTop: 4, fontSize: "0.75rem", color: "#9ca3af" }}>
              （忘れた場合は井本までご連絡ください）
            </p>
          </div>

          {message && (
            <div
              style={{
                marginBottom: 16,
                padding: "8px 12px",
                borderRadius: 6,
                background: message.startsWith("✅") ? "#ecfdf5" : "#fef2f2",
                color: message.startsWith("✅") ? "#059669" : "#dc2626",
                fontSize: "0.9rem",
                textAlign: "center"
              }}
            >
              {message}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "12px",
              border: "none",
              borderRadius: 6,
              background: "#2563eb",
              color: "#fff",
              fontSize: "1rem",
              fontWeight: "600",
              cursor: "pointer",
              opacity: loading ? 0.7 : 1,
              transition: "background 0.2s"
            }}
          >
            {loading ? "ログイン中..." : "ログイン"}
          </button>
        </form>

        {/* スプレッドシートリンク */}
        <div style={{ marginTop: 20, textAlign: "center" }}>
          <a
            href="https://docs.google.com/spreadsheets/d/1Qg_uRrmKMhwRhfSGHfNq9bpeNGZJeFdyS0a0SHDKglE/edit?gid=0#gid=0"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 16px",
              borderRadius: 6,
              background: "#f0fdf4",
              border: "1px solid #bbf7d0",
              color: "#15803d",
              fontSize: "0.85rem",
              fontWeight: "500",
              textDecoration: "none",
              transition: "background 0.2s"
            }}
          >
            📊 シフト表（スプレッドシート）を開く
          </a>
        </div>
      </div>
    </div>
  );
}
