import React, { useEffect, useState, useMemo } from "react";
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addDays } from "date-fns";
import { ja } from "date-fns/locale";
import { Search, Filter, AlertTriangle, CheckCircle, Clock, MapPin, Download, Save, X, Briefcase } from "lucide-react";
import "../../App.css";

const API_BASE = "https://lfsu60xvw7.execute-api.ap-northeast-1.amazonaws.com";

const LOCATIONS = ["未記載", "呉羽", "山葉", "東洋", "細川", "出張"];
const DEPARTMENTS = ["未記載", "即日", "買取", "広告", "CEO", "アビエス"];

// --- Utilities ---

// Legacy Comment Parser
const parseComment = (raw) => {
  try {
    if (!raw) return { segments: [], text: "" };
    // すでにオブジェクトならそのまま返す
    if (typeof raw === "object") {
      if (Array.isArray(raw)) return { segments: raw, text: "" };
      return { segments: raw.segments || [], text: raw.text || "" };
    }
    const parsed = JSON.parse(raw);
    if (!parsed) return { segments: [], text: raw };

    if (Array.isArray(parsed)) {
      return { segments: parsed, text: "" };
    }
    if (typeof parsed === 'object') {
      // 過去互換
      const segs = Array.isArray(parsed.segments) ? parsed.segments : [];
      return {
        segments: segs,
        text: parsed.text || "",
        application: parsed.application || null
      };
    }
    return { segments: [], text: raw };
  } catch (e) {
    return { segments: [], text: raw || "" };
  }
};

