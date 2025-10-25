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




exports.listNotifications = async (req, res) => {
  try {
    const { status, topic, audience, search } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    let baseQuery = "FROM notifications WHERE 1=1";
    const params = [];

    if (status) {
      baseQuery += " AND status = ?";
      params.push(status);
    }

    if (topic) {
      baseQuery += " AND topic = ?";
      params.push(topic);
    }

    if (audience) {
      baseQuery += " AND audience = ?";
      params.push(audience);
    }

    if (search) {
      baseQuery += " AND (title LIKE ? OR message LIKE ?)";
      params.push(`%${search}%`, `%${search}%`);
    }

    const [countRows] = await pool.query(`SELECT COUNT(*) as total ${baseQuery}`, params);
    const total = countRows[0].total;
    const totalPages = Math.ceil(total / limit);

    const [rows] = await pool.query(
      `SELECT * ${baseQuery} ORDER BY date_created DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return res.json({
      status: true,
      message: "Notifications fetched successfully",
      pagination: {
        current_page: page,
        per_page: limit,
        total_records: total,
        total_pages: totalPages,
      },
      data: rows,
    });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    return res.status(500).json({
      status: false,
      message: "Failed to fetch notifications",
      error: error.message,
    });
  }
};







exports.sendDraftNotification = async (req, res) => {
  const { id } = req.body;
  const action_by = req.user?.email; // from middleware

  if (!id) {
    return res.status(400).json({
      status: false,
      message: "Notification ID is required",
    });
  }

  try {
    // Fetch notification draft
    const [rows] = await pool.query("SELECT * FROM notifications WHERE id = ?", [id]);
    if (!rows.length) {
      return res.status(404).json({
        status: false,
        message: "Notification not found",
      });
    }

    const notification = rows[0];
    if (notification.status !== "DRAFT") {
      return res.status(400).json({
        status: false,
        message: "Only draft notifications can be sent",
      });
    }

    const { title, message, topic, audience } = notification;
    const finalTopic = topic || "GENERAL";

    let tokens = [];

    // Determine audience
    if (audience === "ALL_USERS") {
      [tokens] = await pool.query("SELECT fcm_token FROM user_tokens");
    } else if (audience === "AGENTS_ONLY") {
      [tokens] = await pool.query(`
        SELECT ut.fcm_token FROM user_tokens ut
        LEFT JOIN users_account ua ON ua.user_id = ut.user_id
        WHERE ua.account_type = 'AGENT'
      `);
    } else if (audience === "CUSTOMERS_ONLY") {
      [tokens] = await pool.query(`
        SELECT ut.fcm_token FROM user_tokens ut
        LEFT JOIN users_account ua ON ua.user_id = ut.user_id
        WHERE ua.account_type = 'USER'
      `);
    } else if (audience === "PENDING_KYC") {
      [tokens] = await pool.query(`
        SELECT ut.fcm_token FROM user_tokens ut
        LEFT JOIN users_account ua ON ua.user_id = ut.user_id
        WHERE ua.kyc_status = 'PENDING'
      `);
    }

    const fcmTokens = tokens.map((t) => t.fcm_token).filter(Boolean);

    // Send notification
    let sendResult;
    if (fcmTokens.length > 0) {
      sendResult = await admin.messaging().sendEachForMulticast({
        tokens: fcmTokens,
        notification: { title, body: message },
        data: { topic: finalTopic, audience },
      });
    } else {
      // Send to topic instead (fallback)
      sendResult = await admin.messaging().sendToTopic(finalTopic, {
        notification: { title, body: message },
        data: { audience },
      });
    }

    // Update notification as sent
    await pool.query(
      "UPDATE notifications SET status = ?, sent_at = NOW() WHERE id = ?",
      ["SENT", id]
    );

    // Log admin action
    await logAction({
      action: "SEND_NOTIFICATION",
      action_by,
      log_message: `Notification "${title}" sent to ${audience} via ${finalTopic}`,
      status: "SUCCESS",
    });

    return res.json({
      status: true,
      message: "Notification sent successfully",
      result: sendResult,
    });
  } catch (error) {
    console.error("Error sending draft notification:", error);

    await pool.query(
      "UPDATE notifications SET status = ? WHERE id = ?",
      ["FAILED", id]
    );

    await logAction({
      action: "SEND_NOTIFICATION",
      action_by,
      log_message: `Failed to send notification ID ${id}: ${error.message}`,
      status: "FAILED",
    });

    return res.status(500).json({
      status: false,
      message: "Failed to send notification",
      error: error.message,
    });
  }
};