import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({ region: "ap-northeast-1" });
const ddb = DynamoDBDocumentClient.from(client);

async function main() {
    // Find Nara
    const usersRes = await ddb.send(new ScanCommand({
        TableName: "Users",
        FilterExpression: "contains(lastName, :name) OR contains(firstName, :name)",
        ExpressionAttributeValues: { ":name": "奈良" }
    }));
    
    console.log("Users found:", usersRes.Items.map(u => `${u.lastName} ${u.firstName} (${u.userId})`));
    
    for (const u of usersRes.Items) {
        console.log(`\n--- Fetching attendance for ${u.lastName} ${u.firstName} ---`);
        const attRes = await ddb.send(new QueryCommand({
            TableName: "Attendance",
            KeyConditionExpression: "userId = :uid AND begins_with(workDate, :date)",
            ExpressionAttributeValues: {
                ":uid": u.userId,
                ":date": "2026-03-22"
            }
        }));
        
        console.log(`Records found: ${attRes.Items.length}`);
        attRes.Items.forEach(item => {
            console.log(JSON.stringify(item, null, 2));
        });
    }
}

main().catch(console.error);
