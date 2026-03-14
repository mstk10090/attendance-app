import React from "react";
import { BookOpen, CheckCircle, Clock, MapPin, Briefcase, FileText, AlertCircle } from "lucide-react";

export default function StaffManual() {
    return (
        <div className="staff-manual-container" style={{ paddingBottom: "100px", maxWidth: "800px", margin: "0 auto" }}>
            <div className="card">
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "24px", borderBottom: "1px solid #eee", paddingBottom: "16px" }}>
                    <BookOpen size={28} color="#1976d2" />
                    <h2 style={{ fontSize: "1.5rem", fontWeight: "bold", margin: 0 }}>操作マニュアル</h2>
                </div>

                {/* Section 1: 出退勤入力 */}
                <div className="manual-section" style={{ marginBottom: "40px" }}>
                    <h3 style={{ fontSize: "1.2rem", fontWeight: "bold", borderLeft: "4px solid #1976d2", paddingLeft: "10px", marginBottom: "16px", color: "#1976d2" }}>
                        1. 出退勤入力
                    </h3>
                    <p style={{ marginBottom: "16px", lineHeight: "1.6", color: "#374151" }}>
                        日々の出勤・退勤を記録する画面です。
                    </p>
                    <div style={{ background: "#f9fafb", padding: "16px", borderRadius: "8px" }}>
                        <ul style={{ listStyleType: "disc", paddingLeft: "24px", color: "#4b5563", display: "flex", flexDirection: "column", gap: "12px" }}>
                            <li>
                                <strong>出勤・退勤打刻:</strong>
                                「出勤」「退勤」ボタンを押して打刻します。<br />
                                <span style={{ fontSize: "0.9rem", color: "#666" }}>※シフトより遅れた場合や早く帰る場合は、理由を選択して申請してください。</span>
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
                            </li>
                        </ul>
                    </div>
                </div>

                {/* Section 2: レポート（自分で修正・提出） */}
                <div className="manual-section" style={{ marginBottom: "40px" }}>
                    <h3 style={{ fontSize: "1.2rem", fontWeight: "bold", borderLeft: "4px solid #10b981", paddingLeft: "10px", marginBottom: "16px", color: "#10b981" }}>
                        2. レポート（勤務履歴の確認・修正）
                    </h3>
                    <p style={{ marginBottom: "16px", lineHeight: "1.6", color: "#374151" }}>
                        上部の「レポート」タブから、自分の勤務履歴を確認できます。
                    </p>

                    <div style={{ background: "#ecfdf5", padding: "14px 16px", borderRadius: "8px", border: "1px solid #a7f3d0", marginBottom: "16px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                            <CheckCircle size={18} color="#059669" />
                            <strong style={{ color: "#059669" }}>自分で修正・再提出ができます！</strong>
                        </div>
                        <p style={{ fontSize: "0.9rem", color: "#047857", margin: 0 }}>
                            打刻を間違えた場合や、管理者から再提出を求められた場合は、レポートから該当日をタップして修正・再提出してください。管理者への連絡は不要です。
                        </p>
                    </div>

                    <div style={{ background: "#f9fafb", padding: "16px", borderRadius: "8px" }}>
                        <ul style={{ listStyleType: "disc", paddingLeft: "24px", color: "#4b5563", display: "flex", flexDirection: "column", gap: "12px" }}>
                            <li>
                                <strong>勤務履歴の確認:</strong>
                                月ごとの出勤・退勤時刻、実働時間、ステータス（承認待ち・承認済みなど）を確認できます。
                            </li>
                            <li>
                                <strong>修正・再提出の方法:</strong>
                                該当日の行をタップ → 出勤時間・退勤時間を修正 → 「保存」ボタンを押すだけで再提出されます。
                            </li>
                            <li>
                                <strong>再提出依頼がある場合:</strong>
                                出退勤入力画面の上部に通知が表示されます。レポートタブへ移動して、指定された日付を修正してください。
                            </li>
                        </ul>
                    </div>
                </div>

                {/* Section 3: マイページ */}
                <div className="manual-section" style={{ marginBottom: "40px" }}>
                    <h3 style={{ fontSize: "1.2rem", fontWeight: "bold", borderLeft: "4px solid #6366f1", paddingLeft: "10px", marginBottom: "16px", color: "#6366f1" }}>
                        3. マイページ
                    </h3>
                    <p style={{ marginBottom: "16px", lineHeight: "1.6", color: "#374151" }}>
                        自分のアカウント情報や勤務地の設定を確認・変更できます。
                    </p>
                </div>

                {/* Section 4: 注意事項 */}
                <div className="manual-section">
                    <h3 style={{ fontSize: "1.2rem", fontWeight: "bold", borderLeft: "4px solid #f59e0b", paddingLeft: "10px", marginBottom: "16px", color: "#f59e0b" }}>
                        4. 注意事項
                    </h3>
                    <div style={{ background: "#fffbeb", border: "1px solid #fde68a", padding: "16px", borderRadius: "8px" }}>
                        <ul style={{ listStyleType: "disc", paddingLeft: "24px", color: "#92400e", display: "flex", flexDirection: "column", gap: "10px", fontSize: "0.95rem" }}>
                            <li>退勤打刻を忘れた場合、レポートから退勤時間を入力して提出できます。</li>
                            <li>遅刻・早退がある場合は、理由を選択して申請してください。</li>
                            <li>出張申請は一度申請すると管理者画面に即座に反映されます。同日の重複申請はできません。</li>
                        </ul>
                    </div>
                </div>

            </div>
        </div>
    );
}
