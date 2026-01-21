import React, { useEffect, useState } from "react";
import {
  Clock,
  LogIn,
  LogOut,
  Coffee,
  Pencil,
  Plus,
  Trash2,
  Briefcase,
  Info,
} from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSaturday, isSunday } from "date-fns";
import { ja } from "date-fns/locale";
import { HOLIDAYS } from "../constants";
import "../App.css";

const isHoliday = (d) => {
  const s = format(d, "yyyy-MM-dd");
  return HOLIDAYS.includes(s);
};

const isWeekendOrHoliday = (d) => {
  return isSaturday(d) || isSunday(d) || isHoliday(d);
};

const API_BASE =
  "https://lfsu60xvw7.execute-api.ap-northeast-1.amazonaws.com";

const LOCATIONS = ["未記載", "呉羽", "山葉", "東洋", "細川", "出張"];
const DEPARTMENTS = ["未記載", "即日", "買取", "広告", "CEO", "アビエス"];

// 15分刻みの時刻オプション (00:00 - 23:45)
const TIME_OPTIONS = [];
for (let h = 0; h < 24; h++) {
  for (let m = 0; m < 60; m += 15) {
    const hh = String(h).padStart(2, "0");
    const mm = String(m).padStart(2, "0");
    TIME_OPTIONS.push(`${hh}:${mm}`);
  }
}

