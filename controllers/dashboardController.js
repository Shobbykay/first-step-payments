const { v4: uuidv4 } = require('uuid');
const pool = require('../services/db');
const validator = require('validator');
const { encrypt } = require('../utils/cryptoHelper');
const jwt = require("jsonwebtoken");
const { hashPassword } = require("../utils/utilities");
const bcrypt = require("bcrypt");
const { sendMail } = require("../utils/mailHelper");
const { register_confirm_email } = require("../mails/onboardingMail");


exports.createTransactionPin = async (req, res) => {
    const { phone_number, pin } = req.body;
  
    if (!phone_number || !pin) {
      return res.status(400).json({ status: false, message: "phone_number and pin are required" });
    }
  
    if (!/^\d{4}$/.test(pin)) {
      return res.status(400).json({ status: false, message: "PIN must be exactly 4 digits and numbers only" });
    }
  
    try {
      // Get user_id & email
      const [userResult] = await pool.query(
        "SELECT user_id, email_address, first_name FROM users_account WHERE phone_number = ? LIMIT 1",
        [phone_number]
      );
  
      if (userResult.length === 0) {
        return res.status(404).json({ status: false, message: "User not found" });
      }
  
      const user_id = userResult[0].user_id;
      const userEmail = userResult[0].email_address;
      const firstName = userResult[0].first_name;
  
      // Check if pin already exists
      const [pinResult] = await pool.query(
        "SELECT user_id FROM transaction_pin WHERE user_id = ? LIMIT 1",
        [user_id]
      );
  
      if (pinResult.length > 0) {
        return res.status(400).json({
          status: false,
          message: "Transaction pin already set. Please use update transaction pin endpoint for this."
        });
      }
  
      // Encrypt and insert
      const encryptedPin = encrypt(pin);
  
      await pool.query(
        "INSERT INTO transaction_pin (user_id, pin) VALUES (?, ?)",
        [user_id, encryptedPin]
      );

      let verification_link = '';
      let dc = register_confirm_email(firstName, verification_link);

      console.log(dc);
  
      // Send notification email
      await sendMail(
        userEmail,
        "Transaction PIN Set Successfully",
        `Hello <strong>${firstName}</strong>,<br><br>Your transaction PIN has been set successfully.<br><br>If you did not perform this action, please contact support immediately.<br><br>Best regards,<br><strong>First Step Payments Team</strong>`
      );
  
      return res.status(201).json({ status: true, message: "Transaction PIN set successfully" });
  
    } catch (err) {
      console.error("Error setting transaction PIN:", err);
      return res.status(500).json({ status: false, message: "Server error" });
    }
};