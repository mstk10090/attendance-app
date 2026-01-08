import React, { useEffect, useState } from "react";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { Search } from "lucide-react";
import "../../App.css";

const API_BASE =
  "https://lfsu60xvw7.execute-api.ap-northeast-1.amazonaws.com";

export default function AdminAttendance() {
  /* =========================
     State
  ========================= */
  const [date, setDate] = useState(
    format(new Date(), "yyyy-MM-dd")
  );
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  /* =========================
     時間ユーティリティ
  ========================= */
  const toMin = (t) => {
    const [h, m, s] = t.split(":").map(Number);
    return h * 60 + m + s / 60;
  };

  const calcBreakTime = (e) => {
    if (!e.breaks || e.breaks.length === 0) return "-";
    let total = 0;
    e.breaks.forEach((b) => {
      if (b.start && b.end) {
        total += toMin(b.end) - toMin(b.start);
      }
    });
    return total > 0
      ? `${Math.floor(total / 60)}時間${Math.round(total % 60)}分`
      : "-";
  };

  const calcWorkTime = (e) => {
    if (!e.clockIn || !e.clockOut) return "-";
    let total = toMin(e.clockOut) - toMin(e.clockIn);
    (e.breaks || []).forEach((b) => {
      if (b.start && b.end) {
        total -= toMin(b.end) - toMin(b.start);
      }
    });
    return total > 0
      ? `${Math.floor(total / 60)}時間${Math.round(total % 60)}分`
      : "-";
  };

  /* =========================
     勤怠取得
  ========================= */
  const fetchAttendances = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/admin/attendance?date=${date}`
      );
      const data = await res.json();

      if (!data.success) {
        setItems([]);
        setError(data.message || "取得に失敗しました");
        return;
      }

      setItems(data.items || []);
    } catch (e) {
      setError("通信エラーが発生しました");
    } finally {
      setLoading(false);
    }
  };

  /* =========================
     初期ロード
  ========================= */
  useEffect(() => {
    fetchAttendances();
    // eslint-disable-next-line
  }, []);

  /* =========================
     JSX
  ========================= */
  return (
    <>
      <div className="card">
        <div className="card-title">管理者 勤怠確認</div>

        {/* 日付検索 */}
        <div className="button-row">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="input"
          />
          <button
            className="btn btn-blue"
            onClick={fetchAttendances}
            disabled={loading}
          >
            <Search size={18} /> 検索
          </button>
        </div>

        {loading && <p>読み込み中...</p>}
        {error && <p style={{ color: "red" }}>{error}</p>}
      </div>

      {/* 一覧 */}
      <div className="card">
        <div className="card-title">
          {format(new Date(date), "yyyy年M月d日(E)", {
            locale: ja,
          })}
          の勤怠
        </div>

        {items.length === 0 ? (
          <p className="empty-text">勤怠データがありません</p>
        ) : (
          <div className="table-wrap">
            <table>
  <thead>
    <tr>
      <th>氏名</th>
      <th>勤務開始</th>
      <th>勤務終了</th>
      <th>休憩時間</th>
      <th>勤務時間</th>
      <th>コメント</th>
    </tr>
  </thead>
  <tbody>
    {items.map((a) => (
      <tr key={`${a.userId}-${a.workDate}`}>
        <td>{a.userName}</td>
        <td>{a.clockIn ?? "-"}</td>
        <td>{a.clockOut ?? "-"}</td>
        <td>{calcBreakTime(a)}</td>
        <td>{calcWorkTime(a)}</td>
        <td>{a.comment ?? "-"}</td>
      </tr>
    ))}
  </tbody>
</table>
          </div>
        )}
      </div>
    </>
  );
}
