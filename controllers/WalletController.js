const pool = require('../services/db');
const logAction = require("../utils/logger");

exports.refreshWalletBalance = async (req, res) => {
  try {
    const { user_id } = req.user || {};

    // 1. Validate user_id
    if (!user_id) {
      return res.status(400).json({
        status: false,
        message: "user_id is required"
      });
    }

    // 2. Check if user exists
    const [userRows] = await pool.query(
      "SELECT email_address FROM users_account WHERE user_id = ? LIMIT 1",
      [user_id]
    );

    if (userRows.length === 0) {
      return res.status(404).json({
        status: false,
        message: "User not found"
      });
    }

    const email_address = userRows[0].email_address;

    // 3. Get wallet balance by email
    const [balanceRows] = await pool.query(
      "SELECT balance FROM wallet_balance WHERE email_address = ? LIMIT 1",
      [email_address]
    );

    let balance = 0.0;

    if (balanceRows.length > 0) {
      balance = parseFloat(balanceRows[0].balance).toFixed(2);
    } else {
      // wallet does NOT exist → create new wallet with 0 balance
      await pool.query(
        `INSERT INTO wallet_balance (email_address, balance, date_modified)
         VALUES (?, 0.00, NOW())`,
        [email_address]
      );
      balance = 0.0;
    }

    // 4. Return response
    return res.json({
      status: true,
      message: "Wallet balance refreshed",
      data: {
        email_address,
        balance,
        currency: "SLE"
      }
    });

  } catch (err) {
    console.error("Refresh Wallet Balance Error:", err);
    return res.status(500).json({
      status: false,
      message: "Server error"
    });
  }
};
