const { DynamoDBClient, ScanCommand } = require("@aws-sdk/client-dynamodb");
const { marshall, unmarshall } = require("@aws-sdk/util-dynamodb");
const crypto = require("crypto");
const client = new DynamoDBClient({});
const TABLE_NAME = "AttendanceUsers";

// パスワードハッシュ（AdminUser と同じロジック）
function hashPassword(password, salt) {
    return crypto
        .pbkdf2Sync(password, salt, 100000, 64, "sha256")
        .toString("hex");
}

exports.handler = async (event) => {
    // EventBridge warm-up ping対応（コールドスタート防止）
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

    console.log("raw event:", JSON.stringify(event));
    try {
        // ★ event.body がある場合も無い場合も正しく拾う
        let body;
        if (typeof event.body === "string" && event.body.trim() !== "") {
            // API Gateway 経由（body が JSON 文字列）
            try {
                body = JSON.parse(event.body);
            } catch (e) {
                console.error("JSON parse error (event.body):", e);
                body = {};
            }
        } else if (typeof event.body === "object" && event.body !== null) {
            // たまに event.body がオブジェクトで来るパターン
            body = event.body;
        } else {
            // それ以外（event 直下に loginId / password がいるパターンなど）
            body = event || {};
        }

        const loginId = body.loginId;
        const password = body.password;
        console.log("login body:", {
            loginId,
            password: password ? "***" : undefined,
        });

        if (!loginId || !password) {
            return {
                statusCode: 400,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                },
                body: JSON.stringify({ message: "loginId と password が必要です" }),
            };
        }

        // ===== loginId でユーザー検索（全件スキャン） =====
        const baseParams = {
            TableName: TABLE_NAME,
            FilterExpression: "#loginId = :loginId",
            ExpressionAttributeNames: { "#loginId": "loginId" },
            ExpressionAttributeValues: marshall({ ":loginId": loginId }),
        };
        let items = [];
        let ExclusiveStartKey = undefined;
        do {
            const params = {
                ...baseParams,
                ExclusiveStartKey,
            };
            const result = await client.send(new ScanCommand(params));
            if (result.Items) {
                items = items.concat(result.Items.map((i) => unmarshall(i)));
            }
            ExclusiveStartKey = result.LastEvaluatedKey;
        } while (ExclusiveStartKey);

        const user = items[0];
        console.log(
            "found user:",
            user ? { userId: user.userId, loginId: user.loginId } : "undefined"
        );

        if (!user) {
            return {
                statusCode: 401,
                headers: { "Access-Control-Allow-Origin": "*" },
                body: JSON.stringify({
                    message: "ログインID またはパスワードが違います",
                }),
            };
        }

        // ===== パスワード照合 =====
        const inputHash = hashPassword(password, user.passwordSalt);
        if (inputHash !== user.passwordHash) {
            return {
                statusCode: 401,
                headers: { "Access-Control-Allow-Origin": "*" },
                body: JSON.stringify({
                    message: "ログインID またはパスワードが違います",
                }),
            };
        }

        // ===== 認証成功 =====
        // user: DynamoDB から取れた 1件分のユーザーデータ
        const fullName =
            (user.lastName || "") +
            (user.firstName ? " " + user.firstName : "");

        // ★ role を追加（無ければ staff 扱い）
        const role = user.role || "staff";

        const responseBody = {
            // アプリ内部で使うID
            userId: user.userId ?? loginId,
            // 表示用に loginId も返す
            loginId: user.loginId || loginId,
            // 名前（ 姓 名 をつなげる。無ければ user.userName / name を使う ）
            name:
                fullName.trim() ||
                user.userName ||
                user.name ||
                "",
            // 時給（無ければ 2200）
            hourlyWage: user.hourlyWage ?? 2200,
            // 役割（admin / staff など）
            role,
            // ★★★ 追加: 雇用形態 (派遣 or バイト) ★★★
            employmentType: user.employmentType || "バイト",

            defaultLocation: user.defaultLocation || "未記載",

            defaultDepartment: user.defaultDepartment || "未記載"
        };

        console.log("login success responseBody:", responseBody);
        return {
            statusCode: 200,
            headers: {
                "Access-Control-Allow-Origin": "*",
            },
            body: JSON.stringify(responseBody),
        };
    } catch (e) {
        console.error("Login error:", e);
        return {
            statusCode: 500,
            headers: { "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify({ message: "Internal Server Error" }),
        };
    }
};
