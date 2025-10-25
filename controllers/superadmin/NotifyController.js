const pool = require('../../services/db');
const logAction = require("../../utils/logger");
const admin = require("../../firebase");


// Helper: Get tokens based on audience
async function getTokensByAudience(audience) {
  let query = "";

  switch (audience) {
    case "ALL_USERS":
      query = "SELECT fcm_token FROM user_tokens";
      break;
    case "AGENTS_ONLY":
      query = `SELECT ut.fcm_token
               FROM user_tokens ut
               LEFT JOIN users_account ua ON ua.user_id = ut.user_id
               WHERE ua.account_type = 'AGENT'`;
      break;
    case "CUSTOMERS_ONLY":
      query = `SELECT ut.fcm_token
               FROM user_tokens ut
               LEFT JOIN users_account ua ON ua.user_id = ut.user_id
               WHERE ua.account_type = 'USER'`;
      break;
    case "PENDING_KYC":
      query = `SELECT ut.fcm_token
               FROM user_tokens ut
               LEFT JOIN users_account ua ON ua.user_id = ut.user_id
               WHERE ua.kyc_status = 'PENDING'`;
      break;
    default:
      throw new Error("Invalid audience type");
  }

  const [rows] = await pool.query(query);
  return rows.map(r => r.fcm_token);
}




// Controller: Broadcast Notification
exports.broadcastNotification = async (req, res) => {
  const action_by = req.user?.email || "SYSTEM";
  const { title, message, topic, audience, status = "Sent" } = req.body;

  if (!title || !message || !audience) {
    return res.status(400).json({
      status: false,
      message: "Missing required fields: title, message, audience",
    });
  }

  const chosenTopic = topic || "GENERAL";

  try {
    // Insert into notifications table
    const [result] = await pool.query(
      `INSERT INTO notifications (title, message, topic, audience, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [title, message, chosenTopic, audience, status, action_by]
    );

    const notificationId = result.insertId;
    let sendStatus = status;
    let sendTime = null;

    // Send only if status = "Sent"
    if (status.toLowerCase() === "sent") {
      let tokens = [];
      let fcmResult;

      try {
        // Always send by topic first
        const messagePayload = {
          notification: { title, body: message },
          topic: chosenTopic,
        };

        await admin.messaging().send(messagePayload);
        sendStatus = "Sent";
        sendTime = new Date();

        // Additionally send by tokens if audience filter applies
        tokens = await getTokensByAudience(audience);

        if (tokens.length > 0) {
          const batch = {
            notification: { title, body: message },
            tokens,
          };
          fcmResult = await admin.messaging().sendEachForMulticast(batch);
        }

        await logAction({
          user_id: "SYSTEM",
          action: "BROADCAST_NOTIFICATION",
          log_message: `Broadcast "${title}" sent to ${audience} on topic ${chosenTopic}`,
          status: "SUCCESS",
          action_by,
        });
      } catch (error) {
        console.error("FCM send error:", error);
        sendStatus = "Failed";
        await logAction({
          user_id: "SYSTEM",
          action: "BROADCAST_NOTIFICATION",
          log_message: `Failed to send broadcast "${title}". Error: ${error.message}`,
          status: "FAILED",
          action_by,
        });
      }

      // Update notification record
      await pool.query(
        `UPDATE notifications SET status = ?, sent_at = ? WHERE id = ?`,
        [sendStatus, sendTime, notificationId]
      );
    }

    return res.json({
      status: true,
      message: `Notification ${sendStatus.toLowerCase()} successfully`,
      data: {
        id: notificationId,
        title,
        message,
        topic: chosenTopic,
        audience,
        status: sendStatus,
        created_by: action_by,
      },
    });
  } catch (error) {
    console.error("Error broadcasting notification:", error);
    return res.status(500).json({
      status: false,
      message: "Failed to broadcast notification",
      error: error.message,
    });
  }
};