// src/pages/Login.jsx
import React, { useState } from "react";

const API_LOGIN_URL =
  "https://cma9brof8g.execute-api.ap-northeast-1.amazonaws.com/prod/login";

export default function Login({ onLogin }) {
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    try {
      const res = await fetch(API_LOGIN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          loginId,
          password,
        }),
      });

      // ① まず文字列として受け取る
      const text = await res.text();
      console.log("LOGIN raw response:", text);

      let outer = null;   // { statusCode, headers, body } など
      let data = null;    // 実際の { userId, userName, hourlyWage, message } など

      // ② 外側をパース
      try {
        outer = text ? JSON.parse(text) : null;
      } catch (e) {
        console.error("JSON parse error (outer):", e, text);
      }

      // ③ outer.body があればさらに中身をパース、なければ outer をそのまま使う
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

      console.log("LOGIN parsed payload:", data, "outer:", outer);

      // ④ 実際のステータスコードを決定
      const statusCode =
        outer && typeof outer.statusCode === "number"
          ? outer.statusCode
          : res.status;

      // 401 や 400 のときはここで終わり（onLogin は呼ばない）
      if (statusCode !== 200) {
        const message =
          (data && data.message) || "ログインID またはパスワードが違います";
        setError(message);
        return;
      }

      // ⑤ ここまで来たら成功扱い。userId が無いレスポンスは不正
      if (!data || !data.userId) {
        setError("サーバーからの応答が不正です");
        return;
      }

      // ユーザー情報を保存（マイページ用）
      localStorage.setItem("userId", data.userId);
      if (data.userName) {
        localStorage.setItem("userName", data.userName);
      }
      if (data.hourlyWage != null) {
        localStorage.setItem("hourlyWage", String(data.hourlyWage));
      }

      // ログイン状態フラグ（App.jsx で参照）
      localStorage.setItem("isLoggedIn", "true");

      // 親(App.jsx) に「ログイン成功」を通知
      onLogin();
    } catch (err) {
      console.error("Login error:", err);
      setError("通信エラーが発生しました");
    }
  };

  return (
    <div
      style={{
        maxWidth: "360px",
        margin: "80px auto",
        padding: "24px",
        border: "1px solid #ddd",
        borderRadius: "8px",
        background: "#fff",
      }}
    >
      <h2 style={{ textAlign: "center", marginBottom: "16px" }}>ログイン</h2>

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: "12px" }}>
          <label>
            ログインID
            <input
              type="text"
              value={loginId}
              onChange={(e) => setLoginId(e.target.value)}
              style={{ width: "100%", padding: "8px", marginTop: "4px" }}
              required
            />
          </label>
        </div>

        <div style={{ marginBottom: "12px" }}>
          <label>
            パスワード
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ width: "100%", padding: "8px", marginTop: "4px" }}
              required
            />
          </label>
        </div>

        {error && (
          <div style={{ color: "red", marginBottom: "12px" }}>{error}</div>
        )}

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
          ログイン
        </button>
      </form>
    </div>
  );
}
