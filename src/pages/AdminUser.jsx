import React, { useState, useEffect, useMemo } from "react";
import {
  UserPlus, User, Lock, Briefcase, Calendar, DollarSign, Home, Save,
  CheckCircle, AlertTriangle, Search, Edit2, ArrowLeft, RefreshCw, Filter, ArrowUpDown, Eye, EyeOff
} from "lucide-react";

const READ_USER_URL = "https://lfsu60xvw7.execute-api.ap-northeast-1.amazonaws.com/users";
const WRITE_USER_URL = "https://lfsu60xvw7.execute-api.ap-northeast-1.amazonaws.com/users";

import { LOCATIONS, DEPARTMENTS, EMPLOYMENT_TYPES } from "../constants";

export default function AdminUser() {
  const [mode, setMode] = useState("list");

  // List State
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [formData, setFormData] = useState({});

  // Filter/Sort State
  const [filterName, setFilterName] = useState("");
  const [filterDateSort, setFilterDateSort] = useState("asc"); // asc | desc
  const [filterEmpType, setFilterEmpType] = useState("all");
  const [filterDept, setFilterDept] = useState("all");
  const [filterLoc, setFilterLoc] = useState("all");

  // Form State
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [userId, setUserId] = useState("");
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [employmentType, setEmploymentType] = useState(EMPLOYMENT_TYPES[0]); // Default to first
  const [livingAlone, setLivingAlone] = useState("no");
  const [defaultLocation, setDefaultLocation] = useState("未記載");
  const [defaultDepartment, setDefaultDepartment] = useState("未記載");
  const [hourlyWage, setHourlyWage] = useState("2200");

  const [message, setMessage] = useState("");

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      const headers = {};

      // ✅ Add Authorization header if token exists
      if (token) headers["Authorization"] = token;

      const res = await fetch(READ_USER_URL, { headers });

      // ✅ Handle 403 Forbidden (Token expired/missing) safely
      if (res.status === 403) {
        setMessage("❌ 認証エラー: セッションが切れました。再ログインしてください。");
        setUsers([]); // Clear users list on error
        return; // Stop processing
      }

      if (!res.ok) throw new Error("Failed to fetch users");

      const text = await res.text();
      let data = null;
      try {
        const outer = JSON.parse(text);
        if (outer.body && typeof outer.body === "string") {
          data = JSON.parse(outer.body);
        } else {
          data = outer;
        }

        let list = [];
        if (Array.isArray(data)) list = data;
        else if (data && Array.isArray(data.items)) list = data.items;
        else if (data && Array.isArray(data.Items)) list = data.Items;
        else if (data && data.success && Array.isArray(data.items)) list = data.items;

        setUsers(list);
      } catch (e) {
        console.error("Parse error", e);
        setUsers([]);
      }
    } catch (e) {
      console.error(e);
      setMessage("❌ スタッフ情報の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  const filteredUsers = useMemo(() => {
    let result = [...users];

    // 1. Text Search
    if (filterName) {
      const lower = filterName.toLowerCase();
      result = result.filter(u => {
        const actualName = (u.lastName || u.firstName)
          ? `${u.lastName || ""} ${u.firstName || ""}`
          : "";
        const login = u.loginId || "";
        const uid = u.userId || "";
        return (
          actualName.toLowerCase().includes(lower) ||
          login.toLowerCase().includes(lower) ||
          uid.toLowerCase().includes(lower)
        );
      });
    }

    // 2. Filters
    if (filterEmpType && filterEmpType !== "all") {
      result = result.filter(u => (u.employmentType || "未設定") === filterEmpType);
    }
    if (filterDept && filterDept !== "all") {
      result = result.filter(u => (u.defaultDepartment || "未記載") === filterDept);
    }
    if (filterLoc && filterLoc !== "all") {
      result = result.filter(u => (u.defaultLocation || "未記載") === filterLoc);
    }

    // 3. Sort (Start Date)
    result.sort((a, b) => {
      const vA = a.startDate || "";
      const vB = b.startDate || "";

      if (filterDateSort === "asc") {
        if (vA === vB) return 0;
        if (!vA) return 1;
        if (!vB) return -1;
        return vA.localeCompare(vB);
      } else {
        if (vA === vB) return 0;
        if (!vA) return 1;
        if (!vB) return -1;
        return vB.localeCompare(vA);
      }
    });

    return result;
  }, [users, filterName, filterDateSort, filterEmpType, filterDept, filterLoc]);

  // Form Handlers
  const resetForm = () => {
    setLoginId("");
    setPassword("");
    setUserId("");
    setLastName("");
    setFirstName("");
    setStartDate("");
    setEmploymentType(EMPLOYMENT_TYPES[0]);
    setLivingAlone("no");
    setDefaultLocation("未記載");
    setDefaultDepartment("未記載");
    setHourlyWage("2200");
    setMessage("");
  };

  const handleCreateNew = () => {
    resetForm();
    setMode("create");
  };

  const handleEdit = (u) => {
    resetForm();
    setMode("edit");

    setUserId(u.userId || "");
    setLoginId(u.loginId || "");
    // Pre-fill password for display (per user request)
    setPassword(u.password || "");

    setLastName(u.lastName || "");
    setFirstName(u.firstName || "");
    setStartDate(u.startDate || "");
    // Ensure existing type is valid, or default
    setEmploymentType(u.employmentType || EMPLOYMENT_TYPES[0]);

    const isAlone = u.livingAlone === true || u.livingAlone === "true" || u.livingAlone === "yes";
    setLivingAlone(isAlone ? "yes" : "no");
    setDefaultLocation(u.defaultLocation || "未記載");
    setDefaultDepartment(u.defaultDepartment || "未記載");
    setHourlyWage(u.hourlyWage ? String(u.hourlyWage) : "2200");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage("");
    setLoading(true);

    if (!loginId.trim()) {
      setMessage("❌ loginId は必須です");
      setLoading(false);
      return;
    }

    // Duplicate Check (Only on Create)
    if (mode === "create" && users.some(u => u.loginId === loginId.trim())) {
      setMessage("❌ このログインIDは既に使用されています");
      setLoading(false);
      return;
    }

    // Password is only required in create mode
    if (mode === "create" && !password.trim()) {
      setMessage("❌ パスワードを入力してください");
      setLoading(false);
      return;
    }

    const trimmedUserId = userId.trim();
    const finalUserId =
      trimmedUserId !== ""
        ? trimmedUserId
        : `user-${new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14)}`;

    try {
      const payload = {
        loginId: loginId.trim(),
        userId: finalUserId,
        lastName: lastName.trim() || null,
        firstName: firstName.trim() || null,
        startDate: startDate || null,
        employmentType,
        livingAlone: livingAlone === "yes",
        hourlyWage: hourlyWage ? Number(hourlyWage) : null,
        defaultLocation: defaultLocation || "未記載",
        defaultDepartment: defaultDepartment || "未記載",
      };

      // Only include password if we are creating A NEW USER
      // OR if we are EDITING and a new password was entered
      if (mode === "create" || (mode === "edit" && password.trim())) {
        payload.password = password;
      }

      // Use WRITE_USER_URL for updates
      const token = localStorage.getItem("token");
      const headers = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = token;

      const res = await fetch(WRITE_USER_URL, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(payload),
      });

      const text = await res.text();
      let outer = null;
      try { outer = JSON.parse(text); } catch (e) { }

      const statusCode = (outer && outer.statusCode) || res.status;

      if (statusCode !== 200) {
        const msg = (outer && outer.body && JSON.parse(outer.body).message) || `エラーが発生しました (${statusCode})`;
        setMessage(`❌ ${msg}`);
        return;
      }

      setMessage(`✅ 保存しました (userId: ${finalUserId})`);
      fetchUsers();

    } catch (err) {
      console.error("Admin user error:", err);
      setMessage("❌ 通信エラーが発生しました");
    } finally {
      setLoading(false);
    }
  };

  /* --- Render List View --- */
  if (mode === "list") {
    return (
      <div className="admin-container" style={{ height: "100vh", display: "flex", flexDirection: "column", boxSizing: "border-box", paddingBottom: "20px" }}>

        {/* Header Section */}
        <div style={{ flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <h2 style={{ fontSize: "1.5rem", fontWeight: "bold", display: "flex", alignItems: "center", gap: "12px", color: "#1f2937" }}>
            <div style={{ background: "#e0f2fe", padding: "10px", borderRadius: "12px", color: "#0284c7" }}>
              <User size={28} />
            </div>
            スタッフ管理
          </h2>
          <div style={{ display: "flex", gap: "12px" }}>
            <button className="btn btn-outline" onClick={fetchUsers} disabled={loading} style={{ gap: "6px" }}>
              <RefreshCw size={18} className={loading ? "spin" : ""} /> リロード
            </button>
            <button className="btn btn-blue" onClick={handleCreateNew} style={{ gap: "6px", padding: "10px 20px" }}>
              <UserPlus size={18} /> 新規スタッフ登録
            </button>
          </div>
        </div>

        <div className="card" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", padding: 0 }}>

          {/* Error Message Display in List Mode */}
          {message && (
            <div style={{
              padding: "12px 16px",
              background: message.includes("❌") ? "#fef2f2" : "#ecfdf5",
              color: message.includes("❌") ? "#991b1b" : "#065f46",
              borderBottom: "1px solid",
              borderColor: message.includes("❌") ? "#fecaca" : "#a7f3d0",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontSize: "0.9rem",
              fontWeight: "bold"
            }}>
              {message.includes("❌") ? <AlertTriangle size={18} /> : <CheckCircle size={18} />}
              {message.replace("✅ ", "").replace("❌ ", "")}
            </div>
          )}

          {/* Controls Area (Search & Filters) - Fixed Top */}
          <div style={{ padding: "16px", borderBottom: "1px solid #f3f4f6", background: "#fff", flexShrink: 0 }}>

            {/* 1st Row: Search & Count */}
            <div style={{ display: "flex", gap: "12px", alignItems: "center", marginBottom: "12px" }}>
              <div style={{ position: "relative", width: "300px" }}>
                <Search size={16} style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: "#9ca3af" }} />
                <input
                  type="text"
                  className="input"
                  placeholder="氏名・ID..."
                  value={filterName}
                  onChange={e => setFilterName(e.target.value)}
                  style={{
                    paddingLeft: "34px",
                    width: "100%",
                    height: "36px",
                    fontSize: "14px",
                    border: "1px solid #e5e7eb",
                    borderRadius: "6px"
                  }}
                />
              </div>
              <div style={{ fontSize: "0.85rem", color: "#6b7280", fontWeight: "500", marginLeft: "auto" }}>
                全 {filteredUsers.length} 名
              </div>
            </div>

            {/* 2nd Row: Filters & Sort */}
            <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>

              {/* Sort Button */}
              <button
                className="btn btn-outline"
                onClick={() => setFilterDateSort(prev => prev === "asc" ? "desc" : "asc")}
                style={{ height: "36px", padding: "0 12px", fontSize: "0.85rem", gap: "6px" }}
              >
                <ArrowUpDown size={14} />
                入社日: {filterDateSort === "asc" ? "古い順" : "新しい順"}
              </button>

              <div style={{ width: "1px", height: "24px", background: "#e5e7eb", margin: "0 4px" }} />

              {/* Filters */}
              <select
                className="input"
                value={filterEmpType}
                onChange={e => setFilterEmpType(e.target.value)}
                style={{ height: "36px", width: "110px", fontSize: "0.85rem", padding: "0 8px" }}
              >
                <option value="all">全ての形態</option>
                {EMPLOYMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>

              <select
                className="input"
                value={filterDept}
                onChange={e => setFilterDept(e.target.value)}
                style={{ height: "36px", width: "110px", fontSize: "0.85rem", padding: "0 8px" }}
              >
                <option value="all">全ての部署</option>
                {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>

              <select
                className="input"
                value={filterLoc}
                onChange={e => setFilterLoc(e.target.value)}
                style={{ height: "36px", width: "110px", fontSize: "0.85rem", padding: "0 8px" }}
              >
                <option value="all">全ての勤務地</option>
                {LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
              </select>

              {(filterEmpType !== "all" || filterDept !== "all" || filterLoc !== "all") && (
                <button
                  onClick={() => { setFilterEmpType("all"); setFilterDept("all"); setFilterLoc("all"); }}
                  style={{ fontSize: "0.8rem", color: "#ef4444", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
                >
                  クリア
                </button>
              )}
            </div>

          </div>

          {/* Table Container - Scrollable */}
          <div className="table-wrap" style={{ flex: 1, overflowY: "auto", position: "relative" }}>
            {loading ? (
              <div style={{ textAlign: "center", padding: "60px", color: "#6b7280" }}>
                <div className="spin" style={{ display: "inline-block", marginBottom: "8px" }}><RefreshCw size={24} /></div>
                <div>データを読み込み中...</div>
              </div>
            ) : (
              <table className="admin-table" style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
                <thead style={{ position: "sticky", top: 0, zIndex: 10, background: "#f9fafb" }}>
                  <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                    <th onClick={() => fetchUsers()} style={{ cursor: "pointer", padding: "12px 16px", textAlign: "left", fontSize: "0.85rem", color: "#6b7280", fontWeight: "600", borderBottom: "1px solid #e5e7eb" }}>氏名 / ID</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "0.85rem", color: "#6b7280", fontWeight: "600", borderBottom: "1px solid #e5e7eb" }}>入社日</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "0.85rem", color: "#6b7280", fontWeight: "600", borderBottom: "1px solid #e5e7eb" }}>雇用形態</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "0.85rem", color: "#6b7280", fontWeight: "600", borderBottom: "1px solid #e5e7eb" }}>部署 / 勤務地</th>
                    <th style={{ padding: "12px 16px", textAlign: "right", fontSize: "0.85rem", color: "#6b7280", fontWeight: "600", borderBottom: "1px solid #e5e7eb" }}>アクション</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.length === 0 ? (
                    <tr><td colSpan="5" style={{ textAlign: "center", padding: "40px", color: "#9ca3af" }}>条件に一致するスタッフが見つかりません</td></tr>
                  ) : (
                    filteredUsers.map(u => {
                      // Display logic
                      const hasName = u.lastName || u.firstName;
                      const displayName = hasName
                        ? `${u.lastName || ""} ${u.firstName || ""}`.trim()
                        : "(氏名未登録)";

                      // Location/Dept logic
                      const dept = (!u.defaultDepartment || u.defaultDepartment === "未記載") ? "" : u.defaultDepartment;
                      const loc = (!u.defaultLocation || u.defaultLocation === "未記載") ? "" : u.defaultLocation;
                      const locStr = [dept, loc].filter(Boolean).join(" / ") || "-";

                      return (
                        <tr key={u.userId} className="hover-row" style={{ borderBottom: "1px solid #f3f4f6" }}>
                          {/* Name Column */}
                          <td style={{ padding: "12px 16px", background: "#fff" }}>
                            <div style={{ fontWeight: hasName ? "bold" : "normal", color: hasName ? "#111827" : "#9ca3af", fontSize: "0.95rem" }}>
                              {displayName}
                            </div>
                            <div style={{ fontSize: "0.75rem", color: "#9ca3af", marginTop: "2px" }}>
                              {u.loginId} <span style={{ opacity: 0.6 }}>({u.userId})</span>
                            </div>
                          </td>

                          {/* Start Date Column */}
                          <td style={{ padding: "12px 16px", color: "#4b5563", fontSize: "0.9rem", background: "#fff" }}>
                            {u.startDate || "-"}
                          </td>

                          {/* Type Column */}
                          <td style={{ padding: "12px 16px", background: "#fff" }}>
                            <span className={`status-badge ${u.employmentType === "派遣" ? "blue" : "orange"}`} style={{ padding: "2px 10px", borderRadius: "20px", fontSize: "0.8rem" }}>
                              {u.employmentType || "未設定"}
                            </span>
                          </td>

                          {/* Location Column */}
                          <td style={{ padding: "12px 16px", color: "#4b5563", fontSize: "0.9rem", background: "#fff" }}>
                            {locStr}
                          </td>

                          {/* Action Column */}
                          <td style={{ padding: "12px 16px", textAlign: "right", background: "#fff" }}>
                            <button className="btn btn-gray" style={{ padding: "6px 14px", fontSize: "0.85rem" }} onClick={() => handleEdit(u)}>
                              <Edit2 size={14} style={{ marginRight: "6px" }} /> 編集
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
        <style>{`
          .spin { animation: spin 1s linear infinite; }
          @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
          .hover-row:hover { background: #fdfdfd; }
          .hover-row:hover td { background: #fdfdfd !important; } 
          .btn-outline { background: #fff; border: 1px solid #d1d5db; color: #374151; padding: 10px 16px; border-radius: 8px; font-weight: 500; cursor: pointer; display: flex; align-items: center; transition: all 0.2s; }
          .btn-outline:hover { background: #f9fafb; border-color: #9ca3af; }
        `}</style>
      </div>
    );
  }

  /* --- Render Form View (Create/Edit) --- */
  return (
    <div className="admin-container" style={{ maxWidth: "800px", margin: "0 auto", paddingBottom: "80px" }}>
      {/* Header */}
      <div style={{ marginBottom: "24px", display: "flex", alignItems: "center", gap: "12px" }}>
        <button className="icon-btn" onClick={() => setMode("list")} style={{ marginRight: "8px" }}>
          <ArrowLeft size={24} />
        </button>
        <div style={{ background: "#eff6ff", padding: "12px", borderRadius: "12px", color: "#2563eb" }}>
          <UserPlus size={32} />
        </div>
        <div>
          <h2 style={{ fontSize: "1.5rem", fontWeight: "bold", color: "#1f2937", margin: 0 }}>
            {mode === "create" ? "スタッフ新規登録" : "スタッフ情報更新"}
          </h2>
          <p style={{ color: "#6b7280", margin: "4px 0 0 0" }}>
            {mode === "create" ? "新しいスタッフアカウントを作成します" : "登録済みスタッフの情報を編集します"}
          </p>
        </div>
      </div>

      <div className="card" style={{ padding: "32px" }}>
        <form onSubmit={handleSubmit}>

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

              {/* Password Field: Required for Create, ReadOnly for Edit */}
              <div className="form-group">
                <label>
                  パスワード
                  {mode === "create" && <span className="req">*</span>}
                </label>
                <div className="input-icon-wrapper">
                  <input
                    type={showPassword ? "text" : "password"}
                    className="input"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required={mode === "create"}
                    readOnly={mode === "edit"}
                    placeholder={mode === "create" ? "パスワードを入力" : ""}
                    style={{
                      paddingRight: "40px",
                      background: mode === "edit" ? "#f3f4f6" : "#fff",
                      color: mode === "edit" ? "#888" : "inherit"
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{
                      position: "absolute",
                      right: "10px",
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "#6b7280"
                    }}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {mode === "create" ? (
                  <p className="hint">※ 初期パスワードを設定してください</p>
                ) : (
                  <p className="hint">※ パスワードは変更できません（表示のみ）</p>
                )}
              </div>

              <input
                type="text"
                className="input"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                readOnly={mode === "edit"}
                style={{ background: mode === "edit" ? "#f3f4f6" : "#fff", color: mode === "edit" ? "#888" : "inherit" }}
                placeholder="未入力の場合は自動生成されます"
              />
              {mode === "edit" && <p className="hint">※ ユーザーIDは変更できません</p>}
            </div>
          </div>

          <hr className="divider" />

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
                    {EMPLOYMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
            </div>

            <div className="form-grid" style={{ marginTop: "16px" }}>
              <div className="form-group">
                <label>デフォルト勤務地</label>
                <select
                  className="input"
                  value={defaultLocation}
                  onChange={(e) => setDefaultLocation(e.target.value)}
                >
                  {LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>デフォルト部署</label>
                <select
                  className="input"
                  value={defaultDepartment}
                  onChange={(e) => setDefaultDepartment(e.target.value)}
                >
                  {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
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
            <h3 className="section-title"><DollarSign size={18} /> 給与設定(任意)</h3>
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
              {loading ? "送信中..." : <><Save size={20} /> 保存する</>}
            </button>
            <button
              type="button"
              className="btn btn-gray"
              onClick={() => setMode("list")}
              style={{ width: "100%", marginTop: "8px", justifyContent: "center" }}
            >
              キャンセル
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
          display: flex;
          align-items: center;
        }
        .req { color: #ef4444; margin-left: 4px; }
        .hint { font-size: 0.8rem; color: #9ca3af; margin-top: 4px; }
        .divider {
          border: 0;
          border-top: 1px solid #e5e7eb;
          margin: 24px 0;
        }
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
      `}</style>
    </div>
  );
}
