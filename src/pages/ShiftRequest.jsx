// src/pages/ShiftRequest.jsx
import React, { useState, useEffect } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";

const API_URL =
  "https://cma9brof8g.execute-api.ap-northeast-1.amazonaws.com/prod/shiftrequests";

const LOCATION_OPTIONS = [
  { value: "ALL", label: "全体" },
  { value: "即日", label: "即日" },
  { value: "買取", label: "買取" },
  { value: "広告", label: "広告" },
];

// location が無い古いデータは「即日」とみなす
const normalizeLocation = (loc) => (loc && loc !== "" ? loc : "即日");

// 勤務地ごとの色
const getLocationColor = (loc) => {
  const l = normalizeLocation(loc);
  if (l === "即日") return "#1976d2"; // 青
  if (l === "買取") return "#e53935"; // 赤
  if (l === "広告") return "#fdd835"; // 黄
  return undefined;
};

export default function ShiftRequest() {
  const [selectedLocation, setSelectedLocation] = useState("ALL");
  const [items, setItems] = useState([]); // API からの生データ
  const [selectedDate, setSelectedDate] = useState(null);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [comment, setComment] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [formLocation, setFormLocation] = useState("即日");

  const storedUserId = localStorage.getItem("userId");
  const userId =
    storedUserId && storedUserId.trim() !== "" ? storedUserId.trim() : null;

  // ===== GET: ユーザーの全シフトを取得 =====
  useEffect(() => {
    const fetchRequests = async () => {
      if (!userId) {
        console.warn("userId がないためシフト取得をスキップします");
        return;
      }
      const url = `${API_URL}?userId=${encodeURIComponent(userId)}`;
      try {
        console.log("Fetching(GET):", url);
        const res = await fetch(url);
        const text = await res.text();
        console.log("GET raw:", text);

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
            console.error("JSON parse error (body):", e, outer.body);
            data = null;
          }
        } else {
          data = outer;
        }

        console.log("GET Parsed:", data);

        if (!data || !Array.isArray(data.items)) {
          setItems([]);
          return;
        }

        setItems(data.items);
      } catch (err) {
        console.error("GET error:", err);
      }
    };

    fetchRequests();
  }, [userId]);

  // 選択中勤務地のデータだけを抽出
  const locationItems =
    selectedLocation === "ALL"
      ? items // 全部表示
      : items.filter(
        (it) => normalizeLocation(it.location) === selectedLocation
      );

  // FullCalendar 用イベント（即日=青、買取=赤、広告=黄を常に適用）
  const events = locationItems.map((it) => {
    const loc = normalizeLocation(it.location);
    const color = getLocationColor(loc);

    return {
      id: `${it.date}-${loc}`,
      title: it.startTime && it.endTime ? `${it.startTime}〜${it.endTime}` : "",
      start: it.date,
      allDay: true,
      ...(color ? { color } : {}),
    };
  });

  // カレンダークリック時
  const handleDateClick = (info) => {
    const dateStr = info.dateStr;
    setSelectedDate(dateStr);

    // その日のレコードを1件拾う（ALL のときも含めて items 全体から探す）
    const existing = items.find((it) => it.date === dateStr);

    if (existing) {
      setStartTime(existing.startTime || "09:00");
      setEndTime(existing.endTime || "17:00");
      setComment(existing.comment || "");

      // 既存データの勤務地をフォームに反映
      const loc = normalizeLocation(existing.location);
      setFormLocation(loc || "即日");
    } else {
      setStartTime("09:00");
      setEndTime("17:00");
      setComment("");

      // 新規の場合：画面上部の選択中勤務地を初期値に
      if (selectedLocation === "ALL") {
        setFormLocation("即日"); // 全体のときはデフォルト即日
      } else {
        setFormLocation(selectedLocation);
      }
    }

    setIsDialogOpen(true);
  };

  // 保存（POST）
  const handleSave = async (e) => {
    e.preventDefault();
    if (!selectedDate) return;

    if (!userId) {
      alert("ログイン情報が取得できません。もう一度ログインし直してください。");
      return;
    }

    const payload = {
      userId,
      date: selectedDate,
      startTime,
      endTime,
      comment,
      location: formLocation,
    };

    try {
      console.log("POST payload:", payload);
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const text = await res.text();
      console.log("POST response raw:", text);

      let outer = null;
      let data = null;
      try {
        outer = text ? JSON.parse(text) : null;
      } catch (e) {
        console.error("JSON parse error (outer, POST):", e, text);
      }
      if (outer && typeof outer === "object" && outer.body) {
        try {
          data = JSON.parse(outer.body);
        } catch (e) {
          console.error("JSON parse error (body, POST):", e, outer.body);
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
        alert((data && data.message) || "シフトの保存に失敗しました。");
        return;
      }

      const savedItem = (data && data.item) || payload;

      // 同じ日付＆勤務地の既存データを置き換え
      setItems((prev) => {
        const others = prev.filter(
          (it) =>
            !(
              it.date === selectedDate &&
              normalizeLocation(it.location) === selectedLocation
            )
        );
        return [...others, savedItem];
      });

      setIsDialogOpen(false);
    } catch (err) {
      console.error("POST error:", err);
      alert("通信エラーが発生しました");
    }
  };

  // 削除（DELETE）
  const handleDelete = async () => {
    if (!selectedDate) return;

    if (!userId) {
      alert("ログイン情報が取得できません。もう一度ログインし直してください。");
      return;
    }
    if (
      !window.confirm(
        `${selectedDate} の ${selectedLocation} の希望シフトを削除しますか？`
      )
    ) {
      return;
    }

    const payload = {
      userId,
      date: selectedDate,
      location: selectedLocation,
    };

    try {
      console.log("DELETE payload:", payload);
      const res = await fetch(API_URL, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const text = await res.text();
      console.log("DELETE response raw:", text);

      let outer = null;
      try {
        outer = text ? JSON.parse(text) : null;
      } catch (e) {
        console.error("JSON parse error (outer, DELETE):", e, text);
      }

      const statusCode =
        outer && typeof outer.statusCode === "number"
          ? outer.statusCode
          : res.status;

      if (statusCode !== 200) {
        alert("削除に失敗しました");
        return;
      }

      // state から削除
      setItems((prev) =>
        prev.filter(
          (it) =>
            !(
              it.date === selectedDate &&
              normalizeLocation(it.location) === selectedLocation
            )
        )
      );

      setIsDialogOpen(false);
    } catch (err) {
      console.error("DELETE error:", err);
      alert("通信エラーが発生しました");
    }
  };

  return (
    <div>
      <h2>希望シフト</h2>
      <p style={{ marginBottom: "8px" }}>
        勤務地を選択して、日付をクリックすると希望時間とコメントを入力できます。
      </p>

      {/* 勤務地ドロップダウン */}
      <div style={{ marginBottom: "12px" }}>
        <label>
          勤務地：
          <select
            value={selectedLocation}
            onChange={(e) => setSelectedLocation(e.target.value)}
            style={{ marginLeft: "8px", padding: "4px 8px" }}
          >
            {LOCATION_OPTIONS.map((loc) => (
              <option key={loc.value} value={loc.value}>
                {loc.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <FullCalendar
        plugins={[dayGridPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        locale="ja"
        height="auto"
        headerToolbar={{
          left: "prev,next today",
          center: "title",
          right: "",
        }}
        weekends={true}
        events={events}
        dateClick={handleDateClick}
      />

      {/* 入力ダイアログ */}
      {isDialogOpen && (
        <div className="request-dialog-backdrop">
          <div className="request-dialog">
            <h3>希望シフト入力（{selectedLocation}）</h3>
            <p style={{ marginBottom: "8px" }}>
              {selectedDate} の希望を入力してください。
            </p>

            <form onSubmit={handleSave}>
              <div className="request-form-row">
                <label>勤務地</label>
                <select
                  value={formLocation}
                  onChange={(e) => setFormLocation(e.target.value)}
                >
                  <option value="即日">即日</option>
                  <option value="買取">買取</option>
                  <option value="広告">広告</option>
                </select>
              </div>
              <div className="request-form-row">
                <label>開始時間</label>
                <input
                  type="time"
                  list="time-list"
                  step="1800"
                  min="07:00"
                  max="22:00"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  required
                />
              </div>

              <div className="request-form-row">
                <label>終了時間</label>
                <input
                  type="time"
                  list="time-list"
                  step="1800"
                  min="07:00"
                  max="22:00"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  required
                />
              </div>

              <datalist id="time-list">
                {[
                  "07:00",
                  "07:30",
                  "08:00",
                  "08:30",
                  "09:00",
                  "09:30",
                  "10:00",
                  "10:30",
                  "11:00",
                  "11:30",
                  "12:00",
                  "12:30",
                  "13:00",
                  "13:30",
                  "14:00",
                  "14:30",
                  "15:00",
                  "15:30",
                  "16:00",
                  "16:30",
                  "17:00",
                  "17:30",
                  "18:00",
                  "18:30",
                  "19:00",
                  "19:30",
                  "20:00",
                  "20:30",
                  "21:00",
                  "21:30",
                  "22:00",
                ].map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>

              <div className="request-form-row">
                <label>コメント</label>
                <textarea
                  rows={3}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="例：この日は別店舗の応援も可能です など"
                />
              </div>

              <div className="request-form-actions">
                <button
                  type="button"
                  onClick={() => setIsDialogOpen(false)}
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  style={{
                    background: "#d32f2f",
                    color: "#fff",
                    borderColor: "#d32f2f",
                  }}
                >
                  削除
                </button>
                <button type="submit">保存</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
