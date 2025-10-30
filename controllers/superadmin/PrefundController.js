const pool = require('../../services/db');
const logAction = require("../../utils/logger");
const { sendMail } = require("../../utils/mailHelper");

// Prefunding Controller
exports.createPrefunding = async (req, res) => {
  try {
    const { user_id, amount } = req.body;
    const initiated_by = req.user?.email; // from middleware (admin_id)

    // Validate input
    if (!user_id || !amount) {
      return res.status(400).json({ status: false, message: "user_id and amount are required" });
    }

    if (amount <= 50) {
      return res.status(400).json({ status: false, message: "Amount must be greater than 50" });
    }

    if (!initiated_by) {
      return res.status(401).json({ status: false, message: "Unauthorized: missing admin_id" });
    }

    // Check if agent exists
    const [agentRows] = await pool.query(
      "SELECT user_id FROM users_account WHERE user_id = ? AND account_type = 'AGENT' AND status='1' LIMIT 1",
      [user_id]
    );

    if (agentRows.length === 0) {
      return res.status(404).json({ status: false, message: "Agent record not found or pending verification" });
    }

    // Insert prefunding record
    await pool.query(
      "INSERT INTO prefunding (user_id, amount, initiated_by) VALUES (?, ?, ?)",
      [user_id, amount, initiated_by]
    );

    // Log success
    await logAction({
      user_id,
      action: "PREFUNDING",
      log_message: `Prefunding of amount ${amount} for agent ${user_id} created successfully`,
      status: "SUCCESS",
      action_by: initiated_by
    });

    return res.status(201).json({
      status: true,
      message: "Prefunding created successfully",
      data: { user_id, amount, initiated_by }
    });
  } catch (err) {
    console.error("Create Prefunding Error:", err);
    return res.status(500).json({ status: false, message: "Server error" });
  }
};




