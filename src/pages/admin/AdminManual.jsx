import React from "react";
import { BookOpen, CheckCircle, Users, Clock, AlertTriangle } from "lucide-react";

export default function AdminManual() {
    return (
        <div className="admin-container" style={{ paddingBottom: "100px", maxWidth: "1000px", margin: "0 auto" }}>
            <div className="card">
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "24px", borderBottom: "1px solid #eee", paddingBottom: "16px" }}>
                    <BookOpen size={28} color="#f59e0b" />
                    <h2 style={{ fontSize: "1.5rem", fontWeight: "bold", margin: 0 }}>操作マニュアル</h2>
                </div>

                <div className="manual-section" style={{ marginBottom: "40px" }}>
                    <h3 style={{ fontSize: "1.2rem", fontWeight: "bold", borderLeft: "4px solid #1976d2", paddingLeft: "10px", marginBottom: "16px", color: "#1976d2" }}>
                        1. 勤怠管理 (ダッシュボード)
                    </h3>
                    <p style={{ marginBottom: "16px", lineHeight: "1.6", color: "#374151" }}>
                        日々のスタッフの出退勤状況をリアルタイムで確認し、打刻の修正や承認を行う画面です。
                    </p>
                    <div style={{ background: "#f9fafb", padding: "16px", borderRadius: "8px" }}>
                        <ul style={{ listStyleType: "disc", paddingLeft: "24px", color: "#4b5563", display: "flex", flexDirection: "column", gap: "8px" }}>
                            <li>
                                <strong>表示モード切り替え:</strong> 「日次」「週次」「月次」ボタンで表示期間を切り替えられます。
                            </li>
                            <li>
                                <strong>カレンダー (月次):</strong>
                                <span style={{ fontSize: "12px", background: "#f0fdf4", color: "#15803d", padding: "2px 6px", borderRadius: "4px", margin: "0 4px" }}>緑</span>
                                は全承認済み、
                                <span style={{ fontSize: "12px", background: "#fef2f2", color: "#991b1b", padding: "2px 6px", borderRadius: "4px", margin: "0 4px" }}>赤</span>
                                は異常、
                                <span style={{ fontSize: "12px", background: "#fff7ed", color: "#c2410c", padding: "2px 6px", borderRadius: "4px", margin: "0 4px" }}>橙</span>
                                は承認待ちを表します。「未: X」バッジは未申請数です。
                            </li>
                            <li>
                                <strong>承認機能:</strong> 「承認待ち」のデータに対し、「承認」ボタンを押して確定させます。
                            </li>
                            <li>
                                <strong>修正機能:</strong> 誤った打刻や未入力のデータに対し、「修正」ボタンから時刻や休憩を直接編集できます。
                            </li>
                        </ul>
                    </div>
                </div>

                <div className="manual-section" style={{ marginBottom: "40px" }}>
                    <h3 style={{ fontSize: "1.2rem", fontWeight: "bold", borderLeft: "4px solid #10b981", paddingLeft: "10px", marginBottom: "16px", color: "#10b981" }}>
                        2. シフト管理
                    </h3>
                    <p style={{ marginBottom: "16px", lineHeight: "1.6", color: "#374151" }}>
                        シフトの予実管理を行う画面です。
                    </p>
                    <div style={{ background: "#f9fafb", padding: "16px", borderRadius: "8px" }}>
                        <ul style={{ listStyleType: "disc", paddingLeft: "24px", color: "#4b5563", display: "flex", flexDirection: "column", gap: "8px" }}>
                            <li>
                                <strong>シフトvs実績:</strong> 取り込んだシフト情報と、実際の打刻状況を比較できます。未出勤や遅刻が一目で分かります。
                            </li>
                            <li>
                                <strong>カスタムシート取込:</strong> スプレッドシートを追加して、即日・買取・派遣などの複数シートのシフトを取り込めます。
                            </li>
                            <li>
                                <strong>統合表示:</strong> 同日に複数のシフト（例: 派遣 + バイト）がある場合、自動的に統合されて表示されます。
                            </li>
                        </ul>
                    </div>
                </div>

                <div className="manual-section" style={{ marginBottom: "40px" }}>
                    <h3 style={{ fontSize: "1.2rem", fontWeight: "bold", borderLeft: "4px solid #8b5cf6", paddingLeft: "10px", marginBottom: "16px", color: "#8b5cf6" }}>
                        3. 個人履歴
                    </h3>
                    <p style={{ marginBottom: "16px", lineHeight: "1.6", color: "#374151" }}>
                        スタッフごとの月間の勤務履歴詳細を確認する画面です。
                    </p>
                    <div style={{ background: "#f9fafb", padding: "16px", borderRadius: "8px" }}>
                        <ul style={{ listStyleType: "disc", paddingLeft: "24px", color: "#4b5563", display: "flex", flexDirection: "column", gap: "8px" }}>
                            <li>
                                <strong>スタッフ選択:</strong> 名前やIDで検索できるほか、<strong>「雇用形態」「部署」「勤務地」で絞り込み</strong> が可能です。
                            </li>
                            <li>
                                <strong>集計確認:</strong> 選択したスタッフの「総出勤日数」「総実働時間」「退勤漏れ件数」が上部に表示されます。
                            </li>
                            <li>
                                <strong>詳細確認:</strong> 日別の出退勤時刻と実働時間がリスト表示されます。<CheckCircle size={14} style={{ display: "inline", verticalAlign: "middle" }} color="#22c55e" /> は問題なし、<span className="status-badge red" style={{ fontSize: "10px", display: "inline-block", verticalAlign: "middle" }}>異常</span> は要確認です。
                            </li>
                        </ul>
                    </div>
                </div>

                <div className="manual-section">
                    <h3 style={{ fontSize: "1.2rem", fontWeight: "bold", borderLeft: "4px solid #f59e0b", paddingLeft: "10px", marginBottom: "16px", color: "#f59e0b" }}>
                        4. スタッフ管理
                    </h3>
                    <p style={{ marginBottom: "16px", lineHeight: "1.6", color: "#374151" }}>
                        スタッフの登録情報を管理する画面です。
                    </p>
                    <div style={{ background: "#f9fafb", padding: "16px", borderRadius: "8px" }}>
                        <ul style={{ listStyleType: "disc", paddingLeft: "24px", color: "#4b5563", display: "flex", flexDirection: "column", gap: "8px" }}>
                            <li>
                                <strong>検索・絞り込み:</strong> 氏名やIDでの検索に加え、<strong>「雇用形態」「部署」「勤務地」でのフィルタリング</strong>が可能です。
                            </li>
                            <li>
                                <strong>並び替え:</strong> <strong>「入社日」順（古い順/新しい順）</strong> で並び替えができます。デフォルトは「古い順（古株が上）」です。
                            </li>
                            <li>
                                <strong>ユーザー登録・更新:</strong> フォームに必要事項を入力し、「登録 / 更新する」ボタンで保存します。
                            </li>
                            <li>
                                <strong>情報の更新:</strong> 既存のユーザーIDを入力して保存することで、そのユーザーの情報を上書き更新できます。
                            </li>
                        </ul>
                    </div>
                </div>

            </div>
        </div>
    );
}
