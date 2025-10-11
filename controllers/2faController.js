const pool = require('../services/db');
const jwt = require("jsonwebtoken");
const { sendMail } = require("../utils/mailHelper");
const crypto = require('crypto');
const logAction = require("../utils/logger");


exports.twofa_sendEmailOtp = async (req, res) => {
  try {
    const user_id = req.user?.user_id;

    // Check if user has 2FA disabled
    const [userRows] = await pool.query(
      "SELECT first_name, email_address, is_2fa FROM users_account WHERE user_id = ? LIMIT 1",
      [user_id]
    );

    if (userRows.length === 0) {
      return res.status(404).json({
        status: false,
        message: "User not found.",
      });
    }

    const { first_name, email_address, is_2fa } = userRows[0];

    if (is_2fa !== 0) {
      return res.status(400).json({
        status: false,
        message: "2FA is already enabled for this user.",
      });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Insert OTP record
    await pool.query(
      "INSERT INTO 2fa_verify_code (email_address, otp) VALUES (?, ?)",
      [email_address, otp]
    );

    // Send email
    await sendMail(
      email_address,
      "Your 2FA Verification Code",
      `
      Hello <strong>${first_name}</strong>,<br><br>
      Your 2FA verification code is: <strong>${otp}</strong>.<br><br>
      This code will expire shortly. Please use it to complete your verification.<br><br>
      If you did not request this, please contact support immediately.<br><br>
      Best regards,<br>
      <strong>First Step Payments Team</strong>
      `
    );

    return res.status(200).json({
      status: true,
      message: "2FA verification code sent successfully.",
    });
  } catch (error) {
    console.error("Error sending 2FA email OTP:", error);
    return res.status(500).json({
      status: false,
      message: "Server error while sending 2FA email OTP.",
    });
  }
};



exports.twofa_verifyEmailOtp = async (req, res) => {
  try {
    const user_id = req.user?.user_id;
    const { otp } = req.body;

    if (!otp) {
      return res.status(400).json({
        status: false,
        message: "OTP code is required.",
      });
    }

    // Fetch user first name for email
    const [userRows] = await pool.query(
      "SELECT first_name, email_address FROM users_account WHERE user_id = ? LIMIT 1",
      [user_id]
    );

    if (userRows.length === 0) {
      return res.status(404).json({
        status: false,
        message: "User not found.",
      });
    }

    const { first_name, email_address } = userRows[0];

    // Check if OTP exists for this email
    const [rows] = await pool.query(
      "SELECT * FROM 2fa_verify_code WHERE email_address = ? AND otp = ? LIMIT 1",
      [email_address, otp]
    );

    if (rows.length === 0) {
      return res.status(400).json({
        status: false,
        message: "Invalid or expired OTP.",
      });
    }

    // OTP matched — update user 2FA status
    await pool.query(
      "UPDATE users_account SET is_2fa = 1, 2fa_method = 'email' WHERE email_address = ?",
      [email_address]
    );

    // Delete OTP record
    await pool.query("DELETE FROM 2fa_verify_code WHERE email_address = ?", [
      email_address,
    ]);

    // Send confirmation email
    await sendMail(
      email_address,
      "Two-Factor Authentication Enabled",
      `
      Hello <strong>${first_name}</strong>,<br><br>
      Your two-factor authentication (2FA) has been successfully set up using your email address.<br><br>
      From now on, you'll be asked to verify important actions with a code sent to your email.<br><br>
      If you did not perform this action, please contact support immediately.<br><br>
      Best regards,<br>
      <strong>First Step Payments Team</strong>
      `
    );

    return res.status(200).json({
      status: true,
      message: "2FA email verification successful. Your account is now protected with email verification.",
    });
  } catch (error) {
    console.error("Error verifying 2FA email OTP:", error);
    return res.status(500).json({
      status: false,
      message: "Server error while verifying 2FA OTP.",
    });
  }
};