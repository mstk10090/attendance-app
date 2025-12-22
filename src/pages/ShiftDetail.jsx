// src/pages/ShiftDetail.jsx
import React from "react";
import { useParams } from "react-router-dom";

export default function ShiftDetail() {
  const { date } = useParams(); // 例: "2025-11-03"

  return (
    <div>
      <h2>シフト詳細</h2>
      <p>{date} のシフト詳細ページです。</p>

      {/* あとでここに、その日のスタッフ一覧や人数を表示していく */}
    </div>
  );
}
