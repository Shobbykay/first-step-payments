const { sha1Hex, hashPassword } = require("../../utils/utilities");
const pool = require('../../services/db');
const jwt = require("jsonwebtoken");
const { sendMail } = require("../../utils/mailHelper");
const crypto = require('crypto');
const logAction = require("../../utils/logger");


exports.transferRate = async (req, res) => {
  try {
    // Fetch all transfer rates
    const [rows] = await pool.query("SELECT currency_from, currency_to, current_rate As value, currency FROM transfer_rates");

    // Get last updated date from table (max date_modified or created_at)
    const [lastUpdatedRow] = await pool.query(
      "SELECT MAX(last_updated) AS last_updated_date FROM transfer_rates"
    );

    const last_updated_date = lastUpdatedRow[0]?.last_updated_date || null;

    return res.status(200).json({
      status: true,
      message: "Transfer rates fetched successfully",
      data: {
        transfer_rates: rows,
        last_updated_date,
      },
    });
  } catch (err) {
    console.error("Fetch transfer rates error:", err);
    return res.status(500).json({
      status: false,
      message: "Server error while fetching transfer rates",
    });
  }
};






exports.fxRate = async (req, res) => {
  try {
    // Fetch all transfer rates
    const [rows] = await pool.query("SELECT * FROM transfer_rates");

    return res.status(200).json({
      status: true,
      message: "Transfer rates fetched successfully",
      data: rows
    });
  } catch (err) {
    console.error("Fetch transfer rates error:", err);
    return res.status(500).json({
      status: false,
      message: "Server error while fetching transfer rates",
    });
  }
};









exports.transfersService = async (req, res) => {
  try {
    // Fetch all transfer rates
    const [rows] = await pool.query("SELECT * FROM transfers_service");

    return res.status(200).json({
      status: true,
      message: "Transfers Service fetched successfully",
      data: rows
    });
  } catch (err) {
    console.error("Fetch transfer service error:", err);
    return res.status(500).json({
      status: false,
      message: "Server error while fetching transfer service",
    });
  }
};





exports.getAgentCommissionFees = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, transaction_type, commission_type, value, date_modified 
       FROM agents_commission_fee`
    );

    return res.status(200).json({
      status: true,
      message: "Agent commission fees fetched successfully",
      data: rows.map(row => ({
        id: row.id,
        transaction_type: row.transaction_type,
        commission_type: row.commission_type,
        value: row.value,
        last_updated: row.date_modified
      }))
    });
  } catch (err) {
    console.error("Fetch agent commission fees error:", err);
    return res.status(500).json({
      status: false,
      message: "Server error while fetching commission fees",
    });
  }
};







exports.updateAgentCommissionFee = async (req, res) => {
  const { id } = req.params; // commission ID
  const { transaction_type, commission_type, value } = req.body;
  const admin_id = req.user?.email || "SYSTEM";

  try {
    // Validate required fields
    if (!transaction_type || !commission_type || !value) {
      return res.status(400).json({
        status: false,
        message: "transaction_type, commission_type, and value are required",
      });
    }

    // Update row
    const [result] = await pool.query(
      `UPDATE agents_commission_fee 
       SET transaction_type = ?, commission_type = ?, value = ?, date_modified = NOW()
       WHERE id = ?`,
      [transaction_type, commission_type, value, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        status: false,
        message: "Commission fee record not found",
      });
    }

    // Log action
    await logAction({
      user_id: req.user?.user_id || null,
      action: "UPDATE_AGENT_COMMISSION_FEE",
      log_message: `Commission fee updated (ID ${id}) by ${admin_id}`,
      status: "SUCCESS",
      action_by: admin_id,
    });

    return res.status(200).json({
      status: true,
      message: "Commission fee updated successfully",
      data: {
        id,
        transaction_type,
        commission_type,
        value
      }
    });
  } catch (err) {
    console.error("Update commission fee error:", err);
    return res.status(500).json({
      status: false,
      message: "Server error while updating commission fee",
    });
  }
};