// List all prefunding records (paginated)
exports.listPrefunding = async (req, res) => {
  try {
    let page = parseInt(req.query.page) || 1;
    let limit = parseInt(req.query.limit) || 10; // default 10
    let offset = (page - 1) * limit;

    // Get total count
    const [countResult] = await pool.query("SELECT COUNT(*) as total FROM prefunding");
    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limit);

    // Fetch prefunding records
    const [rows] = await pool.query(
      `SELECT p.id, u.agent_id, u.business_name, u.phone_number contact, p.user_id, u.first_name, u.last_name, u.email_address, 
              p.amount, p.initiated_by, a.fullname AS admin_full_name, u.business_name,
              p.approved_by, p.approved_date, p.status, p.date_created
       FROM prefunding p
       JOIN users_account u ON p.user_id = u.user_id
       JOIN admin_users a ON p.initiated_by = a.email_address
       ORDER BY p.date_created DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    return res.json({
      status: true,
      message: "Prefunding records fetched successfully",
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
    console.error("List Prefunding Error:", err);
    return res.status(500).json({ status: false, message: "Server error" });
  }
};






exports.approvePrefund = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { id } = req.params;
    const { approval_note } = req.body || {};
    const approved_by = req.user?.email || "SYSTEM";

    if (!id) {
      return res.status(400).json({
        status: false,
        message: "Prefund id is required",
      });
    }

    await connection.beginTransaction();

    // Fetch prefund record
    const [prefundRows] = await connection.query(
      `SELECT user_id, amount, status FROM prefunding WHERE id = ? LIMIT 1`,
      [id]
    );

    if (prefundRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        status: false,
        message: "Prefund record not found",
      });
    }

    const { user_id, amount } = prefundRows[0];

    // Get user info
    const [userRows] = await connection.query(
      `SELECT first_name, email_address FROM users_account WHERE user_id = ? LIMIT 1`,
      [user_id]
    );

    if (userRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        status: false,
        message: "User not found for this prefund request",
      });
    }

    const { first_name, email_address } = userRows[0];

    // Fetch or create wallet balance
    const [walletRows] = await connection.query(
      `SELECT balance FROM wallet_balance WHERE email_address = ? LIMIT 1`,
      [email_address]
    );

    let currentBalance = 0;

    if (walletRows.length === 0) {
      await connection.query(
        `INSERT INTO wallet_balance (email_address, balance, date_created, date_modified)
         VALUES (?, 0, NOW(), NOW())`,
        [email_address]
      );
      currentBalance = 0;
    } else {
      currentBalance = parseFloat(walletRows[0].balance || 0);
    }

    const newBalance = currentBalance + parseFloat(amount);

    // Update prefund as approved (always allow approval)
    await connection.query(
      `UPDATE prefunding 
       SET status='APPROVED', 
           approved_by=?, 
           approved_date=NOW(),
           approval_note=?
       WHERE id=?`,
      [approved_by, approval_note || null, id]
    );

    // Step 5: Update wallet balance
    await connection.query(
      `UPDATE wallet_balance 
       SET balance=?, date_modified=NOW() 
       WHERE email_address=?`,
      [newBalance, email_address]
    );

    // Insert into transactions table
    const transaction_id = "FSF-" + Date.now() + Math.floor(Math.random() * 1000);
    const charges = 0;
    const amount_received = parseFloat(amount) - charges;

    await connection.query(
      `INSERT INTO transactions 
        (transaction_id, user_id, recipient_user_id, trans_type, amount, charges, amount_received, note, transfer_status, status, date_created)
       VALUES (?, 'SYSTEM', ?, 'PREFUND', ?, ?, ?, ?, 'COMPLETED', 'SUCCESSFUL', NOW())`,
      [
        transaction_id,
        user_id,
        parseFloat(amount),
        charges,
        amount_received,
        approval_note || null,
      ]
    );

    // Log actions
    await logAction({
      user_id,
      action: "APPROVE_PREFUND",
      log_message: `Prefund of ₦${amount} approved and added to wallet. Previous balance: ₦${currentBalance}, New balance: ₦${newBalance}`,
      status: "SUCCESS",
      action_by: approved_by,
    });

    await logAction({
      user_id,
      action: "WALLET_CREDIT",
      log_message: `Wallet credited with ₦${amount} after prefund approval by ${approved_by}. New balance: ₦${newBalance}`,
      status: "SUCCESS",
      action_by: approved_by,
    });

    // Commit changes
    await connection.commit();

    // Send mail
    await sendMail(
      email_address,
      "Prefund Request Approved ✅",
      `Hi <strong>${first_name}</strong>,<br><br>
      Your prefund request of <strong>₦${Number(amount).toLocaleString()}</strong> 
      has been approved successfully.<br><br>
      Your wallet has been credited and your new balance is 
      <strong>₦${Number(newBalance).toLocaleString()}</strong>.<br><br>
      Best regards,<br>
      <strong>FirstStep Financials Team</strong>`
    );

    // Response
    return res.status(200).json({
      status: true,
      message: `Prefund approved successfully and wallet credited with ₦${Number(amount).toLocaleString()}`,
      transaction_id,
      new_balance: newBalance,
    });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error("Error approving prefund:", err);
    return res.status(500).json({
      status: false,
      message: "Server error approving prefund",
    });
  } finally {
    if (connection) connection.release();
  }
};





exports.listPrefundingHistory = async (req, res) => {
  try {
    const { user_id } = req.params;
    let { page = 1, limit = 20 } = req.query;

    page = parseInt(page);
    limit = parseInt(limit);
    const offset = (page - 1) * limit;

    if (!user_id) {
      return res.status(400).json({
        status: false,
        message: "user_id is required",
      });
    }

    // Count total prefund records for pagination
    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total FROM prefunding WHERE user_id = ?`,
      [user_id]
    );
    const total = countRows[0].total;
    const totalPages = Math.ceil(total / limit);

    // Fetch paginated prefund history
    const [rows] = await pool.query(
      `SELECT id, user_id, amount, status, approval_note, approved_by, approved_date, date_created
       FROM prefunding 
       WHERE user_id = ?
       ORDER BY date_created DESC
       LIMIT ? OFFSET ?`,
      [user_id, limit, offset]
    );

    return res.status(200).json({
      status: true,
      message: "Prefunding history fetched successfully",
      pagination: {
        total,
        page,
        limit,
        total_pages: totalPages,
        has_next: page < totalPages,
        has_prev: page > 1,
      },
      data: rows,
    });
  } catch (err) {
    console.error("Error fetching prefunding history:", err);
    return res.status(500).json({
      status: false,
      message: "Server error fetching prefunding history",
    });
  }
};





