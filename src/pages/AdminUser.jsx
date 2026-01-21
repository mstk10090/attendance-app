import React, { useState } from "react";
import { UserPlus, User, Lock, Briefcase, Calendar, DollarSign, Home, Save, CheckCircle, AlertTriangle } from "lucide-react";

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
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage("");
    setLoading(true);

    // いちおうフロント側でも必須チェック
    if (!loginId.trim() || !password.trim()) {
      setMessage("❌ loginId と password は必須です");
      setLoading(false);
      return;
    }

    // userId が空なら自動採番
    const trimmedUserId = userId.trim();
    const finalUserId =
      trimmedUserId !== ""
        ? trimmedUserId
        : `user-${new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14)}`;

    try {
      const payload = {
        loginId: loginId.trim(),
        password: password,
        userId: finalUserId,
        lastName: lastName.trim() || null,
        firstName: firstName.trim() || null,
        startDate: startDate || null,
        employmentType,
        livingAlone: livingAlone === "yes",
        hourlyWage: hourlyWage ? Number(hourlyWage) : null,
      };

      console.log("Admin user payload:", payload);

      const res = await fetch(API_USER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const text = await res.text();
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
        const msg = (data && data.message) || `エラーが発生しました (status ${statusCode})`;
        setMessage(`❌ ${msg}`);
        return;
      }

      setMessage(
        `✅ 保存しました (userId: ${(data && data.user && data.user.userId) || finalUserId
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
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-container" style={{ maxWidth: "800px", margin: "0 auto", paddingBottom: "80px" }}>

      {/* Header */}
      <div style={{ marginBottom: "24px", display: "flex", alignItems: "center", gap: "12px" }}>
        <div style={{ background: "#eff6ff", padding: "12px", borderRadius: "12px", color: "#2563eb" }}>
          <UserPlus size={32} />
        </div>
        <div>
          <h2 style={{ fontSize: "1.5rem", fontWeight: "bold", color: "#1f2937", margin: 0 }}>ユーザー登録・更新</h2>
          <p style={{ color: "#6b7280", margin: "4px 0 0 0" }}>新規スタッフのアカウント作成や情報更新を行います。</p>
        </div>
      </div>

      <div className="card" style={{ padding: "32px" }}>
        <form onSubmit={handleSubmit}>

          {/* Section: Account Info */}
          <div className="form-section">
            <h3 className="section-title"><Lock size={18} /> アカウント情報</h3>

            <div className="form-grid">
              <div className="form-group">
                <label>ログインID <span className="req">*</span></label>
                <input
                  type="text"
                  className="input"
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  required
                  placeholder="例: Aria"
                />
              </div>
              <div className="form-group">
                <label>パスワード （数字4桁）<span className="req">*</span></label>
                <input
                  type="password"
                  className="input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                />
              </div>
            </div>

            <div className="form-group" style={{ marginTop: "16px" }}>
              <label>ユーザーID (任意)</label>
              <input
                type="text"
                className="input"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder="未入力の場合は自動生成されます (例: user-2025...)"
              />
              <p className="hint">※ 既存ユーザーを更新する場合は、そのユーザーIDを入力してください。</p>
            </div>
          </div>

          <hr className="divider" />

          {/* Section: Personal Info */}
          <div className="form-section">
            <h3 className="section-title"><User size={18} /> 基本情報</h3>

            <div className="form-grid">
              <div className="form-group">
                <label>姓</label>
                <input
                  type="text"
                  className="input"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="山田"
                />
              </div>
              <div className="form-group">
                <label>名</label>
                <input
                  type="text"
                  className="input"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="太郎"
                />
              </div>
            </div>

            <div className="form-grid" style={{ marginTop: "16px" }}>
              <div className="form-group">
                <label><Calendar size={14} style={{ marginRight: 4 }} /> 勤務開始日</label>
                <input
                  type="date"
                  className="input"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label><Briefcase size={14} style={{ marginRight: 4 }} /> 雇用形態</label>
                <div className="select-wrapper">
                  <select
                    className="input"
                    value={employmentType}
                    onChange={(e) => setEmploymentType(e.target.value)}
                  >
                    <option value="派遣">派遣</option>
                    <option value="バイト">バイト</option>
                    <option value="正社員">正社員</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="form-group" style={{ marginTop: "16px" }}>
              <label><Home size={14} style={{ marginRight: 4 }} /> 住居状況</label>
              <div className="radio-group">
                <label className={`radio-card ${livingAlone === "yes" ? "selected" : ""}`}>
                  <input
                    type="radio"
                    name="living"
                    value="yes"
                    checked={livingAlone === "yes"}
                    onChange={(e) => setLivingAlone(e.target.value)}
                  />
                  <span>一人暮らし</span>
                </label>
                <label className={`radio-card ${livingAlone === "no" ? "selected" : ""}`}>
                  <input
                    type="radio"
                    name="living"
                    value="no"
                    checked={livingAlone === "no"}
                    onChange={(e) => setLivingAlone(e.target.value)}
                  />
                  <span>実家 / その他</span>
                </label>
              </div>
            </div>
          </div>

          <hr className="divider" />

          {/* Section: Salary */}
          <div className="form-section">
            <h3 className="section-title"><DollarSign size={18} /> 給与設定</h3>
            <div className="form-group">
              <label>時給</label>
              <div className="input-icon-wrapper">
                <input
                  type="number"
                  className="input"
                  min="0"
                  value={hourlyWage}
                  onChange={(e) => setHourlyWage(e.target.value)}
                  style={{ paddingLeft: "32px" }}
                />
                <span className="icon-prefix">¥</span>
              </div>
            </div>
          </div>

          <div style={{ marginTop: "32px" }}>
            <button
              type="submit"
              className="btn btn-blue btn-lg"
              disabled={loading}
              style={{ width: "100%", justifyContent: "center", gap: "8px" }}
            >
              {loading ? "送信中..." : <><Save size={20} /> 登録 / 更新する</>}
            </button>
          </div>

        </form>

        {message && (
          <div className={`message-box ${message.includes("✅") ? "success" : "error"}`}>
            {message.includes("✅") ? <CheckCircle size={20} /> : <AlertTriangle size={20} />}
            {message.replace("✅ ", "").replace("❌ ", "")}
          </div>
        )}
      </div>

      <style>{`
        .form-section { margin-bottom: 24px; }
        .section-title {
          font-size: 1.1rem;
          font-weight: bold;
          color: #374151;
          margin-bottom: 16px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .form-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }
        @media (max-width: 600px) {
          .form-grid { grid-template-columns: 1fr; }
        }
        .form-group { margin-bottom: 12px; }
        .form-group label {
          display: block;
          font-size: 0.9rem;
          font-weight: 500;
          color: #4b5563;
          margin-bottom: 6px;
          display: flex; align-items: center;
        }
        .req { color: #ef4444; margin-left: 4px; }
        .hint { font-size: 0.8rem; color: #9ca3af; margin-top: 4px; }
        .divider {
          border: 0;
          border-top: 1px solid #e5e7eb;
          margin: 24px 0;
        }
        
        /* Radio Cards */
        .radio-group { display: flex; gap: 12px; }
        .radio-card {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px;
          border: 1px solid #d1d5db;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s;
          background: #f9fafb;
        }
        .radio-card:hover { border-color: #9ca3af; }
        .radio-card.selected {
          border-color: #2563eb;
          background: #eff6ff;
          color: #1e40af;
          font-weight: 500;
        }
        .radio-card input { accent-color: #2563eb; }

        /* Input Icon Wrapper */
        .input-icon-wrapper { position: relative; }
        .icon-prefix {
          position: absolute;
          left: 12px;
          top: 50%;
          transform: translateY(-50%);
          color: #6b7280;
          font-weight: bold;
        }

        .btn-lg { padding: 14px; font-size: 1.1rem; }
        
        .message-box {
          margin-top: 24px;
          padding: 16px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          gap: 12px;
          font-weight: bold;
        }
        .message-box.success { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
        .message-box.error { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }

        /* Reusing global classes .card, .input, .btn from App.css effectively */
      `}</style>
    </div>
  );
}
