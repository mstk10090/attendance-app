// src/pages/Home.jsx
import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";

const dayNames = ["日", "月", "火", "水", "木", "金", "土"];

const LOCATION_OPTIONS = [
  { value: "即日", label: "即日" },
  { value: "買取", label: "買取" },
  { value: "広告", label: "広告" },
];

// FixedShifts を返す API
const API_FIXED_SHIFTS_URL =
  "https://cma9brof8g.execute-api.ap-northeast-1.amazonaws.com/prod/fixedshifts";

export default function Home() {
  const navigate = useNavigate();

  const today = new Date();
  const [monthOffset, setMonthOffset] = useState(0); // 0: 今月, -1: 先月 …
  const [selectedLocation, setSelectedLocation] = useState("即日");

  // API からの確定シフトデータ
  const [fixedShifts, setFixedShifts] = useState([]); // { userId,userName,date,location,... }[]
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // ====== 確定シフト取得 ======
  useEffect(() => {
    const fetchFixedShifts = async () => {
      setLoading(true);
      setError("");

      try {
        const res = await fetch(API_FIXED_SHIFTS_URL);
        const text = await res.text();
        console.log("FixedShifts raw:", text);

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

        console.log("FixedShifts parsed:", data);

        if (!data || !Array.isArray(data.items)) {
          setFixedShifts([]);
        } else {
          setFixedShifts(data.items);
        }
      } catch (err) {
        console.error("FixedShifts fetch error:", err);
        setError("確定シフトの取得に失敗しました");
      } finally {
        setLoading(false);
      }
    };

    fetchFixedShifts();
  }, []);

  // ====== カレンダー関連 ======
  const baseDate = new Date(
    today.getFullYear(),
    today.getMonth() + monthOffset,
    1
  );
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth(); // 0 = 1月
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const days = useMemo(
    () =>
      Array.from({ length: daysInMonth }, (_, i) => {
        const date = new Date(year, month, i + 1);
        return {
          day: i + 1,
          weekdayIndex: date.getDay(),
        };
      }),
    [year, month, daysInMonth]
  );

  const isToday = (d) =>
    year === today.getFullYear() &&
    month === today.getMonth() &&
    d === today.getDate();

  const handlePrevMonth = () => {
    setMonthOffset((prev) => prev - 1);
  };

  const handleNextMonth = () => {
    setMonthOffset((prev) => {
      if (prev >= 0) return prev; // 今月より未来には進まない
      return prev + 1;
    });
  };

  const canGoNext = monthOffset < 0;

  // ====== この月＋この勤務地のシフトだけに絞り込み ======
  const monthStr = `${year}-${String(month + 1).padStart(2, "0")}`; // "2025-11"

  const filteredShifts = useMemo(
    () =>
      fixedShifts.filter((s) => {
        if (!s.date || !s.location) return false;
        if (s.location !== selectedLocation) return false;
        return String(s.date).startsWith(monthStr); // "2025-11-20" など
      }),
    [fixedShifts, selectedLocation, monthStr]
  );

  // スタッフ（userId 単位）ごとにまとめる
  const staffMap = useMemo(() => {
    const map = new Map(); // key: userId, value: { name, days:Set<number> }

    for (const s of filteredShifts) {
      const d = new Date(s.date);
      if (d.getFullYear() !== year || d.getMonth() !== month) continue;

      const day = d.getDate();
      if (!map.has(s.userId)) {
        map.set(s.userId, {
          name: s.userName || s.userId,
          days: new Set(),
        });
      }
      map.get(s.userId).days.add(day);
    }

    return map;
  }, [filteredShifts, year, month]);

  // 1回でも入っているスタッフだけのリスト
  const workingStaffList = Array.from(staffMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name, "ja")
  );

  // あるスタッフがその日に入っているか
  const isWorking = (staff, day) => staff.days.has(day);

  // 各日の人数
  const countWorkersForDay = (day) =>
    workingStaffList.filter((s) => isWorking(s, day)).length;

  return (
    <div className="shift-page">
      <h2>確定シフト</h2>

      {/* 月切り替え＋勤務区分ドロップダウン */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          marginBottom: "8px",
          flexWrap: "wrap",
        }}
      >
        <div>
          <button onClick={handlePrevMonth}>前の月</button>
          <span style={{ margin: "0 8px" }}>
            {year}年 {month + 1}月 のシフト
          </span>
          <button onClick={handleNextMonth} disabled={!canGoNext}>
            次の月
          </button>
        </div>

        <div>
          <label>
            勤務区分：
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
      </div>

      {loading && <div style={{ marginBottom: 8 }}>読み込み中...</div>}
      {error && (
        <div style={{ marginBottom: 8, color: "red" }}>{error}</div>
      )}

      <div className="shift-grid-container">
        <div className="shift-grid">
          {/* 日付ヘッダー行 */}
          <div className="shift-row shift-grid-header">
            <div className="shift-row-label" />
            {days.map((d) => {
              const w = dayNames[d.weekdayIndex];
              const weekdayClass =
                w === "土"
                  ? "shift-weekday sat"
                  : w === "日"
                  ? "shift-weekday sun"
                  : "shift-weekday";

              const dateStr = `${year}-${String(month + 1).padStart(
                2,
                "0"
              )}-${String(d.day).padStart(2, "0")}`;

              const todayStyle = isToday(d.day)
                ? { backgroundColor: "#fff9c4" }
                : {};

              return (
                <div
                  key={d.day}
                  className="shift-day-header shift-day-clickable"
                  style={todayStyle}
                  onClick={() => navigate(`/shift/${dateStr}`)}
                >
                  <div className={weekdayClass}>{w}</div>
                  <div className="shift-date">{d.day}</div>
                </div>
              );
            })}
          </div>

          {/* 人数 行 */}
          <div className="shift-row shift-grid-header shift-grid-header-people">
            <div className="shift-row-label">人数</div>
            {days.map((d) => {
              const count = countWorkersForDay(d.day);
              return (
                <div
                  key={d.day}
                  className={
                    count > 0 ? "shift-cell shift-cell-working" : "shift-cell"
                  }
                >
                  {count > 0 ? count : ""}
                </div>
              );
            })}
          </div>

          {/* 各スタッフの行 */}
          {workingStaffList.map((staff) => (
            <div className="shift-row" key={staff.name}>
              <div className="shift-row-label">{staff.name}</div>
              {days.map((d) => {
                const working = isWorking(staff, d.day);
                return (
                  <div
                    key={d.day}
                    className={
                      working ? "shift-cell shift-cell-working" : "shift-cell"
                    }
                  >
                    {working ? "✓" : ""}
                  </div>
                );
              })}
            </div>
          ))}

          {/* 誰もいない場合 */}
          {workingStaffList.length === 0 && !loading && (
            <div style={{ padding: "12px", color: "#777" }}>
              この月は {selectedLocation} の確定シフトが登録されていません。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
