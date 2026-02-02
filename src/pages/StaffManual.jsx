import React from "react";
import { BookOpen, CheckCircle, Clock, MapPin, Briefcase } from "lucide-react";

export default function StaffManual() {
    return (
        <div className="staff-manual-container" style={{ paddingBottom: "100px", maxWidth: "800px", margin: "0 auto" }}>
            <div className="card">
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "24px", borderBottom: "1px solid #eee", paddingBottom: "16px" }}>
                    <BookOpen size={28} color="#1976d2" />
                    <h2 style={{ fontSize: "1.5rem", fontWeight: "bold", margin: 0 }}>操作マニュアル (スタッフ用)</h2>
                </div>

                {/* Section 1: Attendance Input */}
                <div className="manual-section" style={{ marginBottom: "40px" }}>
                    <h3 style={{ fontSize: "1.2rem", fontWeight: "bold", borderLeft: "4px solid #1976d2", paddingLeft: "10px", marginBottom: "16px", color: "#1976d2" }}>
                        1. 出退勤入力
                    </h3>
                    <p style={{ marginBottom: "16px", lineHeight: "1.6", color: "#374151" }}>
                        日々の業務の開始・終了を記録する画面です。
                    </p>
                    <div style={{ background: "#f9fafb", padding: "16px", borderRadius: "8px" }}>
                        <ul style={{ listStyleType: "disc", paddingLeft: "24px", color: "#4b5563", display: "flex", flexDirection: "column", gap: "12px" }}>
                            <li>
                                <strong>出勤・退勤打刻:</strong>
                                その日のシフトが表示されている場合、実際の出勤・退勤時刻を入力し「出勤」または「退勤」ボタンを押してください。<br />
                                <span style={{ fontSize: "0.9rem", color: "#666" }}>※シフト予定より遅れる/早く帰る場合は、理由（寝坊、早退など）を選択してください。</span>
                            </li>
                            <li>
                                <strong>休憩入力:</strong>
                                休憩を取る際は「休憩開始」「休憩終了」ボタンを使用します。
                            </li>
                            <li>
                                <strong>出張・直行直帰の申請:</strong>
                                <div style={{ marginTop: "8px", display: "flex", alignItems: "center", gap: "6px" }}>
                                    <Briefcase size={16} /> <strong>出張申請ボタン</strong>
                                </div>
                                から、出張や直行直帰の申請を行えます。
                                日付、時間、行き先、コメントを入力して申請してください。
                                <br />
                                <span style={{ fontSize: "0.9rem", color: "#ef4444" }}>※同日の重複申請はできません。</span>
                            </li>
                        </ul>
                    </div>
                </div>

                {/* Section 2: My Page (History) */}
                <div className="manual-section" style={{ marginBottom: "40px" }}>
                    <h3 style={{ fontSize: "1.2rem", fontWeight: "bold", borderLeft: "4px solid #10b981", paddingLeft: "10px", marginBottom: "16px", color: "#10b981" }}>
                        2. マイページ (履歴確認)
                    </h3>
                    <p style={{ marginBottom: "16px", lineHeight: "1.6", color: "#374151" }}>
                        これまでの勤務履歴と、今月の集計を確認できます。
                    </p>
                    <div style={{ background: "#f9fafb", padding: "16px", borderRadius: "8px" }}>
                        <ul style={{ listStyleType: "disc", paddingLeft: "24px", color: "#4b5563", display: "flex", flexDirection: "column", gap: "12px" }}>
                            <li>
                                <strong>勤務履歴リスト:</strong>
                                日別の出勤・退勤時刻、休憩、実働時間を確認できます。<br />
                                「承認済」などのステータスもここで確認可能です。
                            </li>
                            <li>
                                <strong>給与概算:</strong>
                                設定された時給に基づき、現在の期間の概算給与が表示されます。
                            </li>
                        </ul>
                    </div>
                </div>

                <div className="manual-section">
                    <h3 style={{ fontSize: "1.2rem", fontWeight: "bold", borderLeft: "4px solid #8b5cf6", paddingLeft: "10px", marginBottom: "16px", color: "#8b5cf6" }}>
                        3. 注意事項
                    </h3>
                    <div style={{ background: "#fff", border: "1px solid #e5e7eb", padding: "16px", borderRadius: "8px" }}>
                        <p style={{ color: "#374151", marginBottom: "8px" }}>
                            <AlertTriangle size={16} style={{ display: "inline", marginRight: "4px", verticalAlign: "text-top", color: "#f59e0b" }} />
                            <strong>エラーや修正が必要な場合:</strong>
                        </p>
                        <p style={{ fontSize: "0.95rem", color: "#6b7280" }}>
                            打刻を忘れた場合や、時間を間違えた場合は、管理者に連絡して修正を依頼してください。<br />
                            出張申請は、一度申請すると管理者画面に即座に反映されます。
                        </p>
                    </div>
                </div>

            </div>
        </div>
    );
}
// Helper component for icon
function AlertTriangle({ size, style, color }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke={color || "currentColor"}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={style}
        >
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
            <line x1="12" y1="9" x2="12" y2="13"></line>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
        </svg>
    );
}