export default function AttendanceRecord() {
  /* =========================
     State
  ========================= */
  const [userId, setUserId] = useState(null);
  const [attendances, setAttendances] = useState([]);
  const [currentClockIn, setCurrentClockIn] = useState(null);
  const [isOnBreak, setIsOnBreak] = useState(false);

  // 区間(Segment)用
  const [isSegmentActive, setIsSegmentActive] = useState(false);
  const [currentSegment, setCurrentSegment] = useState(null);

  const [modalType, setModalType] = useState(null);
  const [loading, setLoading] = useState(false);

  // 編集
  const [editingDate, setEditingDate] = useState(null);
  const [comment, setComment] = useState("");
  const [location, setLocation] = useState("未記載");
  const [department, setDepartment] = useState("未記載");
  const [segments, setSegments] = useState([]); // 区間データ
  const [editDate, setEditDate] = useState(""); // 出張申請用日付
  const [editIn, setEditIn] = useState(""); // 編集用
  const [editOut, setEditOut] = useState(""); // 編集用
  const [reason, setReason] = useState(""); // 勤怠乖離理由

  /* =========================
     userId
  ========================= */
  useEffect(() => {
    setUserId(localStorage.getItem("userId"));
  }, []);

  // コメントパース関数
  const parseComment = (raw) => {
    try {
      if (!raw) return { segments: [], text: "" };
      const parsed = JSON.parse(raw);
      if (!parsed) return { segments: [], text: raw };

      // 配列なら区間データのみとみなす（後方互換でテキストはなし）
      if (Array.isArray(parsed)) {
        return { segments: parsed, text: "" };
      }
      // オブジェクト形式 { segments, text, application } ならそれを返す
      if (typeof parsed === 'object') {
        // 過去互換: segmentsが配列ならそれを使う
        const segs = Array.isArray(parsed.segments) ? parsed.segments : [];
        return {
          segments: segs,
          text: parsed.text || "",
          application: parsed.application || null // { status: 'pending'|'approved', ... }
        };
      }
      return { segments: [], text: raw, application: null };
    } catch (e) {
      return { segments: [], text: raw || "" };
    }
  };

  /* =========================
     勤怠ロード
  ========================= */
  const loadAttendances = async (uid) => {
    const res = await fetch(`${API_BASE}/attendance?userId=${uid}`);
    const data = await res.json();
    if (!data.success) return;

    setAttendances(data.items);

    const today = format(new Date(), "yyyy-MM-dd");
    const todayRecord = data.items.find(
      (a) => a.workDate === today
    );

    if (todayRecord?.clockIn && !todayRecord.clockOut) {
      setCurrentClockIn(todayRecord.clockIn);
      const lastBreak =
        todayRecord.breaks?.[todayRecord.breaks.length - 1];
      setIsOnBreak(!!(lastBreak && !lastBreak.end));

      // 区間チェック
      const lastSeg = todayRecord.segments?.[todayRecord.segments.length - 1];
      if (lastSeg && !lastSeg.end) {
        setIsSegmentActive(true);
        setCurrentSegment(lastSeg);
      } else {
        setIsSegmentActive(false);
        setCurrentSegment(null);
      }
    } else {
      setCurrentClockIn(null);
      setIsOnBreak(false);
      setIsSegmentActive(false);
      setCurrentSegment(null);
    }
  };

  // ユーザー属性
  const isDispatch = localStorage.getItem("employmentType") === "派遣";

  useEffect(() => {
    if (userId) loadAttendances(userId);
  }, [userId]);

  /* =========================
     共通 POST
  ========================= */
  const post = async (path, body = {}) => {
    setLoading(true);
    await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, ...body }),
    });
    await loadAttendances(userId);
    setModalType(null);
    setLoading(false);
  };



  /* =========================
     出張申請
  ========================= */
  const handleBusinessTripApply = async () => {
    if (!editIn || !editOut || !comment.trim()) {
      alert("日付、時間、理由は必須です");
      return;
    }

    const tripSegments = [{
      start: editIn,
      end: editOut,
      location: "出張",
      department: department
    }];

    const finalComment = JSON.stringify({
      segments: tripSegments,
      text: comment,
      application: { type: "business_trip", status: "pending" }
    });

    setLoading(true);
    await fetch(`${API_BASE}/attendance/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        workDate: editDate,
        clockIn: editIn,
        clockOut: editOut,
        // originalIn, originalOut はAPI側で不要/未対応のため削除
        comment: finalComment,
        location: "出張",
        department: department
      }),
    });

    await loadAttendances(userId);
    setModalType(null);
    setLoading(false);
  };

  /* =========================
     勤務メモ保存 / 申請
  ========================= */
  const saveDetail = async (workDate, isApplication = false) => {
    setLoading(true);

    // 乖離チェック (申請時)
    if (isApplication) {
      // バリデーション: 本来の出勤時間と15分以上乖離があるか？
      // 今回は「修正後の時間」を「本来の時間」として申請するフローと仮定
      // あるいは、DB上の打刻(original)と、手入力(segments/editIn/editOut)の比較？
      // User Request: "本来の出勤時間...を入力して申請" 
      // "本来が9時出勤の場合(入力値)、9時出社(打刻値)でもアウト..." -> This wording is tricky.
      // "本来が9時出勤(scheduled/contracted?)の場合、9時出社(actual?)でもアウト" 
      // -> usually means "If you clocked in at 9:00 but you say 'I actually started at 8:45', that's a diff".
      // Let's assume: Compare `Current DB ClockIn` vs `Input ClockIn`.

      // しかし、編集フォームの状態変数は `comment`, `segments` のみで `clockIn/Out` は直接編集できないUIになっている(現状)。
      // 現状のUI: Pencilボタン -> Comment/Segments編集のみ。
      // User Request also implies Input of "Original Clock In Time".
      // Current UI doesn't have ClockIn/Out inputs in the inline edit. 
      // I should probably add them to the edit form or assume Segments Start is the ClockIn?
      // Let's look at render: It just renders `e.clockIn`. 
      // Wait, I need to allow editing ClockIn/Out in the form for this to work.
      // The current inline edit only has Location/Department/Segments/Comment.
      // FIX: I will add Time Inputs to the inline edit form.
    }


    // 区間データがある場合はJSON化してcommentに保存
    let finalComment = comment;
    let finalLocation = location;
    let finalDepartment = department;

    if (segments.length > 0) {
      // 便宜上、最初の区間の情報を代表として保存しておく（一覧表示の互換性のため）
      finalLocation = segments[0].location || "未記載";
      finalDepartment = segments[0].department || "未記載";

      // JSON化 { segments: [...], text: "..." }
      finalComment = JSON.stringify({
        segments: segments.map((s) => ({
          start: s.start || "",
          end: s.end || "",
          location: s.location || "未記載",
          department: s.department || "未記載"
        })),
        text: comment
      });
    }

    await fetch(`${API_BASE}/attendance/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        workDate,
        comment: finalComment,
        location: finalLocation,
        department: finalDepartment,
      }),
    });
    await loadAttendances(userId);
    setEditingDate(null);
    setSegments([]); // リセット
    setLoading(false);
    // 既存のレコードを取得して、ClockIn/Out編集用Stateがあればそれを使う
    // 今回は簡易的に、inline edit formにstateを追加していないため、
    // 実装簡略化のため「コメント・区間」の保存 + 「申請ステータス」の更新を行う方針とします。
    // ※時間が変更できないと要件(乖離理由)が満たせないため、
    //  下記の `saveApplication` 関数を別途作成してUIも更新します。
    //  (saveDetail は既存の互換性維持のため残しつつリファクタ)

    // --- Refactored below in separate replacement ---
    setLoading(false);
  };

  const calcMinDiff = (time1, time2) => {
    if (!time1 || !time2) return 0;
    const [h1, m1] = time1.split(":").map(Number);
    const [h2, m2] = time2.split(":").map(Number);
    return Math.abs((h1 * 60 + m1) - (h2 * 60 + m2));
  };

  const handleApply = async (targetItem, newIn, newOut, newSegs, newLoc, newDept, newComment, newReason) => {
    setLoading(true);

    // Calculate Deviation
    // Original (DB) vs Input
    const origIn = targetItem.clockIn;
    // const origOut = targetItem.clockOut; 

    // Validation: Mandatory Fields
    if (!newLoc || newLoc === "未記載") {
      alert("勤務地を選択してください。");
      setLoading(false);
      return;
    }
    if (!newDept || newDept === "未記載") {
      alert("部署を選択してください。");
      setLoading(false);
      return;
    }

    // Validation: Require editIn and editOut
    if (!newIn || !newOut) {
      alert("本来の出勤時間と退勤時間を入力してください。");
      setLoading(false);
      return;
    }

    // Segment Validation: Start < End
    if (newSegs.length > 0) {
      for (const seg of newSegs) {
        if (seg.start && seg.end && toMin(seg.start) >= toMin(seg.end)) {
          alert("区間の開始時間は終了時間より前である必要があります");
          setLoading(false);
          return;
        }
      }
    }

    // Validation: Strict Deviation Logic
    // actualIn: targetItem.clockIn (DB Value)
    // originalIn: newIn (Input Value - "本来の出勤時間")

    // 1. Mandatory Input Check
    if (!newIn) {
      alert("本来の出勤時間を入力してください。");
      setLoading(false);
      return;
    }

    const actualMin = toMin(targetItem.clockIn);
    const originalMin = toMin(newIn);
    const diff = actualMin - originalMin; // Positive if Late

    // 2. Reason Mandatory Conditions
    // - Late (Actual > Original)
    // - Deviation >= 15 mins (abs(diff) >= 15)

    // Note: User said "9:00 scheduled, pressed at 9:00 -> Deviation"? 
    // Usually 9:00:00 vs 9:00 input is 0 diff.
    // Assuming "Late" means actual > original.

    const isLate = diff > 0;
    const isBigDeviation = Math.abs(diff) >= 15;

    if ((isLate || isBigDeviation) && !newReason.trim()) {
      let msg = "乖離理由を入力してください。";
      if (isLate) msg = `本来の出勤時間(${newIn})より遅れて打刻(${targetItem.clockIn})されています（遅刻）。理由を入力してください。`;
      else if (isBigDeviation) msg = `打刻時間と本来の時間に15分以上の乖離があります。理由を入力してください。`;

      alert(msg);
      setLoading(false);
      return;
    }

    // Payload Construction
    const appData = {
      status: "pending",
      originalIn: targetItem.clockIn,
      originalOut: targetItem.clockOut,
      appliedIn: newIn,
      appliedOut: newOut,
      reason: newReason
    };

    const finalComment = JSON.stringify({
      segments: newSegs,
      text: "", // コメント欄廃止のため空文字
      application: appData
    });

    // Update API
    await fetch(`${API_BASE}/attendance/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        workDate: targetItem.workDate,
        clockIn: newIn,   // Apply the corrected time directly? Or just store in application?
        // User said "Apply... Admin checks... Admin corrects".
        // Usually "Apply" means "Request Change", and "Approved" applies it.
        // BUT AdminAttendance UI shows "Correct & Check".
        // Let's update the ACTUAL `clockIn/Out` so the "Unfinished" status goes away if fixed?
        // Or keep it separate?
        // If I update actual clockIn/Out, then the "deviance" is lost?
        // No, I stored `originalIn` in the comment json.
        // So I CAN update the real columns.
        clockIn: newIn,
        clockOut: newOut,
        comment: finalComment,
        location: newLoc,
        department: newDept,
      }),
    });

    await loadAttendances(userId);
    setEditingDate(null);
    setSegments([]);
    setLoading(false);
  };

  const handleWithdraw = async (item) => {
    if (!window.confirm("申請を取り下げますか？")) return;
    setLoading(true);

    try {
      const p = parseComment(item.comment);

      // Remove application object or set status null
      const updatedComment = JSON.stringify({
        segments: p.segments,
        text: p.text,
        application: null
      });

      await fetch(`${API_BASE}/attendance/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          workDate: item.workDate,
          clockIn: item.clockIn,
          clockOut: item.clockOut,
          comment: updatedComment
        }),
      });

      await loadAttendances(userId);
    } catch (e) {
      alert("取り下げに失敗しました");
    } finally {
      setLoading(false);
    }
  };

  /* =========================
     時間計算
  ========================= */
  const toMin = (t) => {
    if (!t) return 0;
    const parts = t.split(":").map(Number);
    const h = parts[0] || 0;
    const m = parts[1] || 0;
    const s = parts[2] || 0;
    return h * 60 + m + s / 60;
  };

  const calcBreak = (e) =>
    (e.breaks || []).reduce((sum, b) => {
      if (b.start && b.end) {
        return sum + (toMin(b.end) - toMin(b.start));
      }
      return sum;
    }, 0);

  const calcWork = (e) => {
    if (!e.clockIn || !e.clockOut) return "-";
    const rawWork = toMin(e.clockOut) - toMin(e.clockIn) - calcBreak(e);
    const work = Math.floor(rawWork / 30) * 30; // 30分単位で切り捨て

    return work > 0
      ? `${Math.floor(work / 60)}時間${Math.round(work % 60)}分`
      : "-";
  };

  /* =========================
     月次集計
  ========================= */
  const summary = (() => {
    const now = new Date();
    let total = 0;
    let days = 0;

    attendances.forEach((a) => {
      const d = new Date(a.workDate);
      if (
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        a.clockIn &&
        a.clockOut
      ) {
        const rawWork =
          toMin(a.clockOut) -
          toMin(a.clockIn) -
          calcBreak(a);

        if (rawWork > 0) {
          const work = Math.floor(rawWork / 30) * 30; // 30分単位で切り捨て
          total += work;
          days++;
        }
      }
    });

    return {
      days,
      hours: Math.floor(total / 60),
      minutes: Math.round(total % 60),
    };
  })();

  if (!userId) {
    return <div className="card">ログインしてください</div>;
  }

  /* =========================
     JSX
  ========================= */
  return (
    <>
      {/* 出退勤 */}
      <div className="card">
        <div className="card-title">
          <Clock size={20} /> 出退勤入力
          {(() => {
            const now = new Date();
            const start = startOfMonth(now);
            const end = endOfMonth(now);
            const allDays = eachDayOfInterval({ start, end });
            const scheduled = allDays.filter(d => !isWeekendOrHoliday(d)).length;
            return (
              <span style={{ marginLeft: "12px", fontSize: "0.85rem", color: "#666", fontWeight: "normal" }}>
                ({format(now, "M")}月の規定日数: {scheduled}日)
              </span>
            );
          })()}
        </div>



        <div className="button-row" style={{ marginBottom: "16px", justifyContent: "flex-end" }}>
          <button
            className="btn"
            style={{
              background: "#fff",
              color: "#8b5cf6",
              border: "1px solid #8b5cf6",
              padding: "8px 16px",
              fontSize: "0.9rem"
            }}
            onClick={() => {
              const todayStr = format(new Date(), "yyyy-MM-dd");
              setEditDate(todayStr);
              setEditIn("09:00");
              setEditOut("18:00");
              setDepartment("未記載");
              setComment("");
              setModalType("business-trip");
            }}
          >
            <Briefcase size={16} style={{ marginRight: "6px" }} /> 出張申請
          </button>
          <div style={{ position: "relative", display: "inline-flex", alignItems: "center", marginLeft: "8px" }} title="旅行など出勤はしていないけれども時給が発生する場合にご利用ください">
            <Info size={16} color="#666" style={{ cursor: "default" }} />
          </div>
        </div>

        <div className="button-row">
          <button
            className={`btn ${currentClockIn ? "btn-disabled" : "btn-green"
              }`}
            disabled={!!currentClockIn}
            onClick={() => setModalType("clock-in")}
          >
            <LogIn size={18} /> 出勤
          </button>

          <button
            className={`btn ${currentClockIn ? "btn-red" : "btn-disabled"
              }`}
            disabled={!currentClockIn || isOnBreak}
            onClick={() => setModalType("clock-out")}
          >
            <LogOut size={18} /> 退勤
          </button>
        </div>

        {currentClockIn && (
          <>
            <div className="working">
              出勤中：{currentClockIn}
              {isOnBreak && "（休憩中）"}
              {isSegmentActive && currentSegment && (
                <div style={{ fontSize: "0.9em", marginTop: "4px", color: "#2563eb" }}>
                  📍 区間進行中: {currentSegment.location} / {currentSegment.department} ({currentSegment.start}〜)
                </div>
              )}
            </div>

            <div className="button-row">
              {/* 休憩ボタン群 */}
              {!isOnBreak ? (
                <button
                  className="btn btn-gray"
                  disabled={isSegmentActive}
                  onClick={() => setModalType("break-start")}
                  title={isSegmentActive ? "区間終了後に休憩してください" : ""}
                >
                  <Coffee size={16} /> 休憩開始
                </button>
              ) : (
                <button
                  className="btn btn-blue"
                  onClick={() => setModalType("break-end")}
                >
                  <Coffee size={16} /> 休憩終了
                </button>
              )}

              {/* 区間ボタン群 */}
              {!isSegmentActive ? (
                <button
                  className="btn btn-green"
                  disabled={isOnBreak}
                  onClick={() => {
                    // Start Segment Modalのための初期値をセット
                    setLocation("未記載");
                    setDepartment("未記載");
                    setModalType("segment-start");
                  }}
                  title={isOnBreak ? "休憩終了後に開始してください" : ""}
                >
                  <Plus size={16} /> 区間開始
                </button>
              ) : (
                <button
                  className="btn btn-red"
                  onClick={() => setModalType("segment-end")}
                >
                  <LogOut size={16} /> 区間終了
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* 月次サマリー */}
      <div className="summary-grid">
        <div className="summary-card">
          <div className="summary-label">今月の出勤日数</div>
          <div className="summary-value">{summary.days} 日</div>
        </div>

        <div className="summary-card">
          <div className="summary-label">今月の勤務時間</div>
          <div className="summary-value">
            {summary.hours} 時間 {summary.minutes} 分
          </div>
        </div>

        <div className="summary-card">
          <div className="summary-label">平均勤務時間</div>
          <div className="summary-value">
            {summary.days === 0
              ? "-"
              : `${Math.floor(
                (summary.hours * 60 + summary.minutes) /
                summary.days /
                60
              )} 時間`}
          </div>
        </div>
      </div>

      {/* 勤務履歴（編集付き） */}
      <div className="card">
        <div className="card-title">勤務履歴</div>

        <div className="table-wrap">
          <table className="history-table">
            <thead>
              <tr>
                <th>日付</th>
                <th>出勤</th>
                <th>退勤</th>
                <th>休憩</th>
                <th>勤務</th>
                <th style={{ minWidth: "220px" }}>勤務地 / 部署 / コメント</th>
              </tr>
            </thead>
            <tbody>
              {attendances.map((e) => {
                const breakMins = calcBreak(e);
                const breakStr =
                  breakMins > 0
                    ? `${Math.floor(breakMins / 60)}時間${Math.round(
                      breakMins % 60
                    )}分`
                    : "0分";

                const appStatus = parseComment(e.comment).application?.status;

                let rowClass = "";
                if (new Date(e.workDate) < new Date(format(new Date(), "yyyy-MM-dd"))) {
                  if (appStatus === "approved") rowClass = "row-green";
                  else if (appStatus === "pending") rowClass = "row-orange";
                  else rowClass = "row-red";
                }

                return (
                  <tr key={e.workDate} className={rowClass}>
                    <td style={{ fontWeight: "500" }}>
                      {format(new Date(e.workDate), "M/d(E)", { locale: ja })}
                    </td>
                    <td>{e.clockIn || "-"}</td>
                    <td>{e.clockOut || "-"}</td>
                    <td>{breakStr}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{calcWork(e)}</td>
                    <td>
                      {editingDate === e.workDate ? (
                        <div className="edit-form">
                          {segments.length === 0 ? (
                            <>
                              {/* 通常編集モード（区間なし） */}
                              <div style={{ marginBottom: "8px" }}>
                                <div style={{ fontSize: "11px", color: "#6b7280", marginBottom: "2px" }}>勤務地</div>
                                <select
                                  className="edit-select"
                                  value={location}
                                  onChange={(ev) => setLocation(ev.target.value)}
                                >
                                  {LOCATIONS.map((l) => (
                                    <option key={l}>{l}</option>
                                  ))}
                                </select>
                              </div>

                              <div style={{ marginBottom: "8px" }}>
                                <div style={{ fontSize: "11px", color: "#6b7280", marginBottom: "2px" }}>部署</div>
                                <select
                                  className="edit-select"
                                  value={department}
                                  onChange={(ev) => setDepartment(ev.target.value)}
                                >
                                  {DEPARTMENTS.map((d) => (
                                    <option key={d}>{d}</option>
                                  ))}
                                </select>
                              </div>
                            </>
                          ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "8px" }}>
                              {/* 区間編集モード */}
                              {segments.map((seg, idx) => (
                                <div
                                  key={idx}
                                  style={{
                                    border: "1px solid #e5e7eb",
                                    padding: "8px",
                                    borderRadius: "8px",
                                    background: "#f9fafb",
                                  }}
                                >
                                  <div style={{ fontSize: "11px", color: "#6b7280", marginBottom: "4px" }}>時間帯</div>
                                  <div style={{ display: "flex", gap: "4px", marginBottom: "8px" }}>
                                    <input
                                      type="time"
                                      className="edit-select"
                                      style={{ flex: 1 }}
                                      value={seg.start}
                                      onChange={(ev) => {
                                        const newSegs = [...segments];
                                        newSegs[idx].start = ev.target.value;
                                        setSegments(newSegs);
                                        // Sync First Segment with Clock In
                                        if (idx === 0) {
                                          setEditIn(ev.target.value);
                                        }
                                      }}
                                    />
                                    <span style={{ alignSelf: "center" }}>-</span>
                                    <input
                                      type="time"
                                      className="edit-select"
                                      style={{ flex: 1 }}
                                      value={seg.end}
                                      onChange={(ev) => {
                                        const newSegs = [...segments];
                                        newSegs[idx].end = ev.target.value;
                                        setSegments(newSegs);
                                      }}
                                    />
                                  </div>
                                  <div style={{ display: "flex", gap: "4px" }}>
                                    <div style={{ flex: 1 }}>
                                      <div style={{ fontSize: "10px", color: "#6b7280", marginBottom: "2px" }}>勤務地</div>
                                      <select
                                        className="edit-select"
                                        style={{ width: "100%", color: seg.location === "未記載" ? "#9ca3af" : "inherit" }}
                                        value={seg.location}
                                        onChange={(ev) => {
                                          const newSegs = [...segments];
                                          newSegs[idx].location = ev.target.value;
                                          setSegments(newSegs);
                                        }}
                                      >
                                        <option value="未記載" style={{ color: "#9ca3af" }}>未記載</option>
                                        {LOCATIONS.filter(l => l !== "未記載").map((l) => (
                                          <option key={l} value={l} style={{ color: "#1f2937" }}>{l}</option>
                                        ))}
                                      </select>
                                    </div>
                                    <div style={{ flex: 1 }}>
                                      <div style={{ fontSize: "10px", color: "#6b7280", marginBottom: "2px" }}>部署</div>
                                      <select
                                        className="edit-select"
                                        style={{ width: "100%", color: seg.department === "未記載" ? "#9ca3af" : "inherit" }}
                                        value={seg.department}
                                        onChange={(ev) => {
                                          const newSegs = [...segments];
                                          newSegs[idx].department = ev.target.value;
                                          setSegments(newSegs);
                                        }}
                                      >
                                        <option value="未記載" style={{ color: "#9ca3af" }}>未記載</option>
                                        {DEPARTMENTS.filter(d => d !== "未記載").map((d) => (
                                          <option key={d} value={d} style={{ color: "#1f2937" }}>{d}</option>
                                        ))}
                                      </select>
                                    </div>
                                    {isDispatch && (
                                      <div style={{ flex: 1 }}>
                                        <div style={{ fontSize: "10px", color: "#6b7280", marginBottom: "2px" }}>区分</div>
                                        <select
                                          className="edit-select"
                                          style={{ width: "100%" }}
                                          value={seg.workType || "派遣"}
                                          onChange={(ev) => {
                                            const newSegs = [...segments];
                                            newSegs[idx].workType = ev.target.value;
                                            setSegments(newSegs);
                                          }}
                                        >
                                          <option value="派遣">派遣</option>
                                          <option value="バイト">バイト</option>
                                        </select>
                                      </div>
                                    )}
                                    <div style={{ display: "flex", alignItems: "flex-end" }}>
                                      <button
                                        className="btn btn-red"
                                        style={{ padding: "6px 8px", height: "34px" }}
                                        onClick={() => {
                                          const newSegs = segments.filter((_, i) => i !== idx);
                                          setSegments(newSegs);
                                        }}
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          <div style={{ margin: "4px 0" }}>
                            <button
                              className="btn"
                              style={{
                                padding: "4px 12px",
                                fontSize: "12px",
                                background: "#f3f4f6",
                                color: "#374151",
                                width: "100%",
                                justifyContent: "center"
                              }}
                              onClick={() => {
                                const lastSeg = segments[segments.length - 1];
                                const defaultStart = lastSeg && lastSeg.end ? lastSeg.end : "";
                                const defaultEnd = editOut || "";
                                setSegments([
                                  ...segments,
                                  { start: defaultStart, end: defaultEnd, location: "未記載", department: "未記載", workType: isDispatch ? "派遣" : undefined }
                                ]);
                              }}
                            >
                              <Plus size={14} /> 区間を追加
                            </button>
                          </div>

                          {/* Time Edit Inputs */}
                          <div style={{ display: "flex", gap: "10px", marginBottom: "8px", background: "#fff", padding: "8px", borderRadius: "8px", border: "1px solid #eee" }}>
                            <div style={{ flex: 1 }}>
                              <label style={{ fontSize: "10px", color: "#666" }}>本来の出勤時間</label>
                              <select
                                className="edit-select"
                                value={editIn}
                                onChange={ev => {
                                  setEditIn(ev.target.value);
                                  // Sync with First Segment Start
                                  if (segments.length > 0) {
                                    const n = [...segments];
                                    n[0].start = ev.target.value;
                                    setSegments(n);
                                  }
                                }}
                                style={{ width: "100%" }}
                              >
                                <option value="">--:--</option>
                                {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                              </select>
                            </div>
                            <div style={{ flex: 1 }}>
                              <label style={{ fontSize: "10px", color: "#666" }}>本来の退勤時間</label>
                              <select className="edit-select" value={editOut} onChange={ev => setEditOut(ev.target.value)} style={{ width: "100%" }}>
                                <option value="">--:--</option>
                                {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                              </select>
                            </div>
                          </div>

                          <textarea
                            className="edit-textarea"
                            rows={2}
                            value={reason}
                            onChange={(ev) => setReason(ev.target.value)}
                            placeholder="勤怠乖離の理由を入力..."
                            style={{ marginBottom: "8px" }}
                          />

                          {/* General Comment Removed as requested */}

                          <div className="edit-actions">
                            <button
                              className="btn btn-gray"
                              style={{ padding: "8px 16px", fontSize: "14px" }}
                              onClick={() => {
                                setEditingDate(null);
                                setSegments([]);
                              }}
                            >
                              キャンセル
                            </button>
                            <button
                              className="btn btn-blue"
                              style={{ padding: "8px 16px", fontSize: "14px" }}
                              onClick={() => handleApply(e, editIn, editOut, segments, location, department, comment, reason)}
                            >
                              {new Date(e.workDate) < new Date(format(new Date(), "yyyy-MM-dd")) ? "申請する" : "保存"}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div
                          style={{
                            display: "flex",
                            gap: 8,
                            alignItems: "flex-start",
                            justifyContent: "space-between",
                          }}
                        >
                          <div style={{ flex: 1, lineHeight: "1.5" }}>
                            {(() => {
                              let rowSegments = [];
                              let rowText = "";

                              // Parse logic
                              if (e.segments && Array.isArray(e.segments) && e.segments.length > 0) {
                                rowSegments = e.segments;
                                const parsed = parseComment(e.comment);
                                rowText = parsed.text;
                                if (parsed.application?.reason) {
                                  rowText += ` (理由: ${parsed.application.reason})`;
                                }
                              } else {
                                const parsed = parseComment(e.comment);
                                rowSegments = parsed.segments;
                                rowText = parsed.text;
                                if (parsed.application?.reason) {
                                  rowText += ` (理由: ${parsed.application.reason})`;
                                }
                              }

                              const appStatus = parseComment(e.comment).application?.status;

                              if (rowSegments.length > 0) {
                                return (
                                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                                    {new Date(e.workDate) < new Date(format(new Date(), "yyyy-MM-dd")) && (
                                      <div style={{ marginBottom: "4px" }}>
                                        {appStatus === "approved" ? (
                                          <span className="status-badge green">承認完了</span>
                                        ) : appStatus === "pending" ? (
                                          <span className="status-badge orange">承認まち</span>
                                        ) : (
                                          <span className="status-badge red">未申請</span>
                                        )}
                                      </div>
                                    )}

                                    {rowSegments.map((seg, idx) => (
                                      <div key={idx} style={{ fontSize: "13px", display: "flex", alignItems: "center", gap: "6px" }}>
                                        <span style={{ fontFamily: "monospace", fontSize: "12px", color: "#555" }}>
                                          {seg.start && seg.end ? `${seg.start}-${seg.end}` : "時間未定"}
                                        </span>
                                        <span className="status-badge left" style={{ padding: "2px 6px", fontSize: "11px" }}>
                                          {seg.location || "未記載"}
                                        </span>
                                        <span className="status-badge left" style={{ padding: "2px 6px", fontSize: "11px" }}>
                                          {seg.department || "未記載"}
                                        </span>
                                        {seg.workType && (
                                          <span className="status-badge left" style={{ padding: "2px 6px", fontSize: "11px", background: seg.workType === "バイト" ? "#fbbf24" : "#e5e7eb", color: "#374151" }}>
                                            {seg.workType}
                                          </span>
                                        )}
                                      </div>
                                    ))}
                                    {rowText && (
                                      <div style={{ marginTop: "4px", color: "#4b5563", fontSize: "13px" }}>
                                        {rowText}
                                      </div>
                                    )}
                                  </div>
                                );
                              } else {
                                // Default View
                                return (
                                  <>
                                    {new Date(e.workDate) < new Date(format(new Date(), "yyyy-MM-dd")) && (
                                      <div style={{ marginBottom: "4px" }}>
                                        {appStatus === "approved" ? (
                                          <span className="status-badge green">承認完了</span>
                                        ) : appStatus === "pending" ? (
                                          <span className="status-badge orange">承認まち</span>
                                        ) : (
                                          <span className="status-badge red">未申請</span>
                                        )}
                                      </div>
                                    )}
                                    <div>
                                      <span className="status-badge left">
                                        {e.location || "未記載"}
                                      </span>
                                      <span className="status-badge left" style={{ marginLeft: "4px" }}>
                                        {e.department || "未記載"}
                                      </span>
                                    </div>
                                    <div style={{ marginTop: "4px", color: "#4b5563", fontSize: "13px" }}>
                                      {rowText || "—"}
                                    </div>
                                  </>
                                );
                              }
                            })()}
                          </div>
                          {(() => {
                            const status = parseComment(e.comment).application?.status;

                            // 承認済みはボタンなし
                            if (status === "approved") {
                              return null;
                            }

                            // 承認待ちは「取り下げ」ボタン
                            if (status === "pending") {
                              return (
                                <button
                                  className="btn btn-red"
                                  style={{ padding: "4px 12px", fontSize: "12px", height: "auto", borderRadius: "14px" }}
                                  onClick={() => handleWithdraw(e)}
                                >
                                  取り下げ
                                </button>
                              );
                            }

                            // 未申請（またはその他）は「申請/修正」ボタン
                            return (
                              <button
                                className={
                                  new Date(e.workDate) < new Date(format(new Date(), "yyyy-MM-dd"))
                                    ? "btn btn-blue"
                                    : "icon-btn"
                                }
                                style={
                                  new Date(e.workDate) < new Date(format(new Date(), "yyyy-MM-dd"))
                                    ? { padding: "4px 12px", fontSize: "12px", height: "auto", borderRadius: "14px" }
                                    : {}
                                }
                                onClick={() => {
                                  setEditingDate(e.workDate);
                                  const parsed = parseComment(e.comment);
                                  const { segments: parsedSegs, text: parsedText } = parsed;

                                  setComment(parsedText || e.comment || ""); // テキスト部分のみ
                                  setReason(parsed.application?.reason || ""); // 理由をセット

                                  // 区間があればそれをセット
                                  if (parsedSegs.length > 0) {
                                    setSegments(parsedSegs);
                                    setLocation("複数箇所");
                                    setDepartment("複数箇所");
                                  } else {
                                    setSegments([]);
                                    setLocation(e.location || "未記載");
                                    setDepartment(e.department || "未記載");
                                    setEditIn(e.clockIn || "");
                                    setEditOut(e.clockOut || "");
                                  }
                                }}
                              >
                                {/* 過去日なら「申請」、当日なら「修正」 */}
                                {new Date(e.workDate) < new Date(format(new Date(), "yyyy-MM-dd")) ? "申請" : <Pencil size={18} />}
                              </button>
                            );
                          })()}
                        </div>
                      )
                      }
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div >
      </div >

      {/* 確認モーダル */}
      {
        modalType && (
          <div className="modal-overlay">
            <div className="modal">
              <div className="modal-title">
                {modalType === "segment-start" ? "区間開始" : "確認"}
              </div>

              {(modalType === "segment-start") && (
                <div style={{ marginBottom: "16px" }}>
                  <div style={{ marginBottom: "8px" }}>
                    <label style={{ display: "block", fontSize: "12px", color: "#6b7280", marginBottom: "4px" }}>勤務地</label>
                    <select
                      className="edit-select"
                      style={{ width: "100%", padding: "8px" }}
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                    >
                      {LOCATIONS.map((l) => (
                        <option key={l}>{l}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "12px", color: "#6b7280", marginBottom: "4px" }}>部署</label>
                    <select
                      className="edit-select"
                      style={{ width: "100%", padding: "8px" }}
                      value={department}
                      onChange={(e) => setDepartment(e.target.value)}
                    >
                      {DEPARTMENTS.map((d) => (
                        <option key={d}>{d}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              <div className="modal-actions">
                <button
                  className="modal-btn"
                  onClick={() => setModalType(null)}
                >
                  キャンセル
                </button>
                <button
                  className="modal-btn modal-confirm-green"
                  onClick={() =>
                    post(
                      modalType === "clock-in"
                        ? "/attendance/clock-in"
                        : modalType === "clock-out"
                          ? "/attendance/clock-out"
                          : modalType === "break-start"
                            ? "/attendance/break-start"
                            : modalType === "break-end"
                              ? "/attendance/break-end"
                              : modalType === "segment-start"
                                ? "/attendance/segment-start"
                                : "/attendance/segment-end",
                      (modalType === "segment-start") ? { location, department } : {}
                    )
                  }
                >
                  確定
                </button>
              </div>
            </div>
          </div>
        )
      }
      {/* Business Trip Modal */}
      {
        modalType === "business-trip" && (
          <div className="modal-overlay">
            <div className="modal">
              <div className="modal-title"><Briefcase size={20} /> 出張申請</div>

              <div style={{ marginBottom: "16px" }}>
                <label style={{ fontSize: "12px", color: "#666" }}>日付</label>
                <input
                  type="date"
                  className="edit-select"
                  style={{ width: "100%", padding: "8px" }}
                  value={editDate}
                  onChange={e => setEditDate(e.target.value)}
                />
              </div>

              <div style={{ display: "flex", gap: "16px", marginBottom: "16px" }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: "12px", color: "#666" }}>開始時間 (予定)</label>
                  <select className="edit-select" style={{ width: "100%" }} value={editIn} onChange={e => setEditIn(e.target.value)}>
                    <option value="">--:--</option>
                    {TIME_OPTIONS.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: "12px", color: "#666" }}>終了時間 (予定)</label>
                  <select className="edit-select" style={{ width: "100%" }} value={editOut} onChange={e => setEditOut(e.target.value)}>
                    <option value="">--:--</option>
                    {TIME_OPTIONS.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ marginBottom: "16px" }}>
                <label style={{ fontSize: "12px", color: "#666" }}>部署</label>
                <select className="edit-select" style={{ width: "100%" }} value={department} onChange={e => setDepartment(e.target.value)}>
                  {DEPARTMENTS.map(d => <option key={d}>{d}</option>)}
                </select>
              </div>

              <div style={{ marginBottom: "16px" }}>
                <label style={{ fontSize: "12px", color: "#666" }}>申請理由・備考 (必須)</label>
                <textarea
                  className="edit-textarea"
                  rows={3}
                  placeholder="例: アリア旅行のため"
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                />
              </div>

              <div className="modal-actions">
                <button className="btn btn-gray" onClick={() => setModalType(null)}>キャンセル</button>
                <button className="btn btn-blue" onClick={handleBusinessTripApply} disabled={loading}>
                  {loading ? "送信中..." : "申請する"}
                </button>
              </div>
            </div>
          </div>
        )
      }
    </>
  );
}
