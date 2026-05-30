const axios = require("axios");
const db = require("../services/db"); // your MySQL connection

const TERMII_BASE_URL = process.env.TERMII_BASE_URL + "/api/sms/send";
const API_KEY = process.env.TERMII_API_KEY;
const SENDER_ID = process.env.TERMII_SENDER_ID || "talert";

function normalizePhone(number) {
  number = String(number).trim();

  // Case 1: starts with 0 (Nigeria format)
  if (number.startsWith("0")) {
    return "234" + number.slice(1);
  }

  // Case 2: already international (optional safeguard)
  if (number.startsWith("234")) {
    return number;
  }

  // Case 3: short number → prefix 232
  return "232" + number;
}

async function sendSMS({ to, message, type = "plain", channel = "generic", media = null }) {
  
  const to_ = normalizePhone(to);
  
  const payload = {
    to: to_,
    from: SENDER_ID,
    sms: message,
    type,
    api_key: API_KEY,
    channel,
  };

  if (media) payload.media = media;

  let logId = null;

  try {
    // 1. Log REQUEST first
    const [logResult] = await db.execute(
      `INSERT INTO sms_audit_log 
       (to_number, message, request_payload, status)
       VALUES (?, ?, ?, ?)`,
      [to, message, JSON.stringify(payload), "PENDING"]
    );

    logId = logResult.insertId;

    // 2. Send SMS
    const response = await axios.post(TERMII_BASE_URL, payload, {
      headers: { "Content-Type": "application/json" },
    });

    // 3. Update log with RESPONSE (success)
    await db.execute(
      `UPDATE sms_audit_log 
       SET response_payload = ?, status = ?
       WHERE id = ?`,
      [JSON.stringify(response.data), "SUCCESS", logId]
    );

    return response.data;
  } catch (error) {
    // 4. Log ERROR response
    await db.execute(
      `UPDATE sms_audit_log 
       SET response_payload = ?, status = ?, error_message = ?
       WHERE id = ?`,
      [
        JSON.stringify(error.response?.data || null),
        "FAILED",
        error.message,
        logId,
      ]
    );

    throw error;
  }
}

module.exports = { sendSMS };