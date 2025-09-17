const { sha1Hex } = require("../../utils/utilities");
const pool = require('../../services/db');
const { sendMail } = require("../../utils/mailHelper");
const logAction = require("../../utils/logger");


exports.fetchLogs = async (req, res) => {
  try {
    let page = parseInt(req.query.page) || 1;
    let limit = 30;
    let offset = (page - 1) * limit;

    // Get total count
    const [countResult] = await pool.query("SELECT COUNT(*) as total FROM audit_logs");
    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limit);

    // Fetch logs
    const [rows] = await pool.query(
      `SELECT id, user_id, action, log_message, status, action_by, date_created
       FROM audit_logs
       ORDER BY date_created DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    // Format rows: add log_id
    const formattedRows = rows.map((log) => {
      let paddedId = log.id.toString().padStart(4, "0"); // ensures min 4 digits
      return {
        ...log,
        log_id: `LOG-${paddedId}`,
      };
    });

    return res.json({
      status: true,
      message: "Logs fetched successfully",
      data: {
        pagination: {
          total,
          page,
          totalPages,
          limit,
        },
        records: formattedRows,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: false, message: "Server error" });
  }
};


exports.fetchSingleLog = async (req, res) => {
  try {
    const { id } = req.params;

    // Fetch the log by id
    const [rows] = await pool.query(
      `SELECT id, user_id, action, log_message, status, action_by, date_created
       FROM audit_logs
       WHERE id = ?
       LIMIT 1`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(200).json({
        status: false,
        message: "Log not found",
      });
    }

    // Format log_id
    let paddedId = rows[0].id.toString().padStart(4, "0");

    const formattedLog = {
      ...rows[0],
      log_id: `LOG-${paddedId}`,
    };

    return res.json({
      status: true,
      message: "Log fetched successfully",
      data: formattedLog,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: false, message: "Server error" });
  }
};
