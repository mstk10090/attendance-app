// src/pages/admin/AdminDashboard.jsx
import React from "react";

export default function AdminDashboard() {
  return (
    <div style={{ padding: "24px" }}>
      <h2>管理者ダッシュボード</h2>
      <p>以下の管理操作ができます。</p>

      <div style={{ marginTop: "24px" }}>
        <ul>
          <li>スタッフ管理（登録・編集）</li>
          <li>希望シフト一覧の確認</li>
          <li>確定シフト管理</li>
          <li>勤務区分・時給設定（必要であれば）</li>
        </ul>
      </div>
    </div>
  );
}
