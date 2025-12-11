const pool = require('../services/db');
const logAction = require("../utils/logger");
const { sendMail } = require("../utils/mailHelper");


// Wallet to Wallet Transfer
exports.sendMoneyToRecipient_W2W = async (req, res) => {
  const conn = await pool.getConnection();
  await conn.beginTransaction();

  try {
    const { user_id } = req.user || {};
    const { recipient_user_id, amount, note, save_beneficiary } = req.body;

    if (!recipient_user_id || !amount) {
      return res.status(400).json({ status: false, message: "recipient_user_id and amount are required" });
    }

    if (user_id === recipient_user_id) {
      return res.status(400).json({ status: false, message: "You cannot send money to yourself" });
    }

    // ---------------------------------------------
    // Get sender email
    // ---------------------------------------------
    const [senderRows] = await conn.query(
      "SELECT email_address, first_name, last_name FROM users_account WHERE user_id=?",
      [user_id]
    );

    if (senderRows.length === 0) {
      return res.status(404).json({ status: false, message: "Sender account not found" });
    }

    const sender_email = senderRows[0].email_address;
    const sender_name = senderRows[0].first_name + " " + senderRows[0].last_name;

    // ---------------------------------------------
    // Validate recipient exists
    // ---------------------------------------------
    const [recipientRows] = await conn.query(
      "SELECT email_address, first_name, last_name FROM users_account WHERE user_id=?",
      [recipient_user_id]
    );

    if (recipientRows.length === 0) {
      return res.status(404).json({ status: false, message: "Recipient not found" });
    }

    const recipient_email = recipientRows[0].email_address;
    const recipient_name = recipientRows[0].first_name + " " + recipientRows[0].last_name;

    // ---------------------------------------------
    // Check wallet balance
    // ---------------------------------------------
    const [balRows] = await conn.query(
      "SELECT balance FROM wallet_balance WHERE email_address=?",
      [sender_email]
    );

    if (balRows.length === 0) {
      return res.status(400).json({ status: false, message: "Insufficient balance" });
    }

    let senderBalance = parseFloat(balRows[0].balance);

    if (senderBalance < amount) {
      return res.status(400).json({ status: false, message: "Insufficient balance" });
    }


    // Prevent duplicate transaction within last 5 minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const [dupRows] = await conn.query(
      `SELECT * FROM transactions
       WHERE user_id = ? AND recipient_user_id = ? AND amount = ? AND date_created >= ?`,
      [user_id, recipient_user_id, amount, fiveMinutesAgo]
    );

    if (dupRows.length > 0) {
      return res.status(400).json({ status: false, message: "Duplicate transaction detected within last 5 minutes" });
    }


    // ---------------------------------------------
    // Debit sender
    // ---------------------------------------------
    await conn.query(
      "UPDATE wallet_balance SET balance = balance - ? WHERE email_address=?",
      [amount, sender_email]
    );

    // ---------------------------------------------
    // Credit recipient
    // ---------------------------------------------
    await conn.query(
      `INSERT INTO wallet_balance (email_address, balance)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE balance = balance + VALUES(balance)`,
      [recipient_email, amount]
    );

    // ---------------------------------------------
    // Save Beneficiary (Optional)
    // ---------------------------------------------
    if (save_beneficiary === true) {
      await conn.query(
        "INSERT IGNORE INTO beneficiary(user_id, recipient_user_id, date_created) VALUES (?, ?, NOW())",
        [user_id, recipient_user_id]
      );
    }

    // ---------------------------------------------
    // Create transaction record
    // ---------------------------------------------
    const timestamp = Date.now();
    const transaction_id = `FSF-${timestamp}`;

    await conn.query(
      `INSERT INTO transactions
      (transaction_id, user_id, recipient_user_id, trans_type, amount, charges, amount_received, note, transfer_status, status, date_created)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        transaction_id,
        user_id,
        recipient_user_id,
        "WALLET_TRANSFER",
        amount,
        0,                 // charges
        amount,                 // amount_received
        note || null,
        "COMPLETED",
        "SUCCESSFUL"
      ]
    );

    await conn.commit();


    // Sender Email
    sendMail(
      sender_email,
      `You Sent SLE${amount} Successfully`,
      `
        Hello <strong>${sender_name}</strong>,<br><br>

        Your wallet transfer of <strong>SLE${amount}</strong> to 
        <strong>${recipient_name}</strong> has been <strong>completed successfully</strong>.<br><br>

        Transaction ID: <strong>${transaction_id}</strong><br>
        Date: <strong>${new Date().toLocaleString()}</strong><br><br>

        ${note ? `Note: ${note}<br><br>` : ""}

        If you did not authorize this transaction, please contact our support team immediately.<br><br>

        Best regards,<br>
        <strong>First Step Payments Team</strong>
      `
    );


    // Recipient Email
    sendMail(
      recipient_email,
      `You Received SLE${amount} from ${sender_name}`,
      `
        Hello <strong>${recipient_name}</strong>,<br><br>

        <strong>${sender_name}</strong> has sent you <strong>SLE${amount}</strong> via First Step Payments.<br><br>

        Transaction ID: <strong>${transaction_id}</strong><br>
        Date: <strong>${new Date().toLocaleString()}</strong><br><br>

        ${note ? `Note: ${note}<br><br>` : ""}

        Please check your wallet balance to confirm the funds have been credited.<br><br>

        If you did not expect this transaction, please contact support immediately.<br><br>

        Best regards,<br>
        <strong>First Step Payments Team</strong>
      `
    );

    return res.status(200).json({
      status: true,
      message: "Transfer successful",
      transaction_id,
      amount,
      recipient_user_id,
      provider: 'First Step Financials'
    });

  } catch (error) {
    await conn.rollback();
    console.error(error);
    return res.status(500).json({ status: false, message: "Internal Server Error" });
  } finally {
    conn.release();
  }
};
