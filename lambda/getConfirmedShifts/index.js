// GetConfirmedShifts Lambda - API Gateway経由でフロントエンドから呼び出される
// DynamoDBから確定シフトデータを取得して返す

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
    DynamoDBDocumentClient,
    QueryCommand,
    ScanCommand
} = require("@aws-sdk/lib-dynamodb");

const TABLE_NAME = process.env.TABLE_NAME || "ConfirmedShifts";
const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

exports.handler = async (event) => {
    const headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Content-Type": "application/json"
    };

    // CORS preflight
    if (event.httpMethod === "OPTIONS") {
        return { statusCode: 200, headers, body: "" };
    }

    try {
        const queryParams = event.queryStringParameters || {};
        const dateFrom = queryParams.dateFrom; // YYYY-MM-DD
        const dateTo = queryParams.dateTo;     // YYYY-MM-DD

        if (!dateFrom || !dateTo) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ message: "dateFrom and dateTo are required" })
            };
        }

        // dateFromからdateToまでの全日付で確定シフトを取得
        const allItems = [];
        let currentDate = dateFrom;

        while (currentDate <= dateTo) {
            const result = await docClient.send(new QueryCommand({
                TableName: TABLE_NAME,
                KeyConditionExpression: "dateKey = :dk",
                ExpressionAttributeValues: { ":dk": currentDate }
            }));

            if (result.Items) {
                allItems.push(...result.Items);
            }

            // 翌日に進む
            const d = new Date(currentDate + "T00:00:00");
            d.setDate(d.getDate() + 1);
            currentDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        }

        // { userName: { dateKey: shiftData } } 形式に変換
        const shifts = {};
        for (const item of allItems) {
            if (!shifts[item.userName]) shifts[item.userName] = {};
            shifts[item.userName][item.dateKey] = {
                start: item.start,
                end: item.end,
                isOff: item.isOff,
                location: item.location,
                isDispatch: item.isDispatch,
                dispatchRange: item.dispatchRange || null,
                partTimeRange: item.partTimeRange || null,
                confirmedAt: item.confirmedAt
            };
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                shifts,
                count: allItems.length,
                dateFrom,
                dateTo
            })
        };
    } catch (err) {
        console.error("GetConfirmedShifts error:", err);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ message: "Error", error: err.message })
        };
    }
};