const toMin = (t) => {
  if (!t) return 0;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

const minToTime = (min) => {
  const h = Math.floor(min / 60);
  const m = Math.floor(min % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

const calcBreakTime = (e) => {
  if (!e.breaks || e.breaks.length === 0) return 0;
  return e.breaks.reduce((acc, b) => {
    if (b.start && b.end) {
      return acc + (toMin(b.end) - toMin(b.start));
    }
    return acc;
  }, 0);
};

const calcWorkMin = (e) => {
  if (!e.clockIn || !e.clockOut) return 0;
  const total = toMin(e.clockOut) - toMin(e.clockIn);
  const brk = calcBreakTime(e);
  return Math.max(0, total - brk);
};

// 30分単位切り捨て
const calcRoundedWorkMin = (e) => {
  const raw = calcWorkMin(e);
  if (raw <= 0) return 0;
  return Math.floor(raw / 30) * 30;
};

// 深夜労働 (22:00 - 05:00) の判定（簡易実装: 22時以降を含むか）
const hasNightWork = (e) => {
  if (!e.clockIn || !e.clockOut) return false;
  const outMin = toMin(e.clockOut);
  // 22:00 = 1320分
  return outMin > 1320;
};

// 24時間超過 ("前回の出社から24時間経っても出勤中")
const isLongWork = (item) => {
  if (!item.clockIn || item.clockOut) return false;
  try {
    const start = new Date(`${item.workDate}T${item.clockIn}`);
    const now = new Date();
    const diff = now.getTime() - start.getTime();
    return diff > (24 * 60 * 60 * 1000);
  } catch (e) {
    return false;
  }
};

// --- Component ---

export default function AdminAttendance() {
  /* State */
  const [viewMode, setViewMode] = useState("daily"); // daily, weekly, monthly
  const [baseDate, setBaseDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);



  // Filter States
  const [filterName, setFilterName] = useState("");

  const [filterStatus, setFilterStatus] = useState("all"); // Default to all
  // Actually user said "User sees status". Admin "Checks".
  // Let's keep "all" but add "pending" to options.
  const [filterLocation, setFilterLocation] = useState("all");
  const [filterDepartment, setFilterDepartment] = useState("all");

  // Edit Modal State
  const [editingItem, setEditingItem] = useState(null);
  const [editReason, setEditReason] = useState("");
  const [editSegments, setEditSegments] = useState([]);
  const [editIn, setEditIn] = useState("");
  const [editOut, setEditOut] = useState("");
  const [editDuration, setEditDuration] = useState(0); // minutes

  /* Data Fetching */
  const fetchRange = useMemo(() => {
    const d = new Date(baseDate);
    if (viewMode === "daily") {
      return { start: baseDate, end: baseDate };
    } else if (viewMode === "weekly") {
      return {
        start: format(startOfWeek(d, { weekStartsOn: 1 }), "yyyy-MM-dd"),
        end: format(endOfWeek(d, { weekStartsOn: 1 }), "yyyy-MM-dd"),
      };
    } else if (viewMode === "weekly") {
      return {
        start: format(startOfWeek(d, { weekStartsOn: 1 }), "yyyy-MM-dd"),
        end: format(endOfWeek(d, { weekStartsOn: 1 }), "yyyy-MM-dd"),
      };
    } else {
      // Monthly
      return {
        start: format(startOfMonth(d), "yyyy-MM-dd"),
        end: format(endOfMonth(d), "yyyy-MM-dd"),
      };
    }
  }, [viewMode, baseDate]);

  const fetchAttendances = async () => {
    setLoading(true);
    try {
      // NOTE: 本来は範囲指定APIが欲しいが、現状あるか不明なため
      // daily以外の場合は、簡易的に「指定範囲の全日付」をループFetchするか
      // あるいはAPIが範囲対応しているか試行する必要があります。
      // ここでは、ユーザー要望を満たすため、仮に範囲指定パラメータを投げてみます。
      // もし非対応ならループ処理にフォールバックするロジックが必要です。
      // ★現実的な実装: 日次APIのみと仮定し、Promise.allで並列取得する (Weekly/Monthlyは重いが確実)

      const start = new Date(fetchRange.start);
      const end = new Date(fetchRange.end);
      const days = eachDayOfInterval({ start, end });

      // Chunking requests to avoid 503 Throttling
      const results = [];
      const CHUNK_SIZE = 5;
      for (let i = 0; i < days.length; i += CHUNK_SIZE) {
        const chunk = days.slice(i, i + CHUNK_SIZE);
        const chunkResults = await Promise.all(chunk.map(day =>
          fetch(`${API_BASE}/admin/attendance?date=${format(day, "yyyy-MM-dd")}`)
            .then(r => r.json())
            .then(d => (d.success ? d.items : []))
        ));
        results.push(...chunkResults);
        // Little delay just in case
        await new Promise(r => setTimeout(r, 100));
      }

      const allItems = results.flat();

      const uniqueItems = Array.from(new Map(allItems.map(item => [item.userId + item.workDate, item])).values());

      // データ加工: コメントから区間をパースして segments に統合
      const processedItems = uniqueItems.map(item => {
        const p = parseComment(item.comment);
        // DB上のsegmentsがあれば優先、なければパース結果を使う
        const segments = (item.segments && item.segments.length > 0) ? item.segments : p.segments;
        return {
          ...item,
          segments,
          _parsedHtmlComment: p.text,
          _application: p.application // { status, reason, originalIn... }
        };
      });

      // 日付順 > ユーザーID順 ソート
      processedItems.sort((a, b) => {
        if (a.workDate !== b.workDate) return a.workDate.localeCompare(b.workDate);
        return a.userId.localeCompare(b.userId);
      });

      setItems(processedItems);
    } catch (e) {
      console.error(e);
      alert("データの取得に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAttendances();
  }, [fetchRange]);

  /* Filtering Logic */
  const filteredItems = useMemo(() => {
    return items.filter(item => {
      // Name Search
      if (filterName && !item.userName.includes(filterName)) return false;

      // Location Check (checks main location OR segments)
      if (filterLocation !== "all") {
        const hasLoc =
          item.location === filterLocation ||
          (item.segments || []).some(s => s.location === filterLocation);
        if (!hasLoc) return false;
      }

      // Department Check
      if (filterDepartment !== "all") {
        const hasDept =
          item.department === filterDepartment ||
          (item.segments || []).some(s => s.department === filterDepartment);
        if (!hasDept) return false;
      }

      // Status Filters
      if (filterStatus === "incomplete") {
        // 出勤しているが退勤していない（かつ今日でない、または明らかに長時間経過）
        const isToday = item.workDate === format(new Date(), "yyyy-MM-dd");
        if (item.clockIn && !item.clockOut && !isToday) return true;
        if (!item.clockIn && !item.clockOut) return false; // 休みの扱いは別途
        return item.clockIn && !item.clockOut;
      }
      if (filterStatus === "error") {
        // 休憩 > 勤務時間、退勤 < 出勤 など
        if (item.clockIn && item.clockOut && toMin(item.clockIn) > toMin(item.clockOut)) return true;
        const work = calcWorkMin(item);
        if (item.clockIn && item.clockOut && work <= 0) return true;
        return false;
      }
      if (filterStatus === "night") {
        return hasNightWork(item);
      }
      if (filterStatus === "comment") {
        return !!item.comment;
      }
      if (filterStatus === "pending") {
        return item._application?.status === "pending";
      }

      return true;
    });
  }, [items, filterName, filterStatus, filterLocation, filterDepartment]);

  /* Summary Stats */
  const summary = useMemo(() => {
    let totalWorkMin = 0;
    let totalBreakMin = 0;
    const userStats = {}; // userId -> { count, dates }

    filteredItems.forEach(item => {
      if (item.clockIn && item.clockOut) {
        totalWorkMin += calcRoundedWorkMin(item); // Rounding applied
        totalBreakMin += calcBreakTime(item);

        if (!userStats[item.userId]) {
          userStats[item.userId] = { name: item.userName, count: 0, dates: new Set() };
        }
        userStats[item.userId].count += 1;
        userStats[item.userId].dates.add(item.workDate);
      }
    });

    return {
      totalHours: Math.floor(totalWorkMin / 60),
      totalBreakHours: Math.floor(totalBreakMin / 60),
      staffCount: Object.keys(userStats).length,
      userStats
    };
  }, [filteredItems, viewMode, fetchRange]);


  /* Edit Handling */
  const openEdit = (item) => {
    setEditingItem(item);
    setEditReason("");
    setEditSegments(item.segments ? JSON.parse(JSON.stringify(item.segments)) : []);
    setEditIn(item.clockIn || "");
    setEditOut(item.clockOut || "");

    // 実労働時間を初期セット (30分丸め)
    setEditDuration(calcRoundedWorkMin(item));
  };

  // 再計算: 出勤時間 or 実労働時間 が変わったら退勤時間を更新
  const recalcOut = (newIn, newDur) => {
    if (!newIn) return;
    const startMin = toMin(newIn);
    // 休憩時間は現在のitemから取得 (編集不可前提)
    const breakMin = editingItem ? calcBreakTime(editingItem) : 0;

    // 退勤 = 出勤 + 実働 + 休憩
    const endMin = startMin + newDur + breakMin;
    setEditOut(minToTime(endMin));
  };

  const handleEditInChange = (val) => {
    setEditIn(val);
    recalcOut(val, editDuration);
    // Sync First Segment
    if (editSegments.length > 0) {
      const n = [...editSegments];
      n[0].start = val;
      setEditSegments(n);
    }
  };

  const recalcDuration = (newIn, newOut) => {
    if (!newIn || !newOut) return;
    const s = toMin(newIn);
    const e = toMin(newOut);
    const b = editingItem ? calcBreakTime(editingItem) : 0;
    let d = e - s - b;
    setEditDuration(d < 0 ? 0 : d);
  };

  const handleEditOutChange = (val) => {
    setEditOut(val);
    recalcDuration(editIn, val);
  };

  const handleDurationChange = (val) => {
    const dur = Number(val);
    setEditDuration(dur);
    recalcOut(editIn, dur);
  };

  const handleSave = async () => {
    if (!editReason.trim()) {
      alert("修正理由を入力してください（必須）");
      return;
    }

    if (!window.confirm("編集内容を保存しますか？")) return;

    try {
      setLoading(true);

      const payload = {
        userId: editingItem.userId,
        workDate: editingItem.workDate,
        clockIn: editIn,
        clockOut: editOut,
        segments: editSegments,
        adminEditReason: editReason,
        comment: JSON.stringify({
          text: (editingItem.comment || "") + `\n[管理者修正]: ${editReason}`,
          segments: editSegments
        })
      };

      // update endpointを使用
      // 本来はadmin用の更新APIが必要
      await fetch(`${API_BASE}/attendance/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });


      // console.log("Saving...", payload);
      alert("保存しました（理由: " + editReason + "）");

      setEditingItem(null);
      fetchAttendances();
    } catch (e) {
      alert("保存に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (item) => {
    if (!window.confirm(`${item.userName}さんの申請を承認しますか？`)) return;

    setLoading(true);
    try {
      const p = parseComment(item.comment);
      // application.status = approved
      const newApp = { ...p.application, status: 'approved' };

      const finalComment = JSON.stringify({
        segments: p.segments,
        text: p.text,
        application: newApp
      });

      // Use update endpoint to just update status (and potentially times if not applied yet?)
      // Assuming "Apply" already updated the clockIn/Out times in the user side logic (which I did in AttendanceRecord).
      // So here we just verify/lock it by setting approved.

      // Wait, did User side logic update actual clockIn/Out? 
      // In my prev step for AttendanceRecord, I sent `clockIn: newIn` to the API.
      // So the times are ALREADY updated. The "Approval" is mostly a flag.

      await fetch(`${API_BASE}/attendance/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: item.userId,
          workDate: item.workDate,
          comment: finalComment
          // We don't change times here unless admin edits manually
        }),
      });

      alert("承認しました");
      fetchAttendances();
    } catch (e) {
      alert("処理に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  /* JSX */
  return (
    <div className="admin-container" style={{ paddingBottom: "100px" }}>
      {/* Header & Controls */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <h2 style={{ fontSize: "1.2rem", fontWeight: "bold", display: "flex", alignItems: "center", gap: "8px" }}>
            <Clock size={24} /> 勤怠管理ダッシュボード
          </h2>
          <div>
            <button className={`btn ${viewMode === "daily" ? "btn-blue" : "btn-gray"}`} onClick={() => setViewMode("daily")} style={{ padding: "6px 12px", fontSize: "14px" }}>日次</button>
            <button className={`btn ${viewMode === "weekly" ? "btn-blue" : "btn-gray"}`} onClick={() => setViewMode("weekly")} style={{ marginLeft: "4px", padding: "6px 12px", fontSize: "14px" }}>週次</button>
            <button className={`btn ${viewMode === "monthly" ? "btn-blue" : "btn-gray"}`} onClick={() => setViewMode("monthly")} style={{ marginLeft: "4px", padding: "6px 12px", fontSize: "14px" }}>月次</button>
          </div>
        </div>

        {/* Date Navigator */}
        <div style={{ display: "flex", gap: "16px", marginBottom: "16px", alignItems: "center" }}>
          <button className="icon-btn" onClick={() => {
            const d = new Date(baseDate);
            if (viewMode === "daily") setBaseDate(format(addDays(d, -1), "yyyy-MM-dd"));
            if (viewMode === "weekly") setBaseDate(format(addDays(d, -7), "yyyy-MM-dd"));
            if (viewMode === "monthly") setBaseDate(format(addDays(d, -30), "yyyy-MM-dd")); // 簡易
          }}>{"<"}</button>

          <span style={{ fontWeight: "bold", fontSize: "1.1rem" }}>
            {viewMode === "daily" && format(new Date(baseDate), "yyyy年M月d日 (E)", { locale: ja })}
            {viewMode !== "daily" && `${fetchRange.start} 〜 ${fetchRange.end}`}
          </span>

          <button className="icon-btn" onClick={() => {
            const d = new Date(baseDate);
            if (viewMode === "daily") setBaseDate(format(addDays(d, 1), "yyyy-MM-dd"));
            if (viewMode === "weekly") setBaseDate(format(addDays(d, 7), "yyyy-MM-dd"));
            if (viewMode === "monthly") setBaseDate(format(addDays(d, 30), "yyyy-MM-dd"));
          }}>{">"}</button>
        </div>

        {/* Filters */}
        <div className="filter-bar">
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <Search size={16} color="#6b7280" />
            <input
              type="text"
              placeholder="スタッフ名検索"
              className="input"
              value={filterName}
              onChange={e => setFilterName(e.target.value)}
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <Filter size={16} color="#6b7280" />
            <select className="input" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="all">全ステータス</option>
              <option value="pending">⏳ 承認待ち</option>
              <option value="incomplete">⚠️ 退勤未入力</option>
              <option value="error">❌ 時間異常</option>
              <option value="night">🌙 深夜勤務あり</option>
              <option value="comment">💬 コメントあり</option>
            </select>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <MapPin size={16} color="#6b7280" />
            <select className="input" value={filterLocation} onChange={e => setFilterLocation(e.target.value)}>
              <option value="all">全勤務地</option>
              {LOCATIONS.filter(l => l !== "未記載").map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <Briefcase size={16} color="#6b7280" />
            <select className="input" value={filterDepartment} onChange={e => setFilterDepartment(e.target.value)}>
              <option value="all">全部署</option>
              {DEPARTMENTS.filter(d => d !== "未記載").map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Currently Working (Daily Only) */}
      {viewMode === "daily" && (
        <div className="card" style={{ marginBottom: "24px", borderLeft: "4px solid #3b82f6" }}>
          <h3 style={{ fontSize: "1.1rem", fontWeight: "bold", marginBottom: "12px", display: "flex", alignItems: "center", gap: "8px" }}>
            <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#22c55e", boxShadow: "0 0 8px #22c55e" }}></div>
            現在出勤中 ({filteredItems.filter(i => i.clockIn && !i.clockOut).length}名)
          </h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
            {filteredItems.filter(i => i.clockIn && !i.clockOut).map(item => {
              const long = isLongWork(item);
              return (
                <div key={item.userId + item.workDate} style={{
                  padding: "12px",
                  borderRadius: "8px",
                  background: long ? "#fef2f2" : "#f0fdf4",
                  border: long ? "1px solid #ef4444" : "1px solid #bbf7d0",
                  minWidth: "200px"
                }}>
                  <div style={{ fontWeight: "bold", fontSize: "15px", marginBottom: "4px" }}>{item.userName}</div>
                  <div style={{ fontSize: "13px", color: "#555" }}>IN: {item.clockIn}</div>
                  {long && <div style={{ fontSize: "12px", color: "#dc2626", fontWeight: "bold", marginTop: "4px" }}>⚠️ 24時間経過</div>}
                </div>
              );
            })}
            {filteredItems.filter(i => i.clockIn && !i.clockOut).length === 0 && (
              <div style={{ color: "#aaa", fontSize: "14px" }}>出勤中のスタッフはいません</div>
            )}
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="summary-grid" style={{ marginBottom: "24px" }}>
        <div className="summary-card">
          <div className="summary-label">対象スタッフ</div>
          <div className="summary-value">{summary.staffCount} 名</div>
        </div>
        <div className="summary-card">
          <div className="summary-label">総実働時間</div>
          <div className="summary-value">{summary.totalHours} 時間</div>
        </div>
        <div className="summary-card">
          <div className="summary-label">総休憩時間</div>
          <div className="summary-value">{summary.totalBreakHours} 時間</div>
        </div>
      </div>

      {/* Main Table */}
      <div className="card">
        {loading ? (
          <div style={{ padding: "20px", textAlign: "center" }}>読み込み中...</div>
        ) : filteredItems.length === 0 ? (
          <div className="empty-text">該当するデータがありません</div>

        ) : viewMode === "monthly" ? (
          /* Calendar View */
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "1px", background: "#ddd", border: "1px solid #ddd" }}>
            {["月", "火", "水", "木", "金", "土", "日"].map(d => (
              <div key={d} style={{ background: "#f3f4f6", padding: "8px", textAlign: "center", fontWeight: "bold", fontSize: "14px" }}>{d}</div>
            ))}
            {(() => {
              const start = new Date(fetchRange.start);
              const end = new Date(fetchRange.end);
              // Adjust start to Monday
              const gridStart = startOfWeek(start, { weekStartsOn: 1 });
              const gridEnd = endOfWeek(end, { weekStartsOn: 1 });
              const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

              return days.map(d => {
                const dayStr = format(d, "yyyy-MM-dd");
                const dayItems = filteredItems.filter(i => i.workDate === dayStr);
                const isCurrentMonth = format(d, "yyyy-MM") === format(start, "yyyy-MM");

                // Status Checks
                const hasError = dayItems.some(i => {
                  const work = calcWorkMin(i);
                  return (i.clockIn && i.clockOut && work <= 0) || (i.clockIn && !i.clockOut && isLongWork(i));
                });
                const hasIncomplete = dayItems.some(i => i.clockIn && !i.clockOut);
                const hasNight = dayItems.some(i => hasNightWork(i));

                // Status Counts
                const pendingCount = dayItems.filter(i => i._application?.status === "pending").length;
                const approvedCount = dayItems.filter(i => i._application?.status === "approved").length;

                let bg = "#fff";
                if (!isCurrentMonth) bg = "#f9fafb";

                if (hasError) {
                  bg = "#fef2f2"; // Error (Red) - Priority 1
                } else if (pendingCount > 0) {
                  bg = "#fff7ed"; // Pending (Orange) - Priority 2
                } else if (approvedCount > 0 && !hasIncomplete) {
                  // Green if confirmed Approved and no incomplete/error
                  // Case: "Green if only approved exist" -> implies fully handled.
                  // If there are approved items and NO pending, NO error, NO incomplete -> Green
                  bg = "#f0fdf4";
                } else if (dayItems.length > 0 && !hasIncomplete) {
                  // Normal work day with no explicit application but valid? 
                  // Current logic was: if valid work exists, green.
                  bg = "#dcfce7";
                }

                return (
                  <div
                    key={dayStr}
                    onClick={() => { setBaseDate(dayStr); setViewMode("daily"); }}
                    style={{ background: bg, minHeight: "100px", padding: "8px", display: "flex", flexDirection: "column", cursor: "pointer", transition: "0.2s" }}
                    className="calendar-cell"
                  >
                    <div style={{ fontSize: "14px", fontWeight: "bold", color: !isCurrentMonth ? "#aaa" : "#333", marginBottom: "4px" }}>
                      {format(d, "d")}
                    </div>
                    {dayItems.length > 0 ? (
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: "12px", color: "#555", marginBottom: "4px" }}>{dayItems.length} 名出勤</div>
                        <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                          {hasError || hasIncomplete ? (
                            <span style={{ color: "#ef4444", fontWeight: "bold", fontSize: "12px" }}>⚠️ 異常</span>
                          ) : (
                            <CheckCircle size={16} color="#15803d" />
                          )}
                          {hasNight && <span style={{ fontSize: "10px", background: "#eff6ff", color: "#1d4ed8", padding: "2px 4px", borderRadius: "4px" }}>夜</span>}

                          {/* Counts Display */}
                          {pendingCount > 0 && (
                            <span style={{ fontSize: "10px", background: "#fff7ed", color: "#c2410c", padding: "1px 4px", borderRadius: "4px", border: "1px solid #fed7aa" }}>
                              待: {pendingCount}
                            </span>
                          )}
                          {approvedCount > 0 && (
                            <span style={{ fontSize: "10px", background: "#f0fdf4", color: "#15803d", padding: "1px 4px", borderRadius: "4px", border: "1px solid #bbf7d0" }}>
                              済: {approvedCount}
                            </span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: "12px", color: "#ccc" }}>-</div>
                    )}
                  </div>
                );
              });
            })()}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th style={{ padding: "12px", fontSize: "14px" }}>日付</th>
                  <th style={{ padding: "12px", fontSize: "14px" }}>氏名</th>
                  <th style={{ padding: "12px", fontSize: "14px" }}>状態</th>
                  <th style={{ padding: "12px", fontSize: "14px" }}>出勤</th>
                  <th style={{ padding: "12px", fontSize: "14px" }}>退勤</th>
                  <th style={{ padding: "12px", fontSize: "14px", minWidth: "150px" }}>区間 (移動)</th>
                  <th style={{ padding: "12px", fontSize: "14px" }}>実働</th>
                  <th style={{ padding: "12px", fontSize: "14px" }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map(item => {
                  const isToday = item.workDate === format(new Date(), "yyyy-MM-dd");
                  const workMin = calcWorkMin(item);
                  const roundedWorkMin = calcRoundedWorkMin(item);

                  // Status Logic
                  // Error: Invalid time or negative work
                  const isError = (item.clockIn && item.clockOut && workMin <= 0);

                  // Incomplete: Clocked in but no out AND NOT TODAY (Past unfinished)
                  const isIncomplete = (item.clockIn && !item.clockOut && !isToday);

                  // Working: Clocked in but no out AND TODAY
                  const isWorking = (item.clockIn && !item.clockOut && isToday);
                  const hasNight = hasNightWork(item);

                  const rowAppStatus = item._application?.status;
                  let rowClass = "";
                  if (isError || isIncomplete) rowClass = "row-red";
                  else if (rowAppStatus === "pending") rowClass = "row-orange";
                  else if (rowAppStatus === "approved") rowClass = "row-green";

                  return (
                    <tr key={item.userId + item.workDate} className={rowClass} style={{ background: (isError || isIncomplete) ? "#fef2f2" : (rowAppStatus === "pending" ? "#fff7ed" : (!rowAppStatus && item.clockIn && item.clockOut ? "#f9fafb" : undefined)) }}>
                      <td style={{ fontSize: "14px", color: "#374151", padding: "12px" }}>
                        {format(new Date(item.workDate), "MM/dd(E)", { locale: ja })}
                      </td>
                      <td style={{ fontWeight: "bold", fontSize: "15px", padding: "12px" }}>{item.userName}</td>
                      <td style={{ padding: "12px" }}>
                        <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                          {isIncomplete && <span className="status-badge red">未退勤</span>}
                          {isWorking && <span className="status-badge green">出勤中</span>}
                          {isError && <span className="status-badge red">異常</span>}
                          {hasNight && <span className="status-badge blue">深夜</span>}
                          {item._application?.status === "pending" && <span className="status-badge orange">承認待</span>}
                          {item._application?.status === "approved" && <span className="status-badge green">済</span>}
                          {!item._application?.status && item.clockIn && item.clockOut && !isError && <span className="status-badge gray">未申請</span>}
                          {/* 承認待ちの場合はコメント全文を表示、それ以外はメモバッジ */}
                          {item._application?.status === "pending" && item._parsedHtmlComment ? (
                            <div style={{ marginTop: "4px", fontSize: "11px", color: "#4b5563", background: "rgba(255,255,255,0.6)", padding: "2px 4px", borderRadius: "4px", whiteSpace: "pre-wrap" }}>
                              {item._parsedHtmlComment}
                            </div>
                          ) : (
                            item._parsedHtmlComment ? <span className="status-badge gray">メモ</span> : null
                          )}
                        </div>
                      </td>
                      <td style={{ fontSize: "14px", padding: "12px" }}>{item.clockIn || "-"}</td>
                      <td style={{ fontSize: "14px", padding: "12px" }}>{item.clockOut || "-"}</td>
                      <td style={{ fontSize: "14px", padding: "12px" }}>
                        {(item.segments || []).length > 0 ? (
                          (item.segments || []).map((s, i) => (
                            <div key={i} style={{ marginBottom: "2px" }}>
                              <span style={{ fontWeight: "bold", color: "#2563eb" }}>{s.location}</span>
                              <span style={{ fontSize: "0.85em", marginLeft: "4px", color: "#666" }}>
                                ({s.start || "??"}~{s.end || ""})
                              </span>
                            </div>
                          ))
                        ) : (
                          <span style={{ color: "#aaa" }}>-</span>
                        )}
                      </td>
                      <td style={{ fontWeight: "bold", fontSize: "15px", padding: "12px" }}>
                        {roundedWorkMin > 0 ? `${Math.floor(roundedWorkMin / 60)}h ${roundedWorkMin % 60}m` : "-"}
                      </td>
                      <td style={{ padding: "12px" }}>
                        <div style={{ display: "flex", gap: "8px" }}>
                          {/* 承認待ちのみ修正・承認ボタンを表示 */
                            item._application?.status === "pending" && (
                              <>
                                <button className="btn btn-gray" style={{ fontSize: "13px", padding: "6px 10px" }} onClick={() => openEdit(item)}>
                                  修正
                                </button>
                                {item.clockOut && (
                                  <button className="btn btn-green" style={{ fontSize: "13px", padding: "6px 10px", display: "flex", alignItems: "center", gap: "4px" }} onClick={() => handleApprove(item)}>
                                    <CheckCircle size={14} /> 承認
                                  </button>
                                )}
                              </>
                            )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit Modal */}
      {
        editingItem && (
          <div className="modal-overlay">
            <div className="modal" style={{ maxWidth: "600px", width: "90%" }}>
              <div className="modal-title">勤怠修正: {editingItem.userName} ({editingItem.workDate})</div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "16px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "12px", color: "#555" }}>出勤</label>
                  <input type="time" className="input" value={editIn} onChange={e => handleEditInChange(e.target.value)} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "12px", color: "#555" }}>退勤</label>
                  <input type="time" className="input" value={editOut} onChange={e => handleEditOutChange(e.target.value)} />
                </div>
                {/* Duration Select (Full Width or below) */}
                <div style={{ gridColumn: "1 / span 2" }}>
                  <label style={{ display: "block", fontSize: "12px", color: "#555" }}>実労働時間 (30分単位)</label>
                  <select className="input" value={editDuration} onChange={e => handleDurationChange(e.target.value)}>
                    <option value="">-- 手入力 --</option>
                    {Array.from({ length: 49 }).map((_, i) => {
                      const m = i * 30;
                      const h = m / 60;
                      return <option key={m} value={m}>{h.toFixed(1)}h</option>;
                    })}
                  </select>
                </div>
              </div>

              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", fontSize: "12px", color: "#555", marginBottom: "4px" }}>区間・移動履歴</label>
                <div style={{ background: "#f9fafb", padding: "8px", borderRadius: "8px" }}>
                  {editSegments.map((seg, idx) => (
                    <div key={idx} style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
                      <input type="time" className="input" style={{ width: "80px" }} value={seg.start} onChange={e => {
                        const n = [...editSegments];
                        n[idx].start = e.target.value;
                        setEditSegments(n);
                        // Sync First Segment with Clock In
                        if (idx === 0) {
                          setEditIn(e.target.value);
                          recalcOut(e.target.value, editDuration);
                        }
                      }} />
                      <select className="input" value={seg.location} onChange={e => {
                        const n = [...editSegments]; n[idx].location = e.target.value; setEditSegments(n);
                      }}>
                        {LOCATIONS.map(l => <option key={l}>{l}</option>)}
                      </select>
                      <button className="icon-btn" onClick={() => {
                        setEditSegments(editSegments.filter((_, i) => i !== idx));
                      }}><X size={14} /></button>
                    </div>
                  ))}
                  <button className="btn btn-gray" onClick={() => setEditSegments([...editSegments, { start: "", end: "", location: "未記載", department: "未記載" }])}>
                    + 区間追加
                  </button>
                </div>
              </div>

              <div style={{ marginBottom: "24px" }}>
                <label style={{ display: "block", fontSize: "12px", color: "#d32f2f", fontWeight: "bold", marginBottom: "4px" }}>修正理由 (必須)</label>
                <textarea
                  className="input"
                  rows={3}
                  style={{ width: "100%", borderColor: !editReason ? "#fca5a5" : "#e5e7eb" }}
                  value={editReason}
                  onChange={e => setEditReason(e.target.value)}
                  placeholder="例: 打刻忘れのため修正"
                />
              </div>

              <div className="modal-actions">
                <button className="modal-btn" onClick={() => setEditingItem(null)}>キャンセル</button>
                <button className="modal-btn modal-confirm-green" onClick={handleSave}>保存</button>
              </div>
            </div>
          </div>
        )
      }
    </div >
  );
}
