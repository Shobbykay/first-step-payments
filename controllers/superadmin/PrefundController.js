const pool = require('../../services/db');
const logAction = require("../../utils/logger");

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
      `SELECT p.id, p.user_id, u.first_name, u.last_name, u.email_address, 
              p.amount, p.initiated_by, a.fullname AS admin_full_name,
              p.approved_by, p.approved_date, p.date_created
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