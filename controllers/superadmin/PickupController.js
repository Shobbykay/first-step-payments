const pool = require('../../services/db');
const logAction = require("../../utils/logger");
const { sendMail } = require("../../utils/mailHelper");


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
          a.created_at AS pickup_request_date,
          a.recipient_user_id,
          CONCAT(c.first_name, ' ', c.last_name) AS recipient_name,
          a.agent_id,
          CONCAT(d.first_name, ' ', d.last_name) AS agent_name,
          a.amount,
          a.note,
          a.status
       FROM pickup_request a
       LEFT JOIN users_account b ON a.sender_id = b.user_id
       LEFT JOIN users_account c ON a.recipient_user_id = c.user_id
       LEFT JOIN users_account d ON a.agent_id = d.user_id
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
