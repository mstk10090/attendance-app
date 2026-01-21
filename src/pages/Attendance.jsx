import React from "react";
import AttendanceRecord from "./AttendanceRecord";
import { Clock } from "lucide-react";
import "../App.css";

export default function Attendance() {
  return (
    <div className="page-bg">
      <div className="page-container">
        <div className="page-title">
          <h1>出退勤入力</h1>
        </div>

        <AttendanceRecord />
      </div>
    </div>
  );
}
