// for user accounts

const pool = require('../services/db');
const { v4: uuidv4 } = require("uuid");
const logAction = require("../utils/logger");
const { sendMail } = require("../utils/mailHelper");
const { encrypt } = require('../utils/cryptoHelper');
const bcrypt = require("bcrypt");


exports.retrieveSecurityQuestion = async (req, res) => {
  try {
    const { user_id } = req.user || {};

    const [rows] = await pool.query(
      "SELECT security_question FROM users_account WHERE user_id = ? LIMIT 1",
      [user_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        status: false,
        message: "No security questions found",
      });
    }

    return res.status(200).json({
      status: true,
      message: "Retrieved security question successfully",
      data: rows[0]
    });
  } catch (error) {
    console.error("Retrieve security questions error:", error);
    return res.status(500).json({
      status: false,
      message: "Server error while retrieving security questions",
    });
  }
};





exports.validateSecurityQuestion = async (req, res) => {
  const { user_id } = req.user || {};
  const { answer } = req.body;

  try {
    if (!user_id) {
      return res.status(400).json({
        status: false,
        message: "Missing user credentials",
      });
    }

    if (!answer || answer.trim() === "") {
      return res.status(400).json({
        status: false,
        message: "Answer is required",
      });
    }

    // Fetch stored security answer
    const [rows] = await pool.query(
      "SELECT security_answer FROM users_account WHERE user_id = ? LIMIT 1",
      [user_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        status: false,
        message: "User not found",
      });
    }

    const storedAnswer = rows[0].security_answer;

    // Compare case-insensitive & trim spaces
    if (
      storedAnswer &&
      storedAnswer.trim().toLowerCase() === answer.trim().toLowerCase()
    ) {
      return res.status(200).json({
        status: true,
        message: "Security answer validated successfully",
      });
    } else {
      return res.status(200).json({
        status: false,
        message: "Invalid security answer",
      });
    }
  } catch (err) {
    console.error("Validate security question error:", err);
    return res.status(500).json({
      status: false,
      message: "Server error while validating security question",
    });
  }
};






exports.updateTransactionPin = async (req, res) => {
  const { user_id } = req.user || {};
  const { new_pin } = req.body;

  if (!user_id) {
    return res.status(401).json({
      status: false,
      message: "Unauthorized: user_id missing from session",
    });
  }

  if (!new_pin) {
    return res.status(400).json({
      status: false,
      message: "new_pin is required",
    });
  }

  if (!/^\d{4}$/.test(new_pin)) {
    return res.status(400).json({
      status: false,
      message: "PIN must be exactly 4 digits and numbers only",
    });
  }

  try {
    // Get user details
    const [userResult] = await pool.query(
      "SELECT email_address, first_name FROM users_account WHERE user_id = ? LIMIT 1",
      [user_id]
    );

    if (userResult.length === 0) {
      return res.status(404).json({ status: false, message: "User not found" });
    }

    const userEmail = userResult[0].email_address;
    const firstName = userResult[0].first_name;

    // Check if PIN exists
    const [pinResult] = await pool.query(
      "SELECT user_id FROM transaction_pin WHERE user_id = ? LIMIT 1",
      [user_id]
    );

    if (pinResult.length === 0) {
      return res.status(400).json({
        status: false,
        message: "No existing transaction PIN found. Please create one first.",
      });
    }

    // Encrypt and update
    const encryptedPin = encrypt(new_pin);

    await pool.query("UPDATE transaction_pin SET pin = ? WHERE user_id = ?", [
      encryptedPin,
      user_id,
    ]);

    // Log only success
    await logAction({
      user_id,
      action: "UPDATE_TRANSACTION_PIN",
      log_message: `Transaction PIN updated successfully for ${userEmail}`,
      status: "SUCCESS",
      action_by: userEmail,
    });

    // Send notification email
    await sendMail(
      userEmail,
      "Transaction PIN Updated Successfully",
      `Hello <strong>${firstName}</strong>,<br><br>Your transaction PIN has been updated successfully.<br><br>If you did not perform this action, please contact support immediately.<br><br>Best regards,<br><strong>First Step Payments Team</strong>`
    );

    return res
      .status(200)
      .json({ status: true, message: "Transaction PIN updated successfully" });
  } catch (err) {
    console.error("Error updating transaction PIN:", err);

    return res
      .status(500)
      .json({ status: false, message: "Server error while updating PIN" });
  }
};






