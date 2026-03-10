// deleteAttendance Lambda - 勤怠レコードを全削除するためのLambda関数
// ランタイム: Node.js 24.x (ESM)

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
    DynamoDBDocumentClient,
    ScanCommand,
    BatchWriteCommand
} from "@aws-sdk/lib-dynamodb";

const TABLE_NAME = process.env.TABLE_NAME || "Attendance";
const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

export const handler = async (event) => {
    const headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "DELETE, POST, OPTIONS",
        "Content-Type": "application/json"
    };

    if (event.httpMethod === "OPTIONS") {
        return { statusCode: 200, headers, body: "" };
    }

    console.log("deleteAttendance Lambda started at", new Date().toISOString());
    console.log("TABLE_NAME:", TABLE_NAME);

    try {
        let allItems = [];
        let ExclusiveStartKey = undefined;

        do {
            const scanResult = await docClient.send(new ScanCommand({
                TableName: TABLE_NAME,
                ProjectionExpression: "userId, workDate",
                ExclusiveStartKey
            }));

            if (scanResult.Items) {
                allItems = allItems.concat(scanResult.Items);
            }
            ExclusiveStartKey = scanResult.LastEvaluatedKey;
        } while (ExclusiveStartKey);

        console.log(`Found ${allItems.length} records to delete`);

        if (allItems.length === 0) {
            return {
                statusCode: 200, headers,
                body: JSON.stringify({ success: true, message: "No records to delete", deletedCount: 0 })
            };
        }

        let deletedCount = 0;

        for (let i = 0; i < allItems.length; i += 25) {
            const batch = allItems.slice(i, i + 25);
            const deleteRequests = batch.map(item => ({
                DeleteRequest: { Key: { userId: item.userId, workDate: item.workDate } }
            }));

            try {
                const result = await docClient.send(new BatchWriteCommand({
                    RequestItems: { [TABLE_NAME]: deleteRequests }
                }));

                let unprocessed = result.UnprocessedItems?.[TABLE_NAME];
                let retryCount = 0;
                while (unprocessed && unprocessed.length > 0 && retryCount < 5) {
                    await new Promise(r => setTimeout(r, 1000 * (retryCount + 1)));
                    const retryResult = await docClient.send(new BatchWriteCommand({
                        RequestItems: { [TABLE_NAME]: unprocessed }
                    }));
                    unprocessed = retryResult.UnprocessedItems?.[TABLE_NAME];
                    retryCount++;
                }

                deletedCount += batch.length;
                console.log(`Deleted batch ${Math.floor(i / 25) + 1}: ${batch.length} records (total: ${deletedCount})`);
            } catch (batchErr) {
                console.error(`Batch delete error at offset ${i}:`, batchErr);
            }
        }

        return {
            statusCode: 200, headers,
            body: JSON.stringify({ success: true, message: `Deleted ${deletedCount} attendance records`, deletedCount, totalFound: allItems.length })
        };

    } catch (err) {
        console.error("deleteAttendance error:", err);
        return {
            statusCode: 500, headers,
            body: JSON.stringify({ success: false, message: "Error deleting records", error: err.message })
        };
    }
};
