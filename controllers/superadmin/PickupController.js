const pool = require('../../services/db');
const logAction = require("../../utils/logger");
const { sendMail } = require("../../utils/mailHelper");
// const emailQueue = require("../queues/emailQueue");


// List all pending pickup requests (paginated)
exports.listPendingPickupRequest = async (req, res) => {
  try {
    let page = parseInt(req.query.page) || 1;
    let limit = parseInt(req.query.limit) || 10; // default 10
    let offset = (page - 1) * limit;

    // Count total PENDING pickup requests
    const [countResult] = await pool.query(
      `SELECT COUNT(*) AS total
       FROM pickup_request 
       WHERE status = 'PENDING'`
    );

    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limit);

    // Fetch pending pickup requests
    const [rows] = await pool.query(
      `SELECT 
          a.request_id,
          a.transaction_id,
          a.pickup_code,
          a.sender_id,
          CONCAT(b.first_name, ' ', b.last_name) AS sender_name,
          a.receivers_fullname,
          a.receivers_phone,
          a.receivers_city,
          a.created_at AS pickup_request_date,
          a.agent_id,
          CONCAT(d.first_name, ' ', d.last_name) AS agent_name,
          a.amount,
          a.note,
          a.status
       FROM pickup_request a
       LEFT JOIN users_account b ON a.sender_id = b.user_id
       LEFT JOIN users_account d ON a.agent_id = d.agent_id
       WHERE a.status = 'PENDING'
       ORDER BY a.created_at DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    return res.json({
      status: true,
      message: "Pending pickup requests fetched successfully",
      data: {
        pagination: {
          total,
          page,
          totalPages,
          limit
        },
        records: rows
      }
    });

  } catch (err) {
    console.error("List Pending Pickup Request Error:", err);
    return res.status(500).json({
      status: false,
      message: "Server error"
    });
  }
};



exports.approvePickupRequest = async (req, res) => {
  const user_id = req.user?.user_id || "SYSTEM";
  const connection = await pool.getConnection();

  try {
    const { request_id } = req.body;
    const admin_id = user_id;

    if (!request_id) {
      return res.status(400).json({
        status: false,
        message: "request_id is required"
      });
    }

    // 1. Check if request exists
    const [reqRows] = await connection.query(
      "SELECT * FROM pickup_request WHERE request_id = ?",
      [request_id]
    );

    if (reqRows.length === 0) {
      return res.status(400).json({
        status: false,
        message: "Pickup request not found"
      });
    }

    const requestData = reqRows[0];

    // Check status
    if (requestData.status !== "PENDING") {
      return res.status(400).json({
        status: false,
        message: "Only PENDING pickup requests can be approved"
      });
    }

    const {
      transaction_id,
      sender_id,
      recipient_user_id,
      agent_id,
      amount,
      pickup_code,
      note
    } = requestData;

    // Start transaction
    await connection.beginTransaction();

    // 2. Update pickup_request → APPROVE
    await connection.query(
      `UPDATE pickup_request 
       SET status = 'APPROVED',
       approved_by = ?,
       approved_date = NOW()
       WHERE request_id = ?`,
      [admin_id, request_id]
    );

    // get agent details
    const [agent] = await pool.query(
      "SELECT user_id, agent_id, email_address, first_name, last_name, phone_number FROM users_account WHERE user_id = ? LIMIT 1",
      [agent_id]
    );

    const agent_name = agent[0].first_name + " " + agent[0].last_name;
    const agent_email = agent[0].email_address;
    const agent_phone_number = agent[0].phone_number;


    // get sender details
    const [sender] = await pool.query(
      "SELECT user_id, email_address, first_name, last_name FROM users_account WHERE user_id = ? LIMIT 1",
      [sender_id]
    );

    const senderEmail = sender[0].email_address;
    const sender_name = sender[0].first_name + " " + sender[0].last_name;


    // get receiver details
    const [recipient] = await pool.query(
      "SELECT user_id, email_address, first_name, last_name FROM users_account WHERE user_id = ? LIMIT 1",
      [recipient_user_id]
    );

    const recipient_name = recipient[0].first_name + " " + recipient[0].last_name;
    const recipientEmail = recipient.email_address;


    // 3. Insert into transactions
    const charges = 0;
    const amount_received = amount - charges;

    await connection.query(
      `INSERT INTO transactions
      (transaction_id, user_id, recipient_user_id, trans_type, amount, charges, amount_received, pickup_code, pickup_date, note, transfer_status, status, date_created)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, 'COMPLETED', 'SUCCESSFUL', NOW())`,
      [
        transaction_id,         // transaction_id
        sender_id,              // user_id
        recipient_user_id,      // recipient_user_id
        "CASH_PICKUP",          // trans_type
        amount,                 // amount
        charges,                // charges
        amount_received,        // amount_received
        pickup_code,            // pickup_code
        note                    // note
      ]
    );


    // update agent balance
    await pool.query(
      `INSERT INTO wallet_balance (email_address, balance)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE
        balance = balance + VALUES(balance),
        date_modified = NOW()`,
      [agent_email, amount]
    );


    // Commit
    await connection.commit();


    // Background emails
    // To Sender
    sendMail(
      senderEmail,
      "Your Pickup Request of SLE" + amount + " Has Been Approved",
      `
        Hello <strong>${sender_name}</strong>,<br><br>

        Your cash pickup request of <strong>SLE${amount}</strong> has been <strong>approved</strong>.<br><br>

        The funds will be delivered to <strong>${recipient_name}</strong> by our agent, 
        <strong>${agent_name}</strong>, on <strong>${new Date().toLocaleString()}</strong>.<br><br>

        If you did not authorize this request, please contact our support team immediately.<br><br>

        Best regards,<br>
        <strong>First Step Payments Team</strong>
      `
    );


    // To Recipient
    sendMail(
      recipientEmail,
      "You Have a Cash Pickup of SLE" + amount,
      `
        Good day <strong>${recipient_name}</strong>,<br><br>

        <strong>${sender_name}</strong> has sent you <strong>SLE${amount}</strong> via First Step Payments.<br><br>

        Please meet our agent: <strong>${agent_name}</strong><br>
        Phone: <strong>${agent_phone_number}</strong><br><br>

        Present your pickup code to receive your cash.<br><br>

        If you did not expect this transaction, please contact support immediately.<br><br>

        Best regards,<br>
        <strong>First Step Payments Team</strong>
      `
    );



    // To Agent Email
    sendMail(
      agent_email,
      "Approved Cash Pickup Request – SLE" + amount,
      `
        Hello <strong>${agent_name}</strong>,<br><br>

        The cash pickup request of <strong>SLE${amount}</strong> from 
        <strong>${sender_name}</strong> to <strong>${recipient_name}</strong> has been 
        <strong>approved</strong>.<br><br>

        You may now proceed to deliver the cash to the recipient and complete the transaction.<br><br>

        Ensure proper verification before handing over the funds.<br><br>

        Best regards,<br>
        <strong>First Step Payments Team</strong>
      `
    );



    return res.json({
      status: true,
      message: "Pickup request approved successfully",
      data: {
        request_id,
        transaction_id,
        amount,
        amount_received,
        status: "APPROVED"
      }
    });

  } catch (err) {
    console.error("Approve Pickup Request Error:", err);
    if (connection) await connection.rollback();
    return res.status(500).json({
      status: false,
      message: "Server error"
    });
  } finally {
    if (connection) connection.release();
  }
};





exports.cancelPickupRequest = async (req, res) => {
  const user_id = req.user?.user_id || "SYSTEM";
  const connection = await pool.getConnection();

  try {
    const { request_id } = req.body;

    if (!request_id) {
      return res.status(400).json({
        status: false,
        message: "request_id is required"
      });
    }

    // Check if request exists
    const [reqRows] = await connection.query(
      "SELECT * FROM pickup_request WHERE request_id = ?",
      [request_id]
    );

    if (reqRows.length === 0) {
      return res.status(404).json({
        status: false,
        message: "Pickup request not found"
      });
    }

    const requestData = reqRows[0];

    // Only PENDING requests can be cancelled
    if (requestData.status !== "PENDING") {
      return res.status(400).json({
        status: false,
        message: "Only PENDING pickup requests can be cancelled"
      });
    }

    const {
      sender_id,
      recipient_user_id,
      agent_id,
      amount
    } = requestData;

    // Fetch sender, recipient, agent for optional notifications
    const [[sender]] = await connection.query(
      "SELECT first_name, last_name, email_address FROM users_account WHERE user_id = ? LIMIT 1",
      [sender_id]
    );

    const [[recipient]] = await connection.query(
      "SELECT first_name, last_name, email_address FROM users_account WHERE user_id = ? LIMIT 1",
      [recipient_user_id]
    );

    const [[agent]] = await connection.query(
      "SELECT first_name, last_name, email_address FROM users_account WHERE user_id = ? LIMIT 1",
      [agent_id]
    );

    const sender_name = sender.first_name + " " + sender.last_name;
    const recipient_name = recipient.first_name + " " + recipient.last_name;
    const agent_name = agent.first_name + " " + agent.last_name;

    // Start DB transaction
    await connection.beginTransaction();


    // Update pickup_request → CANCELLED
    await connection.query(
      `UPDATE pickup_request 
       SET status = 'CANCELLED',
       canceled_by = ?,
       canceled_date = NOW()
       WHERE request_id = ?`,
      [user_id, request_id]
    );


    // refund logic for sender wallet

    
    await connection.query(
      `INSERT INTO wallet_balance (email_address, balance)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE
         balance = balance + VALUES(balance),
         date_modified = NOW()`,
      [sender.email_address, amount]
    );


    // Commit transaction
    await connection.commit();


    // ------------------------------
    // Background Emails
    // ------------------------------

    // Notify Sender
    sendMail(
      sender.email_address,
      "Your Pickup Request Has Been Cancelled",
      `
      Hello <strong>${sender_name}</strong>,<br><br>
      Your pickup request of <strong>SLE${amount}</strong> has been <strong>cancelled</strong>.<br><br>
      If this was not done by you, please contact support immediately.<br><br>
      Best regards,<br>
      <strong>First Step Payments Team</strong>
      `
    );

    // Notify Recipient
    sendMail(
      recipient.email_address,
      "Cash Pickup Request Cancelled",
      `
      Hello <strong>${recipient_name}</strong>,<br><br>
      The pickup request of <strong>SLE${amount}</strong> sent to you has been cancelled.<br><br>
      If you have any concerns, please contact our support team.<br><br>
      Best regards,<br>
      <strong>First Step Payments Team</strong>
      `
    );

    // Notify Agent
    sendMail(
      agent.email_address,
      "Pickup Request Cancelled",
      `
      Hello <strong>${agent_name}</strong>,<br><br>
      The pickup request assigned to you (Amount: <strong>SLE${amount}</strong>) has been cancelled.<br><br>
      No further action is required on this request.<br><br>
      Best regards,<br>
      <strong>First Step Payments Team</strong>
      `
    );



    // Final Response
    return res.json({
      status: true,
      message: "Pickup request cancelled successfully",
      data: {
        request_id,
        amount,
        status: "CANCELLED"
      }
    });

  } catch (err) {
    console.error("Cancel Pickup Request Error:", err);
    if (connection) await connection.rollback();

    return res.status(500).json({
      status: false,
      message: "Server error"
    });
  } finally {
    if (connection) connection.release();
  }
};




exports.listApprovedPickupRequest = async (req, res) => {
  try {
    let page = parseInt(req.query.page) || 1;
    let limit = parseInt(req.query.limit) || 10;
    let offset = (page - 1) * limit;

    // Count total APPROVED pickup requests
    const [countResult] = await pool.query(
      `SELECT COUNT(*) AS total 
       FROM pickup_request 
       WHERE status = 'APPROVED'`
    );

    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limit);

    // Fetch approved pickup requests
    const [rows] = await pool.query(
      `
      SELECT 
        a.request_id,
        a.transaction_id,
        a.pickup_code,
        a.sender_id,
        CONCAT(b.first_name, ' ', b.last_name) AS sender_name,
        a.created_at AS pickup_request_date,
        a.recipient_user_id,
        CONCAT(c.first_name, ' ', c.last_name) AS recipient_name,
        a.agent_id,
        CONCAT(d.first_name, ' ', d.last_name) AS agent_name,
        a.amount,
        a.note,
        a.status,
        a.approved_by,
        a.approved_date
      FROM pickup_request a
      LEFT JOIN users_account b ON a.sender_id = b.user_id
      LEFT JOIN users_account c ON a.recipient_user_id = c.user_id
      LEFT JOIN users_account d ON a.agent_id = d.user_id
      WHERE a.status = 'APPROVED'
      ORDER BY a.approved_date DESC
      LIMIT ? OFFSET ?
      `,
      [limit, offset]
    );

    return res.json({
      status: true,
      message: "Approved pickup requests fetched successfully",
      data: {
        pagination: {
          total,
          page,
          totalPages,
          limit
        },
        records: rows
      }
    });

  } catch (err) {
    console.error("List Approved Pickup Request Error:", err);
    return res.status(500).json({
      status: false,
      message: "Server error"
    });
  }
};





exports.listCancelledPickupRequest = async (req, res) => {
  try {
    let page = parseInt(req.query.page) || 1;
    let limit = parseInt(req.query.limit) || 10;
    let offset = (page - 1) * limit;

    // Count total CANCELLED pickup requests
    const [countResult] = await pool.query(
      `SELECT COUNT(*) AS total 
       FROM pickup_request 
       WHERE status = 'CANCELLED'`
    );

    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limit);

    // Fetch cancelled pickup requests
    const [rows] = await pool.query(
      `
      SELECT 
        a.request_id,
        a.transaction_id,
        a.pickup_code,
        a.sender_id,
        CONCAT(b.first_name, ' ', b.last_name) AS sender_name,
        a.created_at AS pickup_request_date,
        a.recipient_user_id,
        CONCAT(c.first_name, ' ', c.last_name) AS recipient_name,
        a.agent_id,
        CONCAT(d.first_name, ' ', d.last_name) AS agent_name,
        a.amount,
        a.note,
        a.status,
        a.canceled_by,
        a.canceled_date
      FROM pickup_request a
      LEFT JOIN users_account b ON a.sender_id = b.user_id
      LEFT JOIN users_account c ON a.recipient_user_id = c.user_id
      LEFT JOIN users_account d ON a.agent_id = d.user_id
      WHERE a.status = 'CANCELLED'
      ORDER BY a.canceled_date DESC
      LIMIT ? OFFSET ?
      `,
      [limit, offset]
    );

    return res.json({
      status: true,
      message: "Cancelled pickup requests fetched successfully",
      data: {
        pagination: {
          total,
          page,
          totalPages,
          limit
        },
        records: rows
      }
    });

  } catch (err) {
    console.error("List Cancelled Pickup Request Error:", err);
    return res.status(500).json({
      status: false,
      message: "Server error"
    });
  }
};
