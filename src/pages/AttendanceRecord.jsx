import React, { useEffect, useState } from "react";
import {
  Clock,
  LogIn,
  LogOut,
  Coffee,
  Pencil,
} from "lucide-react";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import "../App.css";

const API_BASE =
  "https://lfsu60xvw7.execute-api.ap-northeast-1.amazonaws.com";

const LOCATIONS = ["未記載", "呉羽", "山葉", "東洋", "細川"];
const DEPARTMENTS = ["未記載", "即日", "買取", "広告","CEO" , "アビエス"];

export default function AttendanceRecord() {
  /* =========================
     State
  ========================= */
  const [userId, setUserId] = useState(null);
  const [attendances, setAttendances] = useState([]);
  const [currentClockIn, setCurrentClockIn] = useState(null);
  const [isOnBreak, setIsOnBreak] = useState(false);
  const [modalType, setModalType] = useState(null);
  const [loading, setLoading] = useState(false);

  // 編集
  const [editingDate, setEditingDate] = useState(null);
  const [comment, setComment] = useState("");
  const [location, setLocation] = useState("未記載");
  const [department, setDepartment] = useState("未記載");

  /* =========================
     userId
  ========================= */
  useEffect(() => {
    setUserId(localStorage.getItem("userId"));
  }, []);

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
    } else {
      setCurrentClockIn(null);
      setIsOnBreak(false);
    }
  };

  useEffect(() => {
    if (userId) loadAttendances(userId);
  }, [userId]);

  /* =========================
     共通 POST
  ========================= */
  const post = async (path) => {
    setLoading(true);
    await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    await loadAttendances(userId);
    setModalType(null);
    setLoading(false);
  };

  /* =========================
     勤務メモ保存
  ========================= */
  const saveDetail = async (workDate) => {
    setLoading(true);
    await fetch(`${API_BASE}/attendance/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        workDate,
        comment,
        location,
        department,
      }),
    });
    await loadAttendances(userId);
    setEditingDate(null);
    setLoading(false);
  };

  /* =========================
     時間計算
  ========================= */
  const toMin = (t) => {
    const [h, m, s] = t.split(":").map(Number);
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
    const work =
      toMin(e.clockOut) - toMin(e.clockIn) - calcBreak(e);
    return work > 0
      ? `${Math.floor(work / 60)}時間${Math.round(work % 60)}分`
      : "-";
  };

  /* =========================
     月次集計（← これが消えてた）
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
        const work =
          toMin(a.clockOut) -
          toMin(a.clockIn) -
          calcBreak(a);

        if (work > 0) {
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
        </div>

        <div className="button-row">
          <button
            className={`btn ${
              currentClockIn ? "btn-disabled" : "btn-green"
            }`}
            disabled={!!currentClockIn}
            onClick={() => setModalType("clock-in")}
          >
            <LogIn size={18} /> 出勤
          </button>

          <button
            className={`btn ${
              currentClockIn ? "btn-red" : "btn-disabled"
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
            </div>

            <div className="button-row">
              {!isOnBreak ? (
                <button
                  className="btn btn-gray"
                  onClick={() => setModalType("break-start")}
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
            </div>
          </>
        )}
      </div>

      {/* ★ 月次サマリー（復活） */}
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
          <table>
            <thead>
              <tr>
                <th>日付</th>
                <th>出勤</th>
                <th>退勤</th>
                <th>勤務</th>
                <th>勤務地 / 部署 / コメント</th>
              </tr>
            </thead>
            <tbody>
              {attendances.map((e) => (
                <tr key={e.workDate}>
                  <td>
                    {format(
                      new Date(e.workDate),
                      "M/d(E)",
                      { locale: ja }
                    )}
                  </td>
                  <td>{e.clockIn || "-"}</td>
                  <td>{e.clockOut || "-"}</td>
                  <td>{calcWork(e)}</td>
                  <td>
                    {editingDate === e.workDate ? (
                      <>
                        <select
                          value={location}
                          onChange={(ev) =>
                            setLocation(ev.target.value)
                          }
                        >
                          {LOCATIONS.map((l) => (
                            <option key={l}>{l}</option>
                          ))}
                        </select>

                        <select
                          value={department}
                          onChange={(ev) =>
                            setDepartment(ev.target.value)
                          }
                        >
                          {DEPARTMENTS.map((d) => (
                            <option key={d}>{d}</option>
                          ))}
                        </select>

                        <textarea
                          rows={2}
                          value={comment}
                          onChange={(ev) =>
                            setComment(ev.target.value)
                          }
                        />

                        <button
                          className="btn btn-blue"
                          onClick={() =>
                            saveDetail(e.workDate)
                          }
                        >
                          保存
                        </button>
                      </>
                    ) : (
                      <div
                        style={{
                          display: "flex",
                          gap: 8,
                          alignItems: "center",
                        }}
                      >
                        <div style={{ flex: 1 }}>
                          {e.location || "未記載"} /{" "}
                          {e.department || "未記載"} /{" "}
                          {e.comment || "—"}
                        </div>
                        <button
                          className="icon-btn"
                          onClick={() => {
                            setEditingDate(e.workDate);
                            setComment(e.comment || "");
                            setLocation(
                              e.location || "未記載"
                            );
                            setDepartment(
                              e.department || "未記載"
                            );
                          }}
                        >
                          <Pencil size={16} />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 確認モーダル */}
      {modalType && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-title">確認</div>
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
                      : "/attendance/break-end"
                  )
                }
              >
                確定
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
