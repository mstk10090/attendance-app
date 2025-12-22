// src/pages/ShiftRequest.jsx
import React, { useState, useEffect } from "react";

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
  return "#1976d2";
};

const pad2 = (n) => (n < 10 ? `0${n}` : String(n));

export default function ShiftRequest() {
  const [selectedLocation, setSelectedLocation] = useState("ALL");
  const [items, setItems] = useState([]); // API からの生データ

  const [selectedDate, setSelectedDate] = useState(null);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [comment, setComment] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [formLocation, setFormLocation] = useState("即日");

  // カレンダー表示中の年月
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

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

  // ===== カレンダー表示用データ整形 =====
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth(); // 0〜11
  const monthStr = `${year}-${pad2(month + 1)}`;

  const monthItems = items.filter((it) => it.date.startsWith(monthStr));

  // 日付ごとにまとめる
  const dataByDate = monthItems.reduce((map, it) => {
    const loc = normalizeLocation(it.location);
    const key = it.date;
    if (!map[key]) map[key] = [];
    map[key].push({ ...it, loc });
    return map;
  }, {});

  const firstDayOfWeek = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const calendarCells = [];
  for (let i = 0; i < firstDayOfWeek; i++) calendarCells.push(null);
  for (let d = 1; d <= daysInMonth; d++) calendarCells.push(d);
  while (calendarCells.length % 7 !== 0) calendarCells.push(null);

  const handlePrevMonth = () => {
    setCurrentMonth(
      (prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1)
    );
  };
  const handleNextMonth = () => {
    setCurrentMonth(
      (prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1)
    );
  };

  // ===== 日付クリック → ダイアログ表示 =====
  const openDialogForDate = (dateStr) => {
    setSelectedDate(dateStr);

    let target;
    if (selectedLocation === "ALL") {
      target = items.find((it) => it.date === dateStr) || null;
    } else {
      target = items.find(
        (it) =>
          it.date === dateStr &&
          normalizeLocation(it.location) === selectedLocation
      );
    }

    if (target) {
      setStartTime(target.startTime || "09:00");
      setEndTime(target.endTime || "17:00");
      setComment(target.comment || "");
      setFormLocation(normalizeLocation(target.location));
    } else {
      setStartTime("09:00");
      setEndTime("17:00");
      setComment("");
      if (selectedLocation === "ALL") {
        setFormLocation("即日");
      } else {
        setFormLocation(selectedLocation);
      }
    }

    setIsDialogOpen(true);
  };

  const handleClickDate = (day) => {
    if (!day) return;
    const dateStr = `${year}-${pad2(month + 1)}-${pad2(day)}`;
    openDialogForDate(dateStr);
  };

  // ===== 保存（POST） =====
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

      setItems((prev) => {
        // 同じ日付 & 同じ location を置き換え
        const others = prev.filter(
          (it) =>
            !(
              it.date === savedItem.date &&
              normalizeLocation(it.location) ===
                normalizeLocation(savedItem.location)
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

  // ===== 削除（DELETE） =====
  const handleDelete = async () => {
    if (!selectedDate) return;

    if (!userId) {
      alert("ログイン情報が取得できません。もう一度ログインし直してください。");
      return;
    }

    if (
      !window.confirm(
        `${selectedDate} の ${formLocation} の希望シフトを削除しますか？`
      )
    ) {
      return;
    }

    const payload = {
      userId,
      date: selectedDate,
      location: formLocation,
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

      setItems((prev) =>
        prev.filter(
          (it) =>
            !(
              it.date === selectedDate &&
              normalizeLocation(it.location) === formLocation
            )
        )
      );

      setIsDialogOpen(false);
    } catch (err) {
      console.error("DELETE error:", err);
      alert("通信エラーが発生しました");
    }
  };

  // ===== レンダリング =====
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

      {/* ==== AdminShifts と同じカード型カレンダー ==== */}
      <div
        style={{
          width: "100%",
          boxSizing: "border-box",
          background: "#ffffff",
          borderRadius: 12,
          boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
          padding: 24,
        }}
      >
        {/* ヘッダー */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 16,
          }}
        >
          <button onClick={handlePrevMonth} style={navBtnStyle} type="button">
            ◀
          </button>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: "bold" }}>
              {year}年 {month + 1}月
            </div>
            <div style={{ fontSize: 12, color: "#666" }}>
              カレンダー上の日付をクリックして、希望シフトを入力・編集できます。
            </div>
          </div>
          <button onClick={handleNextMonth} style={navBtnStyle} type="button">
            ▶
          </button>
        </div>

        {/* 曜日ヘッダ（日=赤, 土=青） */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
            marginBottom: 4,
            fontSize: 12,
            fontWeight: "bold",
            color: "#555",
          }}
        >
          {["日", "月", "火", "水", "木", "金", "土"].map((w, idx) => (
            <div
              key={w}
              style={{
                textAlign: "center",
                padding: "4px 0",
                color: idx === 0 ? "#d32f2f" : idx === 6 ? "#1976d2" : "#555",
              }}
            >
              {w}
            </div>
          ))}
        </div>

        {/* カレンダー本体 */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
            gap: 6,
          }}
        >
          {calendarCells.map((day, idx) => {
            if (!day) {
              return (
                <div
                  key={idx}
                  style={{
                    height: 90,
                    borderRadius: 8,
                    background: "#fafafa",
                  }}
                />
              );
            }

            const dateStr = `${year}-${pad2(month + 1)}-${pad2(day)}`;
            const list = dataByDate[dateStr] || [];

            // このセルに表示するレコード一覧
            const listForCell =
              selectedLocation === "ALL"
                ? list
                : list.filter(
                    (it) =>
                      normalizeLocation(it.loc) === selectedLocation
                  );

            const dateObj = new Date(year, month, day);
            const dow = dateObj.getDay(); // 0=Sun
            let dateColor = "#333";
            if (dow === 0) dateColor = "#d32f2f";
            else if (dow === 6) dateColor = "#1976d2";

            const hasAny = listForCell.length > 0;

            return (
              <button
                key={idx}
                type="button"
                onClick={() => handleClickDate(day)}
                style={{
                  height: 90,
                  borderRadius: 8,
                  border: "1px solid #e0e0e0",
                  background: hasAny ? "#e3f2fd" : "#ffffff",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  padding: "6px 8px",
                  transition: "box-shadow 0.15s, transform 0.1s",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.boxShadow =
                    "0 3px 6px rgba(0,0,0,0.12)";
                  e.currentTarget.style.transform = "translateY(-1px)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow =
                    "0 1px 2px rgba(0,0,0,0.04)";
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: "bold",
                    color: dateColor,
                  }}
                >
                  {day}
                </div>

                {/* 下側に、時間帯を勤務地ごとに色分けして表示 */}
                {listForCell.length > 0 && (
                  <div
                    style={{
                      marginTop: "auto",
                      width: "100%",
                      display: "flex",
                      flexDirection: "column",
                      gap: 2,
                    }}
                  >
                    {listForCell.slice(0, 3).map((it, i) => {
                      const color = getLocationColor(it.loc);
                      const loc = normalizeLocation(it.loc);
                      const locShort =
                        loc === "即日"
                          ? "即"
                          : loc === "買取"
                          ? "買取"
                          : loc === "広告"
                          ? "広"
                          : loc;

                      const label =
                        it.startTime && it.endTime
                          ? `${it.startTime}〜${it.endTime}`
                          : "希望あり";

                      return (
                        <div
                          key={i}
                          style={{
                            fontSize: 10,
                            color: "#fff",
                            backgroundColor: color,
                            borderRadius: 4,
                            padding: "1px 4px",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {selectedLocation === "ALL"
                            ? `[${locShort}] ${label}`
                            : label}
                        </div>
                      );
                    })}

                    {listForCell.length > 3 && (
                      <div
                        style={{
                          fontSize: 10,
                          color: "#1976d2",
                        }}
                      >
                        +{listForCell.length - 3}件
                      </div>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 入力ダイアログ */}
      {isDialogOpen && (
        <div className="request-dialog-backdrop">
          <div className="request-dialog">
            <h3>希望シフト入力</h3>
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

const navBtnStyle = {
  border: "none",
  background: "#f5f5f5",
  padding: "6px 10px",
  borderRadius: 20,
  cursor: "pointer",
  fontSize: 14,
};