exports.listPendingPrefunding = async (req, res) => {
  try {
    // Pagination setup
    let page = parseInt(req.query.page) || 1;
    let limit = parseInt(req.query.limit) || 10; // default to 10
    let offset = (page - 1) * limit;

    // Get total count of pending prefunding
    const [countResult] = await pool.query(
      "SELECT COUNT(*) as total FROM prefunding WHERE status = 'PENDING'"
    );
    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limit);

    // Fetch pending prefunding records
    const [rows] = await pool.query(
      `SELECT 
          p.id AS fund_id,
          p.user_id,
          u.agent_id,
          CONCAT(u.first_name, ' ', u.last_name) AS agent_name,
          u.phone_number contact,
          u.profile_img,
          p.amount AS amount_funded,
          p.date_created AS date_inputed,
          p.initiated_by,
          p.status,
          a.fullname AS funded_by
       FROM prefunding p
       LEFT JOIN users_account u ON u.user_id = p.user_id
       LEFT JOIN admin_users a ON a.email_address = p.initiated_by
       WHERE p.status = 'PENDING'
       ORDER BY p.date_created DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    // Response
    return res.json({
      status: true,
      message: "Pending prefunding records fetched successfully",
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
    console.error("List Pending Prefunding Error:", err);
    return res.status(500).json({
      status: false,
      message: "Server error"
    });
  }
};





exports.listApprovedPrefunding = async (req, res) => {
  try {
    // Pagination setup
    let page = parseInt(req.query.page) || 1;
    let limit = parseInt(req.query.limit) || 10; // default 10
    let offset = (page - 1) * limit;

    // Get total count of approved prefunding
    const [countResult] = await pool.query(
      "SELECT COUNT(*) as total FROM prefunding WHERE status = 'APPROVED'"
    );
    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limit);

    // Fetch approved prefunding records
    const [rows] = await pool.query(
      `SELECT 
          p.id AS fund_id,
          p.user_id,
          u.agent_id,
          CONCAT(u.first_name, ' ', u.last_name) AS agent_name,
          u.profile_img,u.phone_number contact,
          p.amount AS amount_funded,
          p.date_created AS date_inputed,
          p.initiated_by,
          a.fullname AS funded_by,
          p.approval_note,
          au.fullname AS approved_name,
          p.approved_by,
          p.approved_date,
          p.status
       FROM prefunding p
       LEFT JOIN users_account u ON u.user_id = p.user_id
       LEFT JOIN admin_users a ON a.email_address = p.initiated_by
       LEFT JOIN admin_users au ON au.email_address = p.approved_by
       WHERE p.status = 'APPROVED'
       ORDER BY p.date_created DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    // Response
    return res.json({
      status: true,
      message: "Approved prefunding records fetched successfully",
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
    console.error("List Approved Prefunding Error:", err);
    return res.status(500).json({
      status: false,
      message: "Server error"
    });
  }
};





exports.listRejectedPrefunding = async (req, res) => {
  try {
    // Pagination setup
    let page = parseInt(req.query.page) || 1;
    let limit = parseInt(req.query.limit) || 10; // default 10
    let offset = (page - 1) * limit;

    // Get total count of rejected prefunding
    const [countResult] = await pool.query(
      "SELECT COUNT(*) as total FROM prefunding WHERE status = 'REJECTED'"
    );
    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limit);

    // Fetch rejected prefunding records
    const [rows] = await pool.query(
      `SELECT 
          p.id AS fund_id,
          p.user_id,
          u.agent_id,
          CONCAT(u.first_name, ' ', u.last_name) AS agent_name,
          u.profile_img,u.phone_number contact,
          p.amount AS amount_funded,
          p.date_created AS date_inputed,
          p.initiated_by,
          a.fullname AS funded_by,
          p.rejected_reason,
          au.fullname AS rejected_name,
          p.rejected_by,
          p.rejected_date,
          p.status
       FROM prefunding p
       LEFT JOIN users_account u ON u.user_id = p.user_id
       LEFT JOIN admin_users a ON a.email_address = p.initiated_by
       LEFT JOIN admin_users au ON au.email_address = p.rejected_by
       WHERE p.status = 'REJECTED'
       ORDER BY p.date_created DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    // Response
    return res.json({
      status: true,
      message: "Rejected prefunding records fetched successfully",
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
    console.error("List Rejected Prefunding Error:", err);
    return res.status(500).json({
      status: false,
      message: "Server error"
    });
  }
};





exports.rejectPrefund = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { id } = req.params;
    const { rejected_reason } = req.body || {};
    const rejected_by = req.user?.email || "SYSTEM";

    if (!id) {
      return res.status(400).json({
        status: false,
        message: "Prefund id is required",
      });
    }

    if (!rejected_reason) {
      return res.status(400).json({
        status: false,
        message: "Rejection reason is required",
      });
    }

    await connection.beginTransaction();

    // Fetch prefund record
    const [prefundRows] = await connection.query(
      `SELECT user_id, amount, status FROM prefunding WHERE id = ? LIMIT 1`,
      [id]
    );

    if (prefundRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        status: false,
        message: "Prefund record not found",
      });
    }

    const { user_id, amount, status } = prefundRows[0];

    // Check if already rejected
    if (status === "REJECTED") {
      await connection.rollback();
      return res.status(400).json({
        status: false,
        message: "This prefund request has already been rejected",
      });
    }

    // Get user info
    const [userRows] = await connection.query(
      `SELECT first_name, email_address FROM users_account WHERE user_id = ? LIMIT 1`,
      [user_id]
    );

    if (userRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        status: false,
        message: "User not found for this prefund request",
      });
    }

    const { first_name, email_address } = userRows[0];

    // Update prefund as rejected
    await connection.query(
      `UPDATE prefunding 
       SET status='REJECTED',
           rejected_reason=?,
           rejected_by=?,
           rejected_date=NOW()
       WHERE id=?`,
      [rejected_reason, rejected_by, id]
    );

    // Log actions
    await logAction({
      user_id,
      action: "REJECT_PREFUND",
      log_message: `Prefund of ₦${amount} rejected. Reason: ${rejected_reason}`,
      status: "SUCCESS",
      action_by: rejected_by,
    });

    // Commit changes
    await connection.commit();

    // Send rejection mail
    await sendMail(
      email_address,
      "Prefund Request Rejected",
      `Hi <strong>${first_name}</strong>,<br><br>
      We regret to inform you that your prefund request of 
      <strong>₦${Number(amount).toLocaleString()}</strong> has been <strong>rejected</strong>.<br><br>
      <strong>Reason:</strong> ${rejected_reason}<br><br>
      You may review your request and try again if necessary.<br><br>
      Best regards,<br>
      <strong>FirstStep Financials Team</strong>`
    );

    // Response
    return res.status(200).json({
      status: true,
      message: `Prefund rejected successfully. Reason: ${rejected_reason}`,
    });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error("Error rejecting prefund:", err);
    return res.status(500).json({
      status: false,
      message: "Server error rejecting prefund",
    });
  } finally {
    if (connection) connection.release();
  }
};




exports.deletePrefund = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { id } = req.params;
    const deleted_by = req.user?.email || "SYSTEM";

    if (!id) {
      return res.status(400).json({
        status: false,
        message: "Prefund ID is required",
      });
    }

    await connection.beginTransaction();

    // Fetch prefund record
    const [prefundRows] = await connection.query(
      `SELECT user_id, amount, status FROM prefunding WHERE id = ? LIMIT 1`,
      [id]
    );

    if (prefundRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        status: false,
        message: "Prefund record not found",
      });
    }

    const { user_id, amount, status } = prefundRows[0];

    // Only PENDING records can be deleted
    if (status !== "PENDING") {
      await connection.rollback();
      return res.status(400).json({
        status: false,
        message: "Only prefund requests with status 'PENDING' can be deleted",
      });
    }

    // Delete prefund record
    await connection.query(`DELETE FROM prefunding WHERE id = ?`, [id]);

    // Log deletion
    await logAction({
      user_id,
      action: "DELETE_PREFUND",
      log_message: `Prefund record of ₦${amount} (status: ${status}) deleted by ${deleted_by}`,
      status: "SUCCESS",
      action_by: deleted_by,
    });

    // Commit
    await connection.commit();

    // Response
    return res.status(200).json({
      status: true,
      message: "Pending prefund record deleted successfully.",
    });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error("Error deleting prefund:", err);
    return res.status(500).json({
      status: false,
      message: "Server error deleting prefund",
    });
  } finally {
    if (connection) connection.release();
  }
};





exports.getPrefundingMetrics = async (req, res) => {
  try {
    // Combined optimized query using subqueries
    const [metrics] = await pool.query(`
      SELECT 
        COALESCE(SUM(amount), 0) AS total_amount_funded,
        COUNT(DISTINCT user_id) AS total_agents_funded
      FROM prefunding
      WHERE status = 'APPROVED'
    `);

    // Return metrics
    return res.json({
      status: true,
      message: "Prefunding metrics fetched successfully",
      data: metrics[0]
    });
  } catch (err) {
    console.error("Export Prefunding Metrics Error:", err);
    return res.status(500).json({
      status: false,
      message: "Server error"
    });
  }
};
