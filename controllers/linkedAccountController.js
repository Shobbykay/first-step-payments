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
exports.add_account = async (req, res) => {
  const { bank_code, bank_name, account_number, account_name } = req.body;
  const { user_id } = req.user; // from JWT via auth middleware

  if (!bank_code || !bank_name || !account_number || !account_name) {
    return res.status(400).json({
      status: false,
      message: "All fields are required"
    });
  }

  try {
    // Check if duplicate exists
    const [exists] = await pool.query(
      "SELECT user_id FROM linked_accounts WHERE user_id = ? AND bank_code = ? AND account_number = ? LIMIT 1",
      [user_id, bank_code, account_number]
    );

    if (exists.length > 0) {
      return res.status(409).json({
        status: false,
        message: "Your FirstStep account is already linked to this bank account"
      });
    }

    // Insert new record
    await pool.query(
      `INSERT INTO linked_accounts (user_id, bank_code, bank_name, account_number, account_name, date_created) 
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [user_id, bank_code, bank_name, account_number, account_name]
    );

    return res.json({
      status: true,
      message: "Bank account linked successfully",
      data: {
        user_id,
        bank_code,
        bank_name,
        account_number,
        account_name
      }
    });
  } catch (error) {
    console.error("Link account error:", error);
    return res.status(500).json({
      status: false,
      message: "Database error"
    });
  }
};



exports.fetch_user_accounts = async (req, res) => {
  const { user_id } = req.user; // from auth middleware (decoded token)

  try {

    // Check if settings row exists
    const [accounts] = await pool.query(
      "SELECT * FROM linked_accounts WHERE user_id = ?",
      [user_id]
    );

    return res.json({
      status: true,
      message: `Linked Accounts`,
      data: accounts,
    });

  } catch (error) {
    console.error("Fetching linked accounts error:", error);
    return res.status(500).json({ status: false, message: "Database error" });
  }
  
};



exports.remove_user_accounts = async (req, res) => {
  const { bank_code } = req.body;
  const { user_id } = req.user;   // extracted from JWT token

  if (!bank_code) {
    return res.status(400).json({
      status: false,
      message: "Bank code is required"
    });
  }

  try {
    // Check if account exists for this user
    const [rows] = await pool.query(
      "SELECT user_id FROM linked_accounts WHERE user_id = ? AND bank_code = ? LIMIT 1",
      [user_id, bank_code]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        status: false,
        message: "Linked account not found"
      });
    }

    // Delete the record
    await pool.query(
      "DELETE FROM linked_accounts WHERE user_id = ? AND bank_code = ?",
      [user_id, bank_code]
    );

    return res.json({
      status: true,
      message: "Linked account deleted successfully"
    });
  } catch (error) {
    console.error("Delete linked account error:", error);
    return res.status(500).json({
      status: false,
      message: "Database error"
    });
  }
  
};