// src/pages/Home.jsx
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

const dayNames = ["日", "月", "火", "水", "木", "金", "土"];

// スタッフ一覧
const staffList = [
  "眞葛",
  "小河原（愛）",
  "佐々木",
  "山本",
  "柳",
  "平松（菜）",
  "伊佐",
  "山田",
  "内田",
  "平松（陽）",
  "村上",
  "吉田",
  "三浦（あ）",
  "小野",
  "西川",
  "伊藤",
  "竹中",
  "黒宮",
  "冨工",
  "長田",
  "梶原",
  "川嶋",
  "須田",
  "橋本",
  "庵原",
];

// 勤務区分
const LOCATION_OPTIONS = [
  { value: "即日", label: "即日" },
  { value: "買取", label: "買取" },
  { value: "広告", label: "広告" },
];

// 勤務区分ごとのダミー確定シフト
// 「何日に出勤しているか」を適当に設定
const sampleShiftsByLocation = {
  即日: {
    "眞葛":       [1, 2, 5, 8, 10, 15, 20],
    "小河原（愛）": [3, 4, 5, 12, 18, 25],
    "佐々木":     [1, 7, 14, 21, 28],
    "山本":       [2, 9, 16, 23],
    "柳":         [5, 10, 20],
    "平松（菜）":  [6, 13, 27],
  },
  買取: {
    "眞葛":       [3, 6, 9],
    "佐々木":     [10, 20],
    "山田":       [5, 15, 25],
    "内田":       [8, 18],
  },
  広告: {
    "眞葛":       [5, 25],
    "山本":       [8, 18],
    "村上":       [7, 14, 21],
    "吉田":       [4, 11, 19],
  },
};

export default function Home() {
  const navigate = useNavigate();

  const today = new Date();
  const [monthOffset, setMonthOffset] = useState(0); // 0: 今月, -1: 先月 …
  const [selectedLocation, setSelectedLocation] = useState("即日");

  // 表示中の年月
  const baseDate = new Date(
    today.getFullYear(),
    today.getMonth() + monthOffset,
    1
  );
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth(); // 0 = 1月

  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const days = Array.from({ length: daysInMonth }, (_, i) => {
    const date = new Date(year, month, i + 1);
    return {
      day: i + 1,
      weekdayIndex: date.getDay(),
    };
  });

  // 現在選択中の勤務地のシフトデータ
  const currentShifts = sampleShiftsByLocation[selectedLocation] || {};

  // ── その月に一度でも出勤しているスタッフだけを残す ──
  const workingStaffList = staffList.filter((name) => {
    const days = currentShifts[name];
    return Array.isArray(days) && days.length > 0;
  });

  // あるスタッフがその日に入っているかどうか
  const isWorking = (name, day) => currentShifts[name]?.includes(day);

  // 各日の人数をカウント（出勤があるスタッフのみ対象）
  const countWorkersForDay = (day) =>
    workingStaffList.filter((name) => isWorking(name, day)).length;

  // 月移動（未来の月には進めない）
  const handlePrevMonth = () => {
    setMonthOffset((prev) => prev - 1);
  };

  const handleNextMonth = () => {
    setMonthOffset((prev) => {
      if (prev >= 0) return prev; // これ以上未来へは進まない（今月まで）
      return prev + 1;
    });
  };

  const canGoNext = monthOffset < 0; // true のときだけ「次の月」ボタンを有効

  const isToday = (d) => {
    return (
      year === today.getFullYear() &&
      month === today.getMonth() &&
      d === today.getDate()
    );
  };

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

      <div className="shift-grid-container">
        <div className="shift-grid">
          {/* 日付ヘッダー行（クリックで詳細へ） */}
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
                ? { backgroundColor: "#fff9c4" } // 今日だけ薄い黄色
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

          {/* 各スタッフの行（この勤務地で1回でも出勤がある人だけ表示） */}
          {workingStaffList.map((name) => (
            <div className="shift-row" key={name}>
              <div className="shift-row-label">{name}</div>
              {days.map((d) => {
                const working = isWorking(name, d.day);
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

          {/* 該当スタッフがいない場合のメッセージ（念のため） */}
          {workingStaffList.length === 0 && (
            <div style={{ padding: "12px", color: "#777" }}>
              この月は {selectedLocation} の確定シフトが登録されていません。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
