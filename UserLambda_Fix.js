// index.js (CreateOrUpdateUser) - Fixed Version
// Node.js 20+ / AWS SDK v3

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
    DynamoDBDocumentClient,
    PutCommand,
    UpdateCommand,
    GetCommand
} = require("@aws-sdk/lib-dynamodb");
const crypto = require("crypto");

const TABLE_NAME = "AttendanceUsers";

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

// Pass hash helper
function hashPassword(password, salt) {
    return crypto
        .pbkdf2Sync(password, salt, 100000, 64, "sha256")
        .toString("hex");
}

function parseBody(event) {
    console.log("raw event:", JSON.stringify(event));
    if (typeof event.body === "string" && event.body.trim() !== "") {
        try { return JSON.parse(event.body); }
        catch (e) { console.error("JSON parse error:", e); return {}; }
    }
    if (event.body && typeof event.body === "object") return event.body;
    if (event && typeof event === "object") return event;
    return {};
}

exports.handler = async (event) => {
    try {
        const body = parseBody(event);
        let {
            loginId,
            password,
            userId,
            lastName,
            firstName,
            startDate,
            employmentType,
            livingAlone,
            hourlyWage,
            defaultLocation,
            defaultDepartment
        } = body;

        // Normalize
        loginId = (loginId ?? "").trim();
        password = (password ?? "").trim(); // Empty string if undefined

        // Validation: loginId is always required
        if (!loginId) {
            return response(400, { message: "loginId is required" });
        }

        // Generate userId if missing (New User case if client didn't generate)
        // *Note*: Your frontend generates userId, so this might be fallback.
        if (!userId || String(userId).trim() === "") {
            const ts = new Date();
            userId = `user-${ts.getTime()}`; // unique ID
        }

        // Determine if execution is "Create" or "Update"
        // Heuristic: If password is provided, we can Create or Update Password.
        // If password is MISSING, it MUST be an update to existing user.
        // We can also check if user exists.

        // Check if user exists to decide strategy or just use UpdateCommand with 'upsert' behavior?
        // Using UpdateCommand is safest for partial updates.

        // Prepare Update Expression
        const updateExprParts = [];
        const exprAttrNames = {};
        const exprAttrValues = {};

        let isPasswordUpdate = false;

        // --- Helpers to build expression ---
        const addUpdate = (key, dbKey, value) => {
            if (value !== undefined) {
                updateExprParts.push(`#${key} = :${key}`);
                exprAttrNames[`#${key}`] = dbKey;
                exprAttrValues[`:${key}`] = value;
            }
        };

        // 1. Core Fields
        addUpdate("loginId", "loginId", loginId);

        // 2. Password (Only if provided)
        if (password) {
            const salt = crypto.randomBytes(16).toString("hex");
            const hash = hashPassword(password, salt);
            addUpdate("salt", "passwordSalt", salt);
            addUpdate("hash", "passwordHash", hash);
            isPasswordUpdate = true;
        }

        // 3. Other Fields (Allow nulls if strictly passed as null, or update if value exists)
        // We treat empty strings as valid updates if passed? Or ignore?
        // Frontend sends defaults as "未記載", so we accept string values.

        if (lastName !== undefined) addUpdate("lastName", "lastName", lastName);
        if (firstName !== undefined) addUpdate("firstName", "firstName", firstName);
        if (startDate !== undefined) addUpdate("startDate", "startDate", startDate);
        if (employmentType !== undefined) addUpdate("empType", "employmentType", employmentType); // employmentType is reserved? safe to alias

        // Living Alone (Boolean logic)
        let livingAloneBool = undefined;
        if (livingAlone !== undefined) {
            if (typeof livingAlone === "boolean") livingAloneBool = livingAlone;
            else livingAloneBool = (livingAlone === "yes" || livingAlone === "1" || livingAlone === "true");
            addUpdate("living", "livingAlone", livingAloneBool);
        }

        // Wage
        if (hourlyWage !== undefined) {
            const w = (hourlyWage !== null && String(hourlyWage) !== "") ? Number(hourlyWage) : 2200;
            addUpdate("wage", "hourlyWage", w);
        }

        // Defaults
        if (defaultLocation !== undefined) addUpdate("defLoc", "defaultLocation", defaultLocation);
        if (defaultDepartment !== undefined) addUpdate("defDept", "defaultDepartment", defaultDepartment);

        // Timestamps
        const now = new Date().toISOString();
        // Always update updatedAt
        addUpdate("updatedAt", "updatedAt", now);

        // Use UpdateCommand
        // For "Create" scenario (New user), we also want to set createdAt IF not exists.
        // UpdateCommand supports if_not_exists for createdAt.

        let updateExpression = "SET " + updateExprParts.join(", ");

        // Handle createdAt: set only if not exists
        updateExpression += ", #createdAt = if_not_exists(#createdAt, :createdAt)";
        exprAttrNames["#createdAt"] = "createdAt";
        exprAttrValues[":createdAt"] = now;

        // SECURITY CHECK:
        // If this is a NEW user (doesn't exist), Password IS REQUIRED.
        // We can't easily check "is new" in one Update call without a condition.
        // However, if we try to update a non-existent user without password, we create a broken record (no auth).
        // Solution:
        // 1. If password is provided -> No problem, standard upsert.
        // 2. If password MISSING -> Must ensure user exists. Add ConditionExpression 'attribute_exists(userId)'.

        const params = {
            TableName: TABLE_NAME,
            Key: { userId },
            UpdateExpression: updateExpression,
            ExpressionAttributeNames: exprAttrNames,
            ExpressionAttributeValues: exprAttrValues,
            ReturnValues: "ALL_NEW"
        };

        if (!password) {
            // If no password, strictly require item to exist (Update Mode)
            params.ConditionExpression = "attribute_exists(userId)";
        }

        try {
            const result = await docClient.send(new UpdateCommand(params));

            return response(200, {
                message: "User saved successfully",
                user: result.Attributes
            });

        } catch (err) {
            // If condition failed (User not found and no password provided)
            if (err.name === "ConditionalCheckFailedException") {
                return response(400, { message: "User does not exist. Password is required for new users." });
            }
            throw err;
        }

    } catch (err) {
        console.error("Error:", err);
        return response(500, { message: "Internal Error", error: err.message });
    }
};

function response(code, body) {
    return {
        statusCode: code,
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    };
}
