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
        maxWidth: 360,
        margin: "80px auto",
        padding: 24,
        border: "1px solid #ddd",
        borderRadius: 8,
        background: "#fff",
      }}
    >
      <h2 style={{ textAlign: "center", marginBottom: 16 }}>ログイン</h2>

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 12 }}>
          <label>
            ログインID
            <input
              type="text"
              value={loginId}
              onChange={(e) => setLoginId(e.target.value)}
              required
              style={{ width: "100%", padding: 8, marginTop: 4 }}
            />
          </label>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label>
            パスワード
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{ width: "100%", padding: 8, marginTop: 4 }}
            />
          </label>
        </div>

        {message && (
          <div
            style={{
              marginBottom: 12,
              color: message.startsWith("✅") ? "green" : "red",
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
            padding: 10,
            border: "none",
            borderRadius: 4,
            background: "#1976d2",
            color: "#fff",
            fontSize: 16,
            cursor: "pointer",
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? "ログイン中..." : "ログイン"}
        </button>
      </form>
    </div>
  );
}