exports.closeAccount = async (req, res) => {
  const { user_id } = req.user || {};
  const { reason, password } = req.body;

  if (!user_id) {
    return res.status(401).json({
      status: false,
      message: "Unauthorized: user_id missing from session",
    });
  }

  if (!reason || reason.trim() === "" || !password) {
    return res.status(400).json({
      status: false,
      message: "A valid reason and/or password must be provided to close your account",
    });
  }

  try {
    // Fetch user details
    const [userResult] = await pool.query(
      "SELECT email_address, first_name, password FROM users_account WHERE user_id = ? LIMIT 1",
      [user_id]
    );

    if (userResult.length === 0) {
      return res.status(404).json({
        status: false,
        message: "User not found",
      });
    }

    const userEmail = userResult[0].email_address;
    const firstName = userResult[0].first_name;
    const password_hash = userResult[0].password;

    // Verify password
    const isMatch = await bcrypt.compare(password, password_hash);
    if (!isMatch) {
      return res.status(401).json({ status: false, message: "Invalid password" });
    }

    // Update account as closed
    await pool.query(
      `UPDATE users_account 
       SET closed_by = ?, closed_date = NOW(), closure_reason = ?, status = 5 
       WHERE user_id = ?`,
      [userEmail, reason, user_id]
    );

    // Log account closure
    await logAction({
      user_id,
      action: "CLOSE_ACCOUNT",
      log_message: `Account closed by user (${userEmail}) with reason: ${reason}`,
      status: "SUCCESS",
      action_by: userEmail,
    });

    // Send closure email
    await sendMail(
      userEmail,
      "We Hate to See You Go",
      `Hello <strong>${firstName}</strong>,<br><br>
      We’re sorry to see you leave <strong>First Step Payments</strong>.<br><br>
      Your account has been closed successfully for the following reason:<br><br>
      <em>${reason}</em><br><br>
      If this was a mistake or you change your mind, please reach out to our support team and we’ll be glad to help.<br><br>
      Best regards,<br>
      <strong>First Step Payments Team</strong>`
    );

    return res.status(200).json({
      status: true,
      message: "Account closed successfully",
    });
  } catch (err) {
    console.error("Close account error:", err);
    return res.status(500).json({
      status: false,
      message: "Server error while closing account",
    });
  }
};








exports.updateProfile = async (req, res) => {
  try {
    const { user_id } = req.user || {}; // from middleware
    if (!user_id) {
      return res.status(401).json({
        status: false,
        message: "Unauthorized: Missing user ID",
      });
    }

    const {
      first_name,
      last_name,
      dob,
      business_name,
      business_address,
      business_location,
      business_hours, // JSON
    } = req.body;

    // Step 1: Fetch user info for logging
    const [userResult] = await pool.query(
      "SELECT email_address, first_name FROM users_account WHERE user_id = ? LIMIT 1",
      [user_id]
    );

    if (userResult.length === 0) {
      return res.status(404).json({
        status: false,
        message: "User not found",
      });
    }

    const userEmail = userResult[0].email_address;

    // Step 2: Collect provided fields
    const fields = {};
    if (first_name) fields.first_name = first_name;
    if (last_name) fields.last_name = last_name;
    if (dob) fields.dob = dob;
    if (business_name) fields.business_name = business_name;
    if (business_address) fields.business_address = business_address;
    if (business_location) fields.business_location = business_location;
    if (business_hours) {
      try {
        // Ensure it's valid JSON
        const parsedHours =
          typeof business_hours === "string"
            ? JSON.parse(business_hours)
            : business_hours;
        fields.business_hours = JSON.stringify(parsedHours);
      } catch (jsonErr) {
        return res.status(400).json({
          status: false,
          message: "Invalid JSON format for business_hours",
        });
      }
    }

    if (Object.keys(fields).length === 0) {
      return res.status(400).json({
        status: false,
        message: "No fields provided to update",
      });
    }

    // Step 3: Build dynamic SQL
    const setClause = Object.keys(fields)
      .map((key) => `${key} = ?`)
      .join(", ");
    const values = [...Object.values(fields), user_id];

    const sql = `UPDATE users_account SET ${setClause} WHERE user_id = ?`;
    const [result] = await pool.query(sql, values);

    if (result.affectedRows === 0) {
      return res.status(404).json({
        status: false,
        message: "No changes were made",
      });
    }

    // Step 4: Log on success
    await logAction({
      user_id,
      action: "UPDATE_PROFILE",
      log_message: `User profile updated successfully for ${userEmail}`,
      status: "SUCCESS",
      action_by: userEmail,
    });

    return res.status(200).json({
      status: true,
      message: "Profile updated successfully",
    });
  } catch (err) {
    console.error("Update profile error:", err);
    return res.status(500).json({
      status: false,
      message: "Server error",
    });
  }
};