const pool = require('../services/db');
const jwt = require("jsonwebtoken");
const { sendMail } = require("../utils/mailHelper");
const crypto = require('crypto');
const logAction = require("../utils/logger");
const { encrypt, decrypt } = require('../utils/cryptoHelper');
const { generatePickupTransactionId } = require('../utils/utilities');


exports.searchAgent = async (req, res) => {
  try {
    const { searchParam = "" } = req.body;

    if (!searchParam.trim()) {
      return res.status(400).json({
        status: false,
        message: "searchParam is required",
      });
    }

    const likeValue = `%${searchParam}%`;

    const sql = `
      SELECT user_id, agent_id, account_type, first_name, last_name, kyc_status, profile_img, business_address, business_location, phone_number
      FROM users_account
      WHERE account_type = 'AGENT'
      AND (
            first_name LIKE ?
            OR last_name LIKE ?
            OR CONCAT(first_name, ' ', last_name) LIKE ?
            OR business_address LIKE ?
            OR business_location LIKE ?
          )
    `;

    const params = [
      likeValue,
      likeValue,
      likeValue,
      likeValue,
      likeValue
    ];

    const [agents] = await pool.query(sql, params);

    return res.status(200).json({
      status: true,
      message: "Agents fetched successfully",
      data: agents,
    });

  } catch (err) {
    console.error("Error searching agent:", err);
    return res.status(500).json({
      status: false,
      message: "Server error while searching agent",
    });
  }
};



exports.getRecipientByPhone = async (req, res) => {
  try {
    const { phone_number } = req.body;

    if (!phone_number) {
      return res.status(400).json({
        status: false,
        message: "phone_number is required",
      });
    }

    // phone_number from middleware (logged-in user)
    const { user_id, phone_number: currentUserPhone } = req.user || {};

    // Check self-search
    if (currentUserPhone === phone_number) {
      return res.status(400).json({
        status: false,
        message: "You cannot find recipient as yourself",
      });
    }

    // Query database
    const [results] = await pool.query(
      "SELECT user_id, first_name, last_name, phone_number, email_address, profile_img FROM users_account WHERE phone_number = ?",
      [phone_number]
    );

    if (results.length === 0) {
      return res.status(404).json({
        status: false,
        message: "Recipient not found",
      });
    }

    return res.status(200).json({
      status: true,
      message: "Recipient found",
      data: results[0],
    });

  } catch (err) {
    console.error("Error fetching recipient:", err);
    return res.status(500).json({
      status: false,
      message: "Server error while fetching recipient",
    });
  }
};




