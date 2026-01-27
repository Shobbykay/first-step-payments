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

    if (!recipient.length) {
      return res.status(404).json({ status: false, message: "Recipient not found" });
    }

    const recipient_name = `${recipient[0].first_name} ${recipient[0].last_name}`;

    // -------------------------------------------------------------
    // 3. Confirm sender exists + get sender email
    // -------------------------------------------------------------
    const [sender] = await pool.query(
      "SELECT user_id, email_address, first_name FROM users_account WHERE user_id = ? LIMIT 1",
      [sender_id]
    );

    if (!sender.length) {
      return res.status(404).json({ status: false, message: "Sender not found" });
    }

    const senderEmail = sender[0].email_address;
    const first_name = sender[0].first_name;

    // -------------------------------------------------------------
    // 4. Confirm agent exists
    // -------------------------------------------------------------
    const [agent] = await conn.query(
      `
      SELECT user_id, agent_id, first_name, last_name
      FROM users_account
      WHERE user_id=? AND agent_id IS NOT NULL
      LIMIT 1
      `,
      [agent_id]
    );

    if (agent.length === 0) {
      return res.status(404).json({
        status: false,
        message: "Agent not found",
      });
    }

    const agent_id_db = agent[0].agent_id;
    const agent_name = `${agent[0].first_name} ${agent[0].last_name}`;

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
    const newSenderBalance = senderBalance - Number(amount);
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

    if (!pinRow.length) {
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
    const [duplicate] = await conn.query(
      `
      SELECT request_id FROM pickup_request
      WHERE sender_id=? 
        AND recipient_user_id=? 
        AND agent_id=? 
        AND amount=? 
        AND status='PENDING'
        AND created_at >= NOW() - INTERVAL 5 MINUTE
      LIMIT 1
      `,
      [sender_id, recipient_user_id, agent_id_db, amount]
    );

    if (duplicate.length > 0) {
      return res.status(409).json({
        status: false,
        message: "Duplicate pickup request detected. Please wait 5 minutes.",
      });
    }

    // -------------------------------------------------------------
    // Start TRANSACTION
    // -------------------------------------------------------------
    await conn.beginTransaction();

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

    // DEBIT sender wallet
    await pool.query(
      `UPDATE wallet_balance SET balance=?, date_modified=NOW() WHERE email_address=?`,
      [newSenderBalance, senderEmail]
    );
    

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
      [request_id, trans_id, pickup_code, sender_id, recipient_user_id, agent_id, amount, note]
    );


    // Send email
    sendMail(
      senderEmail,
      "Pickup Request of SLE"+amount,
      `Hello <strong>${first_name}</strong>,<br><br>

        Your pickup request of <strong>SLE${amount}</strong> has been successfully processed and sent to the recipient, <strong>${recipient_name}</strong>.<br><br>

        This transaction was sent through our agent: <strong>${agent_name}</strong> and is pending approval.<br><br>

        If you did not authorize this request, please contact our support team immediately.<br><br>

        Best regards,<br>
        <strong>First Step Payments Team</strong>
      `
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




exports.CashPickupRegUser = async (req, res) => {
  const conn = await pool.getConnection();

  try {
    // -------------------------------------------------------------
    // 0. Extract inputs
    // -------------------------------------------------------------
    const {
      agent_id,
      amount,
      transaction_pin,
      note = "",
      save_beneficiary = false,
      receivers_fullname,
      receivers_phonenumber,
      receivers_city,
    } = req.body;

    const { user_id: sender_id } = req.user || {};

    if (
      !sender_id ||
      !agent_id ||
      !amount ||
      !transaction_pin ||
      !receivers_fullname ||
      !receivers_phonenumber ||
      !receivers_city ||
      Number(amount) <= 0
    ) {
      return res.status(400).json({
        status: false,
        message: "All required fields must be provided",
      });
    }

    // -------------------------------------------------------------
    // 1. Confirm sender
    // -------------------------------------------------------------
    const [sender] = await conn.query(
      "SELECT user_id, email_address, first_name FROM users_account WHERE user_id=? LIMIT 1",
      [sender_id]
    );

    if (!sender.length) {
      return res.status(404).json({ status: false, message: "Sender not found" });
    }

    const senderEmail = sender[0].email_address;
    const first_name = sender[0].first_name;

    // -------------------------------------------------------------
    // 2. Confirm agent
    // -------------------------------------------------------------
    const [agent] = await conn.query(
      `
      SELECT user_id, agent_id, first_name, last_name
      FROM users_account
      WHERE agent_id=?
      LIMIT 1
      `,
      [agent_id]
    );

    if (!agent.length) {
      return res.status(404).json({ status: false, message: "Agent not found" });
    }

    const agent_id_db = agent[0].agent_id;
    const agent_name = `${agent[0].first_name} ${agent[0].last_name}`;

    // -------------------------------------------------------------
    // 3. Validate transaction PIN
    // -------------------------------------------------------------
    const [pinRow] = await conn.query(
      "SELECT pin FROM transaction_pin WHERE user_id=? LIMIT 1",
      [sender_id]
    );

    if (!pinRow.length) {
      return res.status(400).json({
        status: false,
        message: "You have not set a transaction PIN",
      });
    }

    // Compare encrypted PIN
    const decryptedPin = decrypt(pinRow[0].pin);

    if (decryptedPin !== transaction_pin) {
      return res.status(400).json({
        status: false,
        message: "Invalid transaction PIN",
      });
    }

    // -------------------------------------------------------------
    // 4. Prevent duplicate pickup (5 mins)
    // -------------------------------------------------------------
    const [duplicate] = await conn.query(
      `
      SELECT request_id FROM pickup_request
      WHERE sender_id=? 
        AND agent_id=? 
        AND amount=? 
        AND receivers_phone=? 
        AND status='PENDING'
        AND created_at >= NOW() - INTERVAL 5 MINUTE
      LIMIT 1
      `,
      [sender_id, agent_id_db, amount, receivers_phonenumber]
    );

    if (duplicate.length) {
      return res.status(409).json({
        status: false,
        message: "Duplicate pickup request detected. Please wait 5 minutes.",
      });
    }

    // -------------------------------------------------------------
    // 5. Begin transaction
    // -------------------------------------------------------------
    await conn.beginTransaction();

    // -------------------------------------------------------------
    // 6. Atomic wallet debit
    // -------------------------------------------------------------
    const [walletUpdate] = await conn.query(
      `
      UPDATE wallet_balance
      SET balance = balance - ?, date_modified = NOW()
      WHERE email_address = ? AND balance >= ?
      `,
      [amount, senderEmail, amount]
    );

    if (walletUpdate.affectedRows === 0) {
      await conn.rollback();
      return res.status(400).json({
        status: false,
        message: "Insufficient wallet balance",
      });
    }

    // -------------------------------------------------------------
    // 7. Save beneficiary (others)
    // -------------------------------------------------------------
    if (save_beneficiary === true) {
      await conn.query(
        `
        INSERT IGNORE INTO beneficiary_others
          (user_id, fullname, phone_number, city, date_created)
        VALUES (?, ?, ?, ?, NOW())
        `,
        [sender_id, receivers_fullname, receivers_phonenumber, receivers_city]
      );
    }

    // -------------------------------------------------------------
    // 8. Generate IDs
    // -------------------------------------------------------------
    const pickup_code = Math.floor(
      1000000000 + Math.random() * 9000000000
    ).toString();

    const request_id = `FSF-${pickup_code}`;
    const transaction_id = await generatePickupTransactionId();

    // -------------------------------------------------------------
    // 9. Insert pickup request
    // -------------------------------------------------------------
    await conn.query(
      `
      INSERT INTO pickup_request (
        request_id,
        transaction_id,
        pickup_code,
        sender_id,
        agent_id,
        amount,
        note,
        receivers_fullname,
        receivers_phone,
        receivers_city,
        status,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', NOW())
      `,
      [
        request_id,
        transaction_id,
        pickup_code,
        sender_id,
        agent_id_db,
        amount,
        note,
        receivers_fullname,
        receivers_phonenumber,
        receivers_city,
      ]
    );

    // -------------------------------------------------------------
    // 10. Commit
    // -------------------------------------------------------------
    await conn.commit();

    // -------------------------------------------------------------
    // 11. Email (non-blocking)
    // -------------------------------------------------------------
    try {
      sendMail(
        senderEmail,
        `Cash Pickup Request of SLE${amount}`,
        `
        Hello <strong>${first_name}</strong>,<br><br>
        Your cash pickup request of <strong>SLE${amount}</strong> has been created.<br><br>
        Receiver: <strong>${receivers_fullname}</strong><br>
        Phone: <strong>${receivers_phonenumber}</strong><br>
        City: <strong>${receivers_city}</strong><br>
        Agent: <strong>${agent_name}</strong><br><br>
        Status: Pending approval.<br><br>
        <strong>First Step Payments Team</strong>
        `
      );
    } catch (mailErr) {
      console.error("Pickup email failed:", mailErr);
    }

    // -------------------------------------------------------------
    // 12. Response
    // -------------------------------------------------------------
    return res.status(200).json({
      status: true,
      message: "Cash pickup request created successfully",
      request_id,
      pickup_code,
      valid_until: new Date(Date.now() + 7 * 86400000).toDateString(),
    });

  } catch (err) {
    await conn.rollback();
    console.error("CashPickupRegUser error:", err);
    return res.status(500).json({
      status: false,
      message: "Server error while processing pickup request",
    });
  } finally {
    conn.release();
  }
};
