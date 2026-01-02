import React, { useEffect, useState } from "react";
import { Clock, LogIn, LogOut } from "lucide-react";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import "../App.css";

/* =========================
 API 設定
 ========================= */
const API_BASE =
  "https://lfsu60xvw7.execute-api.ap-northeast-1.amazonaws.com";
const USER_ID = "user-001"; // 今は固定（後で認証に置き換え）

export default function AttendanceRecord() {
  const [attendances, setAttendances] = useState([]);
  const [currentClockIn, setCurrentClockIn] = useState(null);
  const [modalType, setModalType] = useState(null); // "in" | "out"
  const [loading, setLoading] = useState(false);

  /* =========================
   初期ロード（DB → React）
   ========================= */
  const loadAttendances = async () => {
    try {
      const res = await fetch(
        `${API_BASE}/attendance?userId=${USER_ID}`
      );
      const data = await res.json();

      if (data.success) {
        setAttendances(data.items);

        const today = format(new Date(), "yyyy-MM-dd");
        const todayRecord = data.items.find(
          a => a.workDate === today
        );

        if (todayRecord?.clockIn && !todayRecord.clockOut) {
          setCurrentClockIn(todayRecord.clockIn);
        } else {
          setCurrentClockIn(null);
        }
      }
    } catch (e) {
      console.error("初期ロード失敗", e);
    }
  };

  useEffect(() => {
    loadAttendances();
  }, []);

  /* =========================
   出勤
   ========================= */
  const confirmClockIn = async () => {
    setLoading(true);
    try {
      await fetch(`${API_BASE}/attendance/clock-in`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: USER_ID })
      });

      await loadAttendances();
      setModalType(null);
    } catch (e) {
      alert("出勤に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  /* =========================
   退勤
   ========================= */
  const confirmClockOut = async () => {
    setLoading(true);
    try {
      await fetch(`${API_BASE}/attendance/clock-out`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: USER_ID })
      });

      await loadAttendances();
      setModalType(null);
    } catch (e) {
      alert("退勤に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  /* =========================
   勤務時間計算
   ========================= */
  const calcHours = e => {
    if (!e.clockIn || !e.clockOut) return "-";
    const toMin = t => {
      const [h, m, s] = t.split(":").map(Number);
      return h * 60 + m + s / 60;
    };
    const diff = toMin(e.clockOut) - toMin(e.clockIn);
    return diff > 0
      ? `${Math.floor(diff / 60)}時間${Math.round(diff % 60)}分`
      : "-";
  };

  /* =========================
   月次集計
   ========================= */
  const getMonthlySummary = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();

    let total = 0;
    let days = 0;

    attendances.forEach(a => {
      const d = new Date(a.workDate);
      if (
        d.getFullYear() === y &&
        d.getMonth() === m &&
        a.clockIn &&
        a.clockOut
      ) {
        const toMin = t => {
          const [h, mi, s] = t.split(":").map(Number);
          return h * 60 + mi + s / 60;
        };
        const diff = toMin(a.clockOut) - toMin(a.clockIn);
        if (diff > 0) {
          total += diff;
          days++;
        }
      }
    });

    return {
      days,
      hours: Math.floor(total / 60),
      minutes: Math.round(total % 60)
    };
  };

  const summary = getMonthlySummary();

  /* =========================
   JSX
   ========================= */
  return (
    <>
      {/* 出退勤カード */}
      <div className="card">
        <div className="card-title">
          <Clock size={20} /> 出退勤記録
        </div>

        <div className="button-row">
          <button
            className={`btn ${
              currentClockIn ? "btn-disabled" : "btn-green"
            }`}
            disabled={!!currentClockIn || loading}
            onClick={() => setModalType("in")}
          >
            <LogIn size={20} /> 出勤
          </button>

          <button
            className={`btn ${
              currentClockIn ? "btn-red" : "btn-disabled"
            }`}
            disabled={!currentClockIn || loading}
            onClick={() => setModalType("out")}
          >
            <LogOut size={20} /> 退勤
          </button>
        </div>

        {currentClockIn && (
          <div className="working">
            出勤中：{currentClockIn}
          </div>
        )}
      </div>

      {/* 月次集計 */}
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

      {/* 勤務履歴 */}
      <div className="card">
        <div className="card-title">勤務履歴</div>

        {attendances.length === 0 ? (
          <div className="empty-text">まだ記録がありません</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>日付</th>
                  <th>出勤</th>
                  <th>退勤</th>
                  <th>勤務時間</th>
                </tr>
              </thead>
              <tbody>
                {attendances.map(e => (
                  <tr key={`${e.userId}-${e.workDate}`}>
                    <td>
                      {format(
                        new Date(e.workDate),
                        "yyyy年M月d日(E)",
                        { locale: ja }
                      )}
                    </td>
                    <td>{e.clockIn || "-"}</td>
                    <td>{e.clockOut || "-"}</td>
                    <td>{calcHours(e)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 確認モーダル */}
      {modalType && (
        <div
          className="modal-overlay"
          onClick={() => setModalType(null)}
        >
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">
              {modalType === "in" ? "出勤確認" : "退勤確認"}
            </div>

            <div className="modal-text">
              {modalType === "in"
                ? "出勤します。よろしいですか？"
                : "退勤します。よろしいですか？"}
            </div>

            <div className="modal-actions">
              <button
                className="modal-btn modal-cancel"
                onClick={() => setModalType(null)}
              >
                キャンセル
              </button>
              <button
                className={`modal-btn ${
                  modalType === "in"
                    ? "modal-confirm-green"
                    : "modal-confirm-red"
                }`}
                onClick={
                  modalType === "in"
                    ? confirmClockIn
                    : confirmClockOut
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
