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
  const { notification_type } = req.body; // "email" or "push"
  const { user_id } = req.user; // from auth middleware (decoded token)

  if (!notification_type || !["email", "push"].includes(notification_type)) {
    return res.status(400).json({ status: false, message: "Invalid notification type" });
  }

  try {

    // Check if settings row exists
    const [settings] = await pool.query(
      "SELECT * FROM notifications_settings WHERE user_id = ? LIMIT 1",
      [user_id]
    );

    let query, params;

    if (notification_type === "email") {
      query = settings.length > 0
        ? "UPDATE notifications_settings SET email_notification = 1 WHERE user_id = ?"
        : "INSERT INTO notifications_settings (user_id, email_notification, date_created) VALUES (?, 1, NOW())";
      params = [user_id];
    } else if (notification_type === "push") {
      query = settings.length > 0
        ? "UPDATE notifications_settings SET push_notification = 1 WHERE user_id = ?"
        : "INSERT INTO notifications_settings (user_id, push_notification, date_created) VALUES (?, 1, NOW())";
      params = [user_id];
    }

    await pool.query(query, params);

    // Fetch the updated row
    const [updated] = await pool.query(
      "SELECT * FROM notifications_settings WHERE user_id = ? LIMIT 1",
      [user_id]
    );

    return res.json({
      status: true,
      message: `Notification settings updated: ${notification_type} enabled`,
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