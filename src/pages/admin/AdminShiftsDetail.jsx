// src/pages/admin/AdminShiftDetail.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

// 希望シフト（管理者用一覧）
const SHIFT_REQUESTS_ADMIN_API_URL =
  "https://cma9brof8g.execute-api.ap-northeast-1.amazonaws.com/prod/shiftrequests?admin=1";

// 確定シフトの取得
const FIXED_SHIFTS_GET_API_URL =
  "https://cma9brof8g.execute-api.ap-northeast-1.amazonaws.com/prod/fixedshifts";

// 確定シフトの保存（★ SaveFixedShifts を紐づけた URL にしてください）
const FIXED_SHIFTS_POST_API_URL =
  "https://cma9brof8g.execute-api.ap-northeast-1.amazonaws.com/prod/savefixedshifts";

const HOURS = Array.from({ length: 18 }, (_, i) => 7 + i); // 7:00〜24:00

// 文字列 → JSON を安全にパース
const safeJsonParse = (text) => {
  try {
    return text ? JSON.parse(text) : null;
  } catch (e) {
    console.error("safeJsonParse error:", e, text);
    return null;
  }
};

const timeToMinutes = (t) => {
  if (!t || typeof t !== "string" || !t.includes(":")) return null;
  const [h, m] = t.split(":").map((v) => parseInt(v, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
};

const isWorkingOnHour = (startTime, endTime, hour) => {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  if (start == null || end == null) return false;
  const cellStart = hour * 60;
  const cellEnd = (hour + 1) * 60;
  return Math.max(start, cellStart) < Math.min(end, cellEnd);
};

const makeKey = (row) =>
  [
    row.userId,
    row.date,
    row.startTime || "",
    row.endTime || "",
    row.location || "",
    row.comment || "",
  ].join("|");

export default function AdminShiftDetail() {
  const { date: targetDate } = useParams(); // /admin/shifts/:date
  const navigate = useNavigate();

  const [requestRows, setRequestRows] = useState([]); // この日の希望シフト
  const [fixedRows, setFixedRows] = useState([]); // この日の確定シフト
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [dragSource, setDragSource] = useState(null); // { type: 'request'|'fixed', index }

  // 見出し用
  const headerLabel = useMemo(() => {
    if (!targetDate) return "";
    const d = new Date(targetDate);
    if (Number.isNaN(d.getTime())) return targetDate;
    const weekNames = ["日", "月", "火", "水", "木", "金", "土"];
    const w = weekNames[d.getDay()];
    return `${targetDate}（${w}）のシフト`;
  }, [targetDate]);

  // ===== データ取得 =====
  useEffect(() => {
    const fetchAll = async () => {
      if (!targetDate) return;
      setLoading(true);
      setError("");

      try {
        // --- 希望シフト（管理者用） ---
        const reqUrl = `${SHIFT_REQUESTS_ADMIN_API_URL}&date=${encodeURIComponent(
          targetDate
        )}`;
        console.log("AdminShiftDetail GET (requests):", reqUrl);

        const resReq = await fetch(reqUrl);
        const textReq = await resReq.text();
        console.log("AdminShiftDetail raw requests:", textReq);

        let outerReq = safeJsonParse(textReq);
        let dataReq = outerReq;

        if (outerReq && typeof outerReq === "object" && outerReq.body) {
          dataReq =
            typeof outerReq.body === "string"
              ? safeJsonParse(outerReq.body)
              : outerReq.body;
        }

        const requestItems = Array.isArray(dataReq?.items)
          ? dataReq.items
          : [];

        const allRequestRows = requestItems
          .filter((it) => it.date === targetDate)
          .map((it) => ({
            userId: it.userId,
            userName: it.userName || it.userId,
            date: it.date,
            startTime: it.startTime || null,
            endTime: it.endTime || null,
            location: it.location || it.workType || "",
            comment: it.comment || "",
          }));

        // --- 確定シフト ---
        console.log("AdminShiftDetail GET (fixed):", FIXED_SHIFTS_GET_API_URL);
        const resFixed = await fetch(FIXED_SHIFTS_GET_API_URL);
        const textFixed = await resFixed.text();
        console.log("AdminShiftDetail raw fixed:", textFixed);

        let outerFixed = safeJsonParse(textFixed);
        let dataFixed = outerFixed;

        if (outerFixed && typeof outerFixed === "object" && outerFixed.body) {
          dataFixed =
            typeof outerFixed.body === "string"
              ? safeJsonParse(outerFixed.body)
              : outerFixed.body;
        }

        const fixedItems = Array.isArray(dataFixed?.items)
          ? dataFixed.items
          : [];

        const fixedForDay = fixedItems
          .filter((it) => it.date === targetDate)
          .map((it) => ({
            userId: it.userId,
            userName: it.userName || it.userId,
            date: it.date,
            startTime: it.startTime || null,
            endTime: it.endTime || null,
            location: it.location || "",
            comment: it.comment || "",
          }));

        // 既に確定しているものを希望から除外
        const fixedKeys = new Set(fixedForDay.map(makeKey));
        const displayRequests = allRequestRows.filter(
          (row) => !fixedKeys.has(makeKey(row))
        );

        setRequestRows(displayRequests);
        setFixedRows(fixedForDay);
      } catch (err) {
        console.error("AdminShiftDetail fetch error:", err);
        setError("シフト情報の取得中にエラーが発生しました");
      } finally {
        setLoading(false);
      }
    };

    fetchAll();
  }, [targetDate]);

  // ===== Drag & Drop =====
  const handleDragStart = (type, index) => {
    setDragSource({ type, index });
  };
  const handleDragEnd = () => setDragSource(null);
  const handleDragOver = (e) => e.preventDefault();

  const saveFixedShift = async (row) => {
    const payload = {
      userId: row.userId,
      date: row.date,
      startTime: row.startTime,
      endTime: row.endTime,
      comment: row.comment,
      location: row.location || null,
    };

    console.log("AdminShiftDetail saveFixedShift payload:", payload);

    const res = await fetch(FIXED_SHIFTS_POST_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    console.log("AdminShiftDetail saveFixedShift raw:", text);

    const outer = safeJsonParse(text);
    const data =
      outer && typeof outer === "object" && outer.body
        ? safeJsonParse(outer.body)
        : outer;

    const statusCode =
      typeof outer?.statusCode === "number" ? outer.statusCode : res.status;

    if (statusCode !== 200) {
      throw new Error(
        (data && data.message) || `保存に失敗しました (status ${statusCode})`
      );
    }
  };

  const handleDrop = async (targetType) => {
    if (!dragSource) return;
    const { type, index } = dragSource;
    setDragSource(null);

    if (type === targetType) return;

    try {
      if (type === "request" && targetType === "fixed") {
        const row = requestRows[index];
        if (!row) return;

        setSaving(true);
        await saveFixedShift(row); // DB へ保存

        // 希望 → 確定 に移動
        setRequestRows((prev) => prev.filter((_, i) => i !== index));
        setFixedRows((prev) => [...prev, row]);
      } else if (type === "fixed" && targetType === "request") {
        // ★まだ FixedShifts の削除 API を作っていないので、
        //   DB はそのまま・画面上だけ戻しています。
        const row = fixedRows[index];
        if (!row) return;

        setFixedRows((prev) => prev.filter((_, i) => i !== index));
        setRequestRows((prev) => [...prev, row]);
      }
    } catch (e) {
      console.error("AdminShiftDetail drop error:", e);
      alert(e.message || "シフトの更新に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const renderGanttRow = (row) => (
    <>
      {HOURS.map((h) => {
        const working = isWorkingOnHour(row.startTime, row.endTime, h);
        return (
          <div
            key={h}
            className={
              "admin-gantt-cell" +
              (working ? " admin-gantt-cell-working" : "")
            }
          />
        );
      })}
    </>
  );

  return (
    <div className="admin-shift-detail-page">
      <button
        style={{ marginBottom: 12 }}
        onClick={() => navigate("/admin/shifts")}
      >
        ◀ カレンダーに戻る
      </button>

      <h2>管理者用：{headerLabel}</h2>

      {loading && <div style={{ marginBottom: 8 }}>読み込み中です…</div>}
      {saving && (
        <div style={{ marginBottom: 8, color: "#1976d2" }}>
          シフトを保存しています…
        </div>
      )}
      {error && (
        <div style={{ marginBottom: 8, color: "red" }}>{error}</div>
      )}

      {/* ===== ① 希望シフト ===== */}
      <section
        className="admin-shift-section admin-shift-section-requests"
        onDragOver={handleDragOver}
        onDrop={() => handleDrop("request")} // 確定→希望
      >
        <div className="admin-shift-section-title">
          ◎ 希望シフト（この日に入れる人）
        </div>
        <p className="admin-shift-section-desc">
          行をドラッグして下の「確定シフト」にドロップすると、その人のシフトが確定します。
        </p>

        <div className="admin-shift-body">
          {/* 左：テーブル */}
          <div className="admin-shift-table-wrapper">
            <table className="admin-shift-table">
              <thead>
                <tr>
                  <th style={{ width: 28 }}></th>
                  <th>スタッフ</th>
                  <th>時間</th>
                  <th>勤務地</th>
                  <th>コメント</th>
                </tr>
              </thead>
              <tbody>
                {requestRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ padding: 8, textAlign: "left" }}>
                      この日に希望シフトを出しているスタッフはいません。
                    </td>
                  </tr>
                ) : (
                  requestRows.map((row, idx) => (
                    <tr
                      key={`req-row-${idx}`}
                      draggable
                      onDragStart={() => handleDragStart("request", idx)}
                      onDragEnd={handleDragEnd}
                    >
                      <td className="admin-drag-handle">⋮⋮</td>
                      <td>{row.userName || row.userId}</td>
                      <td>
                        {row.startTime && row.endTime
                          ? `${row.startTime}〜${row.endTime}`
                          : "-"}
                      </td>
                      <td>{row.location || "-"}</td>
                      <td>{row.comment || ""}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* 右：ガントチャート */}
          <div className="admin-gantt-wrapper">
            <div className="admin-gantt-scroll">
              <div className="admin-gantt-header">
                {HOURS.map((h) => (
                  <div
                    key={h}
                    className="admin-gantt-header-cell"
                  >{`${h}:00`}</div>
                ))}
              </div>

              {requestRows.map((row, idx) => (
                <div
                  key={`req-gantt-${idx}`}
                  className="admin-gantt-row"
                >
                  {renderGanttRow(row)}
                </div>
              ))}

              {requestRows.length === 0 && (
                <div className="admin-gantt-empty">
                  この日に希望シフトは登録されていません。
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ===== ② 確定シフト ===== */}
      <section
        className="admin-shift-section admin-shift-section-fixed"
        onDragOver={handleDragOver}
        onDrop={() => handleDrop("fixed")} // 希望→確定
      >
        <div className="admin-shift-section-title">② 確定シフト</div>
        <p className="admin-shift-section-desc">
          上の希望シフトの行をこのエリアにドラッグ＆ドロップすると、確定シフトとして登録されます。
        </p>

        <div className="admin-shift-body">
          {/* 左：テーブル */}
          <div className="admin-shift-table-wrapper">
            <table className="admin-shift-table">
              <thead>
                <tr>
                  <th style={{ width: 28 }}></th>
                  <th>スタッフ</th>
                  <th>時間</th>
                  <th>勤務地</th>
                  <th>コメント</th>
                </tr>
              </thead>
              <tbody>
                {fixedRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ padding: 8, textAlign: "left" }}>
                      まだ確定シフトはありません。上の希望シフトからドラッグして確定してください。
                    </td>
                  </tr>
                ) : (
                  fixedRows.map((row, idx) => (
                    <tr
                      key={`fixed-row-${idx}`}
                      draggable
                      onDragStart={() => handleDragStart("fixed", idx)}
                      onDragEnd={handleDragEnd}
                    >
                      <td className="admin-drag-handle">⋮⋮</td>
                      <td>{row.userName || row.userId}</td>
                      <td>
                        {row.startTime && row.endTime
                          ? `${row.startTime}〜${row.endTime}`
                          : "-"}
                      </td>
                      <td>{row.location || "-"}</td>
                      <td>{row.comment || ""}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* 右：ガントチャート */}
          <div className="admin-gantt-wrapper">
            <div className="admin-gantt-scroll">
              <div className="admin-gantt-header">
                {HOURS.map((h) => (
                  <div
                    key={h}
                    className="admin-gantt-header-cell"
                  >{`${h}:00`}</div>
                ))}
              </div>

              {fixedRows.map((row, idx) => (
                <div
                  key={`fixed-gantt-${idx}`}
                  className="admin-gantt-row"
                >
                  {renderGanttRow(row)}
                </div>
              ))}

              {fixedRows.length === 0 && (
                <div className="admin-gantt-empty">
                  まだ確定シフトはありません。
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