exports.sendAgentCashForCashPickup = async (req, res) => {
  try {
    // -------------------------------------------------------------
    // 0. Extract all required inputs
    // -------------------------------------------------------------
    const {
      recipient_user_id,
      agent_id,
      amount,
      transaction_pin,
      note = "",
      save_beneficiary = false
    } = req.body;

    // Sender info from middleware
    const { user_id: sender_id } = req.user || {};

    // -------------------------------------------------------------
    // 1. Validate required inputs
    // -------------------------------------------------------------
    if (!sender_id || !recipient_user_id || !agent_id || !amount || !transaction_pin) {
      return res.status(400).json({
        status: false,
        message: "sender_id, recipient_user_id, agent_id, amount, and transaction_pin are required",
      });
    }

    // -------------------------------------------------------------
    // 2. Confirm recipient exists
    // -------------------------------------------------------------
    const [recipient] = await pool.query(
      "SELECT user_id, email_address, first_name, last_name FROM users_account WHERE user_id = ? LIMIT 1",
      [recipient_user_id]
    );

    if (recipient.length === 0) {
      return res.status(404).json({
        status: false,
        message: "Recipient not found",
      });
    }

    // -------------------------------------------------------------
    // 3. Confirm sender exists + get sender email
    // -------------------------------------------------------------
    const [sender] = await pool.query(
      "SELECT user_id, email_address FROM users_account WHERE user_id = ? LIMIT 1",
      [sender_id]
    );

    if (sender.length === 0) {
      return res.status(404).json({
        status: false,
        message: "Sender account not found",
      });
    }

    const senderEmail = sender[0].email_address;

    // -------------------------------------------------------------
    // 4. Confirm agent exists
    // -------------------------------------------------------------
    const [agent] = await pool.query(
      "SELECT user_id, agent_id, email_address FROM users_account WHERE user_id = ? LIMIT 1",
      [agent_id]
    );

    if (agent.length === 0) {
      return res.status(404).json({
        status: false,
        message: "Agent not found",
      });
    }

    const agent_id_new = agent[0].agent_id;

    // -------------------------------------------------------------
    // 5. Check sender wallet balance
    // -------------------------------------------------------------
    const [wallet] = await pool.query(
      "SELECT email_address, balance FROM wallet_balance WHERE email_address = ? LIMIT 1",
      [senderEmail]
    );

    if (wallet.length === 0) {
      return res.status(404).json({
        status: false,
        message: "Wallet not found for sender",
      });
    }

    const senderBalance = Number(wallet[0].balance);
    if (senderBalance < Number(amount)) {
      return res.status(400).json({
        status: false,
        message: "Insufficient wallet balance",
      });
    }

    // -------------------------------------------------------------
    // 6. Validate transaction PIN
    // -------------------------------------------------------------
    const [pinRow] = await pool.query(
      "SELECT pin FROM transaction_pin WHERE user_id = ? LIMIT 1",
      [sender_id]
    );

    if (pinRow.length === 0) {
      return res.status(400).json({
        status: false,
        message: "You have not set a transaction PIN",
      });
    }

    // Compare encrypted PIN
    const encryptedInputPin = encrypt(transaction_pin);
    const decryptedPin = decrypt(pinRow[0].pin);

    if (decryptedPin !== transaction_pin) {
      return res.status(400).json({
        status: false,
        message: "Invalid transaction PIN",
      });
    }

    // -------------------------------------------------------------
    // 7. Check for duplicate pickup request within 5 minutes
    // -------------------------------------------------------------
    const [duplicate] = await pool.query(
      `
      SELECT request_id FROM pickup_request
      WHERE sender_id=? AND recipient_user_id=? AND agent_id=? AND amount=? 
        AND created_at >= NOW() - INTERVAL 5 MINUTE
      LIMIT 1
      `,
      [sender_id, recipient_user_id, agent_id_new, amount]
    );

    if (duplicate.length > 0) {
      return res.status(200).json({
        status: false,
        message: "Duplicate transaction. Try again in 5 minutes.",
      });
    }

    // -------------------------------------------------------------
    // 8. Save recipient as beneficiary (optional)
    // -------------------------------------------------------------
    if (save_beneficiary === true) {
      await pool.query(
        "INSERT IGNORE INTO beneficiary(user_id, recipient_user_id, date_created) VALUES (?, ?, NOW())",
        [sender_id, recipient_user_id]
      );
    }

    // -------------------------------------------------------------
    // 9. Generate pickup ID FSF-XXXXXXXXXX
    // -------------------------------------------------------------
    const pickup_code = `${Math.floor(1000000000 + Math.random() * 9000000000)}`;
    const request_id = `FSF-`+pickup_code;
    const trans_id = await generatePickupTransactionId();

    const today = new Date();

    // Add 7 days
    const sevenDaysLater = new Date(today);
    sevenDaysLater.setDate(today.getDate() + 7);

    // Format
    const options = { day: '2-digit', month: 'short', year: 'numeric' };
    const validDate = sevenDaysLater.toLocaleDateString('en-US', options);

    // -------------------------------------------------------------
    // 10. Insert pickup request
    // -------------------------------------------------------------
    const [insert] = await pool.query(
      `
      INSERT INTO pickup_request(
        request_id,
        transaction_id,
        pickup_code,
        sender_id,
        recipient_user_id,
        agent_id,
        amount,
        note,
        status,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', NOW())
      `,
      [request_id, trans_id, pickup_code, sender_id, recipient_user_id, agent_id_new, amount, note]
    );

    // -------------------------------------------------------------
    // 11. Return success
    // -------------------------------------------------------------
    return res.status(200).json({
      status: true,
      message: "Cash pickup request created successfully",
      pickup_code,
      valid_until: validDate
    });

  } catch (err) {
    console.error("Error in sendAgentCashForCashPickup:", err);
    return res.status(500).json({
      status: false,
      message: "Server error while processing pickup request",
    });
  }
};
