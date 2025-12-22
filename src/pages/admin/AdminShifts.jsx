// src/pages/admin/AdminShifts.jsx
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

const SHIFT_API_URL =
  "https://cma9brof8g.execute-api.ap-northeast-1.amazonaws.com/prod/shiftrequests";

const pad2 = (n) => (n < 10 ? `0${n}` : String(n));

export default function AdminShifts() {
  const [allItems, setAllItems] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [fetchError, setFetchError] = useState("");

  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const navigate = useNavigate();

  useEffect(() => {
    const fetchAllShifts = async () => {
      setIsLoading(true);
      setFetchError("");

      try {
        // userId なし = 全件取得
        const url = `${SHIFT_API_URL}`;
        console.log("AdminShifts Calendar GET:", url);

        const res = await fetch(url);
        const text = await res.text();
        console.log("AdminShifts raw response:", text);

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

        console.log("AdminShifts parsed:", data);

        if (!data || !Array.isArray(data.items)) {
          setFetchError("シフト情報の取得に失敗しました");
          setAllItems([]);
          setIsLoading(false);
          return;
        }

        const sorted = [...data.items].sort((a, b) => {
          if (a.date < b.date) return -1;
          if (a.date > b.date) return 1;
          return 0;
        });

        setAllItems(sorted);
        setIsLoading(false);
      } catch (err) {
        console.error("AdminShifts fetch error:", err);
        setFetchError("シフト情報の取得中にエラーが発生しました");
        setAllItems([]);
        setIsLoading(false);
      }
    };

    fetchAllShifts();
  }, []);

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth(); // 0〜11
  const monthStr = `${year}-${pad2(month + 1)}`;

  const monthItems = allItems.filter((it) => it.date.startsWith(monthStr));
  const shiftsByDate = monthItems.reduce((map, it) => {
    if (!map[it.date]) map[it.date] = [];
    map[it.date].push(it);
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

  const handleClickDate = (day) => {
    if (!day) return;
    const dStr = `${year}-${pad2(month + 1)}-${pad2(day)}`;
    navigate(`/admin/shifts/${dStr}`);
  };

  return (
    <div style={{ padding: "24px 0" }}>
      <h2 style={{ marginBottom: 8 }}>管理者用：シフト一覧（カレンダー）</h2>
      <p style={{ marginBottom: 16, color: "#555" }}>
        カレンダー上の日付をクリックすると、その日の希望シフト一覧へ移動します。
      </p>

      {isLoading && <p>読み込み中です...</p>}
      {fetchError && <p style={{ color: "red" }}>{fetchError}</p>}

      {!isLoading && !fetchError && (
        <div
          style={{
            width: "100%",               // ★ 画面横幅いっぱい
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
                カレンダー上の日付をクリックすると、その日の希望シフト一覧へ移動します。
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

              const dStr = `${year}-${pad2(month + 1)}-${pad2(day)}`;
              const count = shiftsByDate[dStr]?.length ?? 0;
              const hasShift = count > 0;

              const dateObj = new Date(year, month, day);
              const dow = dateObj.getDay(); // 0=Sun

              // ★ 日付数字の色を 日=赤, 土=青 に
              let dateColor = "#333";
              if (dow === 0) dateColor = "#d32f2f";
              else if (dow === 6) dateColor = "#1976d2";

              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleClickDate(day)}
                  style={{
                    height: 90,
                    borderRadius: 8,
                    border: "1px solid #e0e0e0",
                    background: hasShift ? "#e3f2fd" : "#ffffff",
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
                      color: dateColor, // ★ ここで反映
                    }}
                  >
                    {day}
                  </div>
                  {hasShift && (
                    <div
                      style={{
                        fontSize: 11,
                        color: "#1976d2",
                        marginTop: "auto",
                      }}
                    >
                      希望 {count} 件
                    </div>
                  )}
                </button>
              );
            })}
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
