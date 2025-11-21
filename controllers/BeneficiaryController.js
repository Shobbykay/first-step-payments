const pool = require('../services/db');
const logAction = require("../utils/logger");

exports.listAccountBeneficiaries = async (req, res) => {
  try {
    const { user_id } = req.user || {};

    // 1. Validate user_id
    if (!user_id) {
      return res.status(400).json({
        status: false,
        message: "user_id is required"
      });
    }

    // 2. Verify that the user exists
    const [userRows] = await pool.query(
      "SELECT user_id FROM users_account WHERE user_id = ? LIMIT 1",
      [user_id]
    );

    if (userRows.length === 0) {
      return res.status(404).json({
        status: false,
        message: "User not found"
      });
    }

    // 3. Fetch beneficiaries
    const [rows] = await pool.query(
      `SELECT 
          b.recipient_user_id,
          u.first_name,
          u.last_name,
          u.profile_img,
          u.phone_number
       FROM beneficiary b
       LEFT JOIN users_account u 
         ON b.recipient_user_id = u.user_id
       WHERE b.user_id = ?
       ORDER BY u.first_name ASC`,
      [user_id]
    );

    return res.json({
      status: true,
      message: "Beneficiaries fetched successfully",
      data: rows
    });

  } catch (err) {
    console.error("List Account Beneficiaries Error:", err);
    return res.status(500).json({
      status: false,
      message: "Server error"
    });
  }
};





exports.deleteBeneficiary = async (req, res) => {
  try {
    const { user_id } = req.user || {};
    const { recipient_user_id } = req.body;

    // 1. Validate inputs
    if (!user_id) {
      return res.status(400).json({
        status: false,
        message: "user_id is required"
      });
    }

    if (!recipient_user_id) {
      return res.status(400).json({
        status: false,
        message: "recipient_user_id is required"
      });
    }

    // 2. Check if Recipient user exists
    const [userRows] = await pool.query(
      "SELECT user_id FROM users_account WHERE user_id = ? LIMIT 1",
      [recipient_user_id]
    );

    if (userRows.length === 0) {
      return res.status(404).json({
        status: false,
        message: "Recipient not a valid user"
      });
    }

    // 3. Check if beneficiary exists
    const [beneficiaryRows] = await pool.query(
      "SELECT * FROM beneficiary WHERE user_id = ? AND recipient_user_id = ? LIMIT 1",
      [user_id, recipient_user_id]
    );

    if (beneficiaryRows.length === 0) {
      return res.status(404).json({
        status: false,
        message: "Beneficiary not found for this user"
      });
    }

    // 4. Delete beneficiary
    await pool.query(
      "DELETE FROM beneficiary WHERE user_id = ? AND recipient_user_id = ?",
      [user_id, recipient_user_id]
    );

    return res.json({
      status: true,
      message: "Beneficiary removed successfully"
    });

  } catch (err) {
    console.error("Delete Beneficiary Error:", err);
    return res.status(500).json({
      status: false,
      message: "Server error"
    });
  }
};
