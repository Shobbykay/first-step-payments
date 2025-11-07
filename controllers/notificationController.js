const { v4: uuidv4 } = require('uuid');
const mysql = require('mysql2/promise');
const pool = require('../services/db');
const validator = require('validator');
const { encrypt } = require('../utils/cryptoHelper');
const jwt = require("jsonwebtoken");
const { hashPassword } = require("../utils/utilities");
const { sendMail } = require("../utils/mailHelper");
const bcrypt = require("bcrypt");



// update notification settings
exports.notifications_settings = async (req, res) => {
  const { notification_type } = req.body; // "email", "push", "none", "both"
  const { user_id } = req.user; // from auth middleware (decoded token)

  const validTypes = ["email", "push", "none", "both"];
  if (!notification_type || !validTypes.includes(notification_type)) {
    return res.status(400).json({ status: false, message: "Invalid notification type" });
  }

  try {
    // Check if settings row exists
    const [settings] = await pool.query(
      "SELECT * FROM notifications_settings WHERE user_id = ? LIMIT 1",
      [user_id]
    );

    let query, params;

    switch (notification_type) {
      case "email":
        query = settings.length > 0
          ? "UPDATE notifications_settings SET email_notification = 1 WHERE user_id = ?"
          : "INSERT INTO notifications_settings (user_id, email_notification, date_created) VALUES (?, 1, NOW())";
        params = [user_id];
        break;

      case "push":
        query = settings.length > 0
          ? "UPDATE notifications_settings SET push_notification = 1 WHERE user_id = ?"
          : "INSERT INTO notifications_settings (user_id, push_notification, date_created) VALUES (?, 1, NOW())";
        params = [user_id];
        break;

      case "none":
        query = settings.length > 0
          ? "UPDATE notifications_settings SET email_notification = 0, push_notification = 0 WHERE user_id = ?"
          : "INSERT INTO notifications_settings (user_id, email_notification, push_notification, date_created) VALUES (?, 0, 0, NOW())";
        params = [user_id];
        break;

      case "both":
        query = settings.length > 0
          ? "UPDATE notifications_settings SET email_notification = 1, push_notification = 1 WHERE user_id = ?"
          : "INSERT INTO notifications_settings (user_id, email_notification, push_notification, date_created) VALUES (?, 1, 1, NOW())";
        params = [user_id];
        break;
    }

    await pool.query(query, params);

    // Fetch the updated row
    const [updated] = await pool.query(
      "SELECT * FROM notifications_settings WHERE user_id = ? LIMIT 1",
      [user_id]
    );

    return res.json({
      status: true,
      message: `Notification settings updated: ${notification_type}`,
      data: updated[0],
    });

  } catch (error) {
    console.error("Notification settings error:", error);
    return res.status(500).json({ status: false, message: "Database error" });
  }
};




exports.retrieve_notifications = async (req, res) => {
  const { user_id } = req.user; // from auth middleware (decoded token)

  try {

    // Check if settings row exists
    const [settings] = await pool.query(
      "SELECT * FROM notifications_settings WHERE user_id = ? LIMIT 1",
      [user_id]
    );

    let result;
    if (settings.length > 0) {
      result = settings[0];
    } else {
      result = {
        user_id,
        email_notification: 0,
        push_notification: 0,
        date_created: null,
        date_modified: null
      };
    }

    return res.json({
      status: true,
      message: `Notification settings`,
      data: result,
    });

  } catch (error) {
    console.error("Notification settings error:", error);
    return res.status(500).json({ status: false, message: "Database error" });
  }
  
};




exports.get_user_notifications = async (req, res) => {
  const { user_id } = req.user; // from auth middleware (decoded token)
  const page = parseInt(req.query.page) || 1; // current page (default = 1)
  const limit = 20;
  const offset = (page - 1) * limit;

  try {
    // Step 1: Fetch account type and KYC status
    const [userRows] = await pool.query(
      "SELECT account_type, kyc_status FROM users_account WHERE user_id = ? LIMIT 1",
      [user_id]
    );

    if (userRows.length === 0) {
      return res.status(404).json({
        status: false,
        message: "User not found",
      });
    }

    const { account_type, kyc_status } = userRows[0];

    // Step 2: Build dynamic audience list
    const audienceList = ["ALL_USERS", user_id]; // default audiences

    if (account_type === "USER") audienceList.push("CUSTOMERS_ONLY");
    if (account_type === "AGENT") audienceList.push("AGENTS_ONLY");
    if (kyc_status === "PENDING") audienceList.push("PENDING_KYC");

    // Step 3: Build query
    const topics = [
      "INFORMATIONAL",
      "SECURITY",
      "PROMOTIONAL",
      "GENERAL",
    ];

    const placeholdersTopics = topics.map(() => "?").join(", ");
    const placeholdersAudience = audienceList.map(() => "?").join(", ");

    // Step 4: Fetch total count for pagination
    const countQuery = `
      SELECT COUNT(*) AS total
      FROM notifications
      WHERE topic IN (${placeholdersTopics})
      OR audience IN (${placeholdersAudience})
    `;
    const [countRows] = await pool.query(countQuery, [...topics, ...audienceList]);
    const totalRecords = countRows[0]?.total || 0;

    // Step 5: Fetch paginated records
    const dataQuery = `
      SELECT id, title, message, topic, date_created 
      FROM notifications
      WHERE topic IN (${placeholdersTopics})
      OR audience IN (${placeholdersAudience})
      ORDER BY date_created DESC
      LIMIT ? OFFSET ?
    `;
    const [notifications] = await pool.query(dataQuery, [...topics, ...audienceList, limit, offset]);

    return res.json({
      status: true,
      message: "User notifications retrieved successfully",
      pagination: {
        current_page: page,
        per_page: limit,
        total_records: totalRecords,
        total_pages: Math.ceil(totalRecords / limit),
      },
      data: notifications,
    });

  } catch (error) {
    console.error("Get user notifications error:", error);
    return res.status(500).json({
      status: false,
      message: "Database error",
    });
  }
};





exports.register_token = async (req, res) => {
  const { fcm_token } = req.body;
  const { user_id } = req.user;

  if (!user_id || !fcm_token) {
    return res.status(400).json({
      status: false,
      message: "user_id and fcm_token are required",
    });
  }

  try {
    // Check if a record exists for this user
    const [existing] = await pool.query(
      "SELECT id, fcm_token FROM user_tokens WHERE user_id = ?",
      [user_id]
    );

    if (existing.length > 0) {
      // Update existing record if token is different
      const oldToken = existing[0].fcm_token;
      if (oldToken !== fcm_token) {
        await pool.query(
          "UPDATE user_tokens SET fcm_token = ?, updated_at = NOW() WHERE user_id = ?",
          [fcm_token, user_id]
        );
      }
    } else {
      // Insert new record if none exists
      await pool.query(
        "INSERT INTO user_tokens (user_id, fcm_token, created_at) VALUES (?, ?, NOW())",
        [user_id, fcm_token]
      );
    }

    return res.json({
      status: true,
      message: "Token registered or updated successfully",
    });
  } catch (error) {
    console.error("Error saving token:", error);
    return res.status(500).json({
      status: false,
      message: "Database error",
      error: error.message,
    });
  }
}