import React from "react";
import AttendanceRecord from "./AttendanceRecord";
import { Clock } from "lucide-react";

export default function Attendance() {
  return (
    <div className="bg-gray-100 min-h-screen">
      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="flex items-center gap-3 mb-8">
          
          
        </div>

        <AttendanceRecord />
      </div>
    </div>
  );
}
