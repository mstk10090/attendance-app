// src/pages/MyPage.jsx
import React, { useEffect, useState } from "react";

const API_URL =
  "https://cma9brof8g.execute-api.ap-northeast-1.amazonaws.com/prod/shiftrequests";

export default function MyPage() {
  // API 呼び出しに使う内部用 ID（DynamoDB の PK）
  const userId = localStorage.getItem("userId") || "user-001";

  // 画面に表示するための情報
  const loginId = localStorage.getItem("loginId") || "-";
  const userName = localStorage.getItem("userName") || "-";
  const hourlyWage = Number(localStorage.getItem("hourlyWage") || 2200);

  const [totalHours, setTotalHours] = useState(0);
  const [estimatedSalary, setEstimatedSalary] = useState(0);
  const [loading, setLoading] = useState(true);

  // 合計勤務時間と概算給与を計算するためにシフト希望を取得
  useEffect(() => {
    const fetchShifts = async () => {
      try {
        const url = `${API_URL}?userId=${encodeURIComponent(userId)}`;
        console.log("MyPage shift fetch:", url);

        const res = await fetch(url);
        const text = await res.text();
        console.log("MyPage shift raw response:", text);

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

        console.log("MyPage shift parsed payload:", data);

        if (!data || !Array.isArray(data.items)) {
          setTotalHours(0);
          setEstimatedSalary(0);
          setLoading(false);
          return;
        }

        // 合計勤務時間を計算
        let sumHours = 0;
        for (const item of data.items) {
          if (!item.startTime || !item.endTime) continue;

          const [sh, sm] = item.startTime.split(":").map(Number);
          const [eh, em] = item.endTime.split(":").map(Number);
          const start = sh + sm / 60;
          const end = eh + em / 60;
          const diff = end - start;
          if (diff > 0) {
            sumHours += diff;
          }
        }

        setTotalHours(sumHours);
        setEstimatedSalary(sumHours * hourlyWage);
        setLoading(false);
      } catch (err) {
        console.error("MyPage shift fetch error:", err);
        setLoading(false);
      }
    };

    fetchShifts();
  }, [userId, hourlyWage]);

  if (loading) {
    return <div style={{ padding: "24px" }}>読み込み中...</div>;
  }

  return (
    <div style={{ maxWidth: "800px", margin: "24px auto" }}>
      {/* ユーザー情報 */}
      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: "8px",
          padding: "16px",
          marginBottom: "24px",
          background: "#fff",
        }}
      >
        <h2 style={{ marginBottom: "12px" }}>ユーザー情報</h2>
        <p>ログインID：{loginId}</p>
        <p>名前：{userName}</p>
        <p>現在の時給：{hourlyWage.toLocaleString()}円</p>
      </div>

      {/* 今月の概算給与 */}
      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: "8px",
          padding: "16px",
          background: "#fff",
        }}
      >
        <h2 style={{ marginBottom: "12px" }}>今月の概算給与</h2>
        <p>合計勤務時間：{totalHours.toFixed(1)} 時間</p>
        <p>概算給与：{estimatedSalary.toLocaleString()} 円</p>
        <p style={{ fontSize: "12px", color: "#666", marginTop: "8px" }}>
          ※希望シフトベースの概算です。実際の給与とは異なる場合があります。
        </p>
      </div>

      <div style={{ marginTop: "24px" }}>
        <button
          onClick={() => {
            // ログアウト（ローカルストレージ削除）
            localStorage.removeItem("isLoggedIn");
            localStorage.removeItem("userId");
            localStorage.removeItem("loginId");
            localStorage.removeItem("userName");
            localStorage.removeItem("hourlyWage");
            window.location.href = "/login";
          }}
          style={{
            padding: "8px 16px",
            borderRadius: "4px",
            border: "none",
            background: "#d32f2f",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          ログアウト
        </button>
      </div>
    </div>
  );
}
