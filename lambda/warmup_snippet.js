// Lambda Warm-up handler snippet
// 既存のログインLambda関数のhandlerの先頭に以下を追加してください
// EventBridgeからの5分おきPingを即座に返すことでLambdaをウォーム状態に維持

// ===== handler関数の先頭に追加 =====

// EventBridge warm-up ping対応
if (event.source === "aws.events" || event["detail-type"] === "Scheduled Event") {
    console.log("Warm-up ping received at", new Date().toISOString());
    return {
        statusCode: 200,
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ message: "warm" })
    };
}

// ===== 以降は既存のhandler処理 =====

// ======================================
// EventBridge ルール設定:
// ルール名: LoginLambdaWarmUp
// cron式:   cron(0/5 22-14 * * ? *)
//           ↑ UTC 22:00〜14:00 = JST 7:00〜23:00 の間、5分おき
// ターゲット: ログイン用Lambda関数
// ======================================
