// src/pages/MyPage.jsx
import React, { useEffect, useState } from "react";

const SHIFT_API_URL =
  "https://cma9brof8g.execute-api.ap-northeast-1.amazonaws.com/prod/shiftrequests";

export default function MyPage({ onLogout }) {
  const userId = localStorage.getItem("userId") || "-";
  const userName = localStorage.getItem("userName") || "-";
  const hourlyWage = Number(localStorage.getItem("hourlyWage") || 2200);

  const [totalHours, setTotalHours] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [fetchError, setFetchError] = useState("");

  // 時間計算用（"09:00" 〜 "17:30" → 8.5h）
  const calcHours = (startTime, endTime) => {
    if (!startTime || !endTime) return 0;

    const [sh, sm] = startTime.split(":").map(Number);
    const [eh, em] = endTime.split(":").map(Number);

    const startMinutes = sh * 60 + sm;
    const endMinutes = eh * 60 + em;

    if (isNaN(startMinutes) || isNaN(endMinutes)) return 0;
    if (endMinutes <= startMinutes) return 0; // 日またぎは今回は考慮しない

    return (endMinutes - startMinutes) / 60;
  };

  useEffect(() => {
    const fetchShiftSummary = async () => {
      if (!userId || userId === "-") return;

      setIsLoading(true);
      setFetchError("");

      try {
        const res = await fetch(
          `${SHIFT_API_URL}?userId=${encodeURIComponent(userId)}`
        );

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

        console.log("MyPage shift parsed payload:", data, "outer:", outer);

        if (!data || !Array.isArray(data.items)) {
          setFetchError("シフト情報の取得に失敗しました");
          setTotalHours(0);
          setIsLoading(false);
          return;
        }

        const now = new Date();
        const thisYear = now.getFullYear();
        const thisMonth = now.getMonth(); // 0=Jan

        let sumHours = 0;

        for (const item of data.items) {
          const dateStr = item.date; // "2025-11-16" 形式を想定
          const startTime = item.startTime;
          const endTime = item.endTime;

          if (!dateStr) continue;

          const d = new Date(dateStr);
          if (
            isNaN(d.getTime()) ||
            d.getFullYear() !== thisYear ||
            d.getMonth() !== thisMonth
          ) {
            continue; // 今月以外はスキップ
          }

          sumHours += calcHours(startTime, endTime);
        }

        setTotalHours(sumHours);
        setIsLoading(false);
      } catch (err) {
        console.error("MyPage shift fetch error:", err);
        setFetchError("シフト情報の取得中にエラーが発生しました");
        setTotalHours(0);
        setIsLoading(false);
      }
    };

    fetchShiftSummary();
  }, [userId]);

  const estimatedPay = Math.round(totalHours * hourlyWage);

  return (
    <div style={{ maxWidth: "480px", margin: "24px auto" }}>
      <h2>マイページ</h2>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: "8px",
          padding: "16px",
          marginBottom: "16px",
          background: "#fff",
        }}
      >
        <h3 style={{ marginTop: 0, marginBottom: "12px" }}>ユーザー情報</h3>
        <p>
          <strong>ユーザーID：</strong>
          {userName}
        </p>
        <p>
          <strong>名前：</strong>
          {userName}
        </p>
        <p>
          <strong>現在の時給：</strong>
          {hourlyWage.toLocaleString("ja-JP")}円
        </p>
      </div>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: "8px",
          padding: "16px",
          background: "#fff",
        }}
      >
        <h3 style={{ marginTop: 0, marginBottom: "12px" }}>今月の概算給与</h3>
        {isLoading ? (
          <p>シフト情報を集計中です…</p>
        ) : fetchError ? (
          <p style={{ color: "red" }}>{fetchError}</p>
        ) : (
          <>
            <p>
              <strong>合計勤務時間：</strong>
              {totalHours.toFixed(1)} 時間
            </p>
            <p>
              <strong>概算給与：</strong>
              {estimatedPay.toLocaleString("ja-JP")} 円
            </p>
            <p style={{ fontSize: "12px", color: "#666" }}>
              ※希望シフトベースの概算です。実際の給与とは異なる場合があります。
            </p>
          </>
        )}
      </div>

      <div style={{ marginTop: "24px" }}>
        <button
          onClick={onLogout}
          style={{
            padding: "8px 16px",
            background: "#d32f2f",
            color: "#fff",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          ログアウト
        </button>
      </div>
    </div>
  );
}
