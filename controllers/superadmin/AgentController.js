const { sha1Hex, hashPassword } = require("../../utils/utilities");
const pool = require('../../services/db');
const jwt = require("jsonwebtoken");
const { sendMail } = require("../../utils/mailHelper");
const crypto = require('crypto');
const logAction = require("../../utils/logger");

// Status mapping
const statusMap = {
    0: "PENDING",
    1: "VERIFIED",
    2: "DELETED",
    3: "SUSPENDED",
    4: "INCOMPLETE_DETAILS",
    5: "CLOSED"
};

exports.fetchAllAgents = async (req, res) => {
    try {

        let page = parseInt(req.query.page) || 1;
        let limit = 30;
        let offset = (page - 1) * limit;

        // Get total count
        const [countResult] = await pool.query("SELECT COUNT(*) as total FROM users_account WHERE account_type='AGENT'");
        const total = countResult[0].total;
        const totalPages = Math.ceil(total / limit);

        // Fetch paginated user agents
        const [rows] = await pool.query(
            `SELECT user_id, agent_id, account_type, phone_number, status, first_name, last_name, email_address, dob, business_name, business_address, security_question, date_created 
            FROM users_account 
            WHERE account_type = 'AGENT'
            ORDER BY date_created DESC
            LIMIT ? OFFSET ?`,
            [limit, offset]
        );

        // Transform rows: rename `status` -> `kyc_status`
        const formattedRows = rows.map(({ status, ...rest }) => ({
            ...rest,
            kyc_status: statusMap[status] || "UNKNOWN"
        }));

        return res.json({
            status: true,
            message: "Agent Accounts fetched successfully",
            data: {
                pagination: {
                    total,
                    page,
                    totalPages,
                    limit
                },
                records: formattedRows
            }
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ status: false, message: "Server error" });
    }
};




exports.fetchSuspendedAgents = async (req, res) => {
  try {
    let page = parseInt(req.query.page) || 1;
    let limit = 30;
    let offset = (page - 1) * limit;

    // Get total count of suspended AGENT users
    const [countResult] = await pool.query(
      "SELECT COUNT(*) as total FROM users_account WHERE status = 3 AND account_type = 'AGENT'"
    );
    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limit);

    // Fetch paginated suspended AGENTs
    const [rows] = await pool.query(
      `SELECT user_id, agent_id, account_type, phone_number, status, first_name, last_name, email_address, dob, business_name, business_address, security_question, date_created, suspension_reason
       FROM users_account 
       WHERE status = 3
       AND account_type = 'AGENT'
       ORDER BY date_created DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        status: false,
        message: "No suspended AGENT accounts found",
      });
    }

    // Transform rows: rename `status` -> `kyc_status`
    const formattedRows = rows.map(({ status, ...rest }) => ({
      ...rest,
      kyc_status: statusMap[status] || "UNKNOWN",
    }));

    return res.json({
      status: true,
      message: "Suspended AGENT accounts fetched successfully",
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





exports.fetchArchiveAgents = async (req, res) => {
    try {
        let page = parseInt(req.query.page) || 1;
        let limit = 30;
        let offset = (page - 1) * limit;

        // Get total count of archived users (deleted or closed)
        const [countResult] = await pool.query(
            "SELECT COUNT(*) as total FROM users_account WHERE status IN (2, 5) AND account_type = 'AGENT'"
        );
        const total = countResult[0].total;
        const totalPages = Math.ceil(total / limit);

        // Fetch paginated archived users
        const [rows] = await pool.query(
            `SELECT user_id, agent_id, account_type, phone_number, status, first_name, last_name, email_address, dob, business_name, business_address, security_question, date_created, closure_reason
             FROM users_account 
             WHERE status IN (2, 5)
             AND account_type = 'AGENT'
             ORDER BY date_created DESC
             LIMIT ? OFFSET ?`,
            [limit, offset]
        );

        // Transform rows: rename `status` -> `kyc_status`
        const formattedRows = rows.map(({ status, ...rest }) => ({
            ...rest,
            kyc_status: statusMap[status] || "UNKNOWN"
        }));

        return res.json({
            status: true,
            message: "Archived Agent accounts fetched successfully",
            data: {
                pagination: {
                    total,
                    page,
                    totalPages,
                    limit
                },
                records: formattedRows
            }
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ status: false, message: "Server error" });
    }
};






exports.fetchSingleAgent = async (req, res) => {
  try {
    const { user_id } = req.params;

    // Fetch user by ID
    const [rows] = await pool.query(
      `SELECT user_id, account_type, phone_number, status, first_name, last_name, email_address, dob, business_name, business_address, security_question, date_created
       FROM users_account 
       WHERE user_id = ? 
       LIMIT 1`,
      [user_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        status: false,
        message: "User not found",
      });
    }

    const userRecord = rows[0];

    // Ensure the account is an AGENT
    if (userRecord.account_type !== "AGENT") {
      return res.status(400).json({
        status: false,
        message: "User is not an AGENT",
      });
    }

    // Format user
    const user = {
      ...userRecord,
      kyc_status: statusMap[userRecord.status] || "UNKNOWN",
      kyc_documents: {}, // placeholder, can be replaced with real docs
    };

    // Remove numeric status
    delete user.status;

    return res.json({
      status: true,
      message: "Agent fetched successfully",
      data: user,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: false, message: "Server error" });
  }
};




exports.suspendAgent = async (req, res) => {
    try {
        const { user_id } = req.params;
        const { reason } = req.body;
        const admin_id = req.user?.id || "SYSTEM";

        // Ensure reason is provided
        if (!reason || reason.trim() === "") {
            return res.status(400).json({
                status: false,
                message: "Suspension reason is required"
            });
        }

        // Check if user exists and fetch account_type
        const [rows] = await pool.query(
            `SELECT user_id, account_type 
             FROM users_account 
             WHERE user_id = ? 
             LIMIT 1`,
            [user_id]
        );

        if (rows.length === 0) {
            await logAction({
                user_id,
                action: "SUSPEND_AGENT",
                log_message: `Attempted suspension but user not found. Reason: ${reason}`,
                status: "FAILED",
                action_by: admin_id
            });

            return res.status(404).json({ status: false, message: "User not found" });
        }

        const account = rows[0];

        // Check if account_type is AGENT
        if (account.account_type !== "AGENT") {
            await logAction({
                user_id,
                action: "SUSPEND_AGENT",
                log_message: `Attempted suspension but account_type is ${account.account_type}, not AGENT.`,
                status: "FAILED",
                action_by: admin_id
            });

            return res.status(400).json({
                status: false,
                message: "Only AGENT accounts can be suspended"
            });
        }

        // Update status = 3 (Suspended) and save reason
        await pool.query(
            `UPDATE users_account 
             SET status = 3, suspension_reason = ? 
             WHERE user_id = ?`,
            [reason, user_id]
        );

        await logAction({
            user_id,
            action: "SUSPEND_AGENT",
            log_message: `Agent ${user_id} suspended. Reason: ${reason}`,
            status: "SUCCESS",
            action_by: admin_id
        });

        return res.json({
            status: true,
            message: "Agent suspended successfully",
            data: { user_id, status: 3, reason }
        });

    } catch (err) {
        console.error(err);

        await logAction({
            user_id: req.params.user_id,
            action: "SUSPEND_AGENT",
            log_message: `Server error: ${err.message}`,
            status: "FAILED",
            action_by: req.user?.id || null
        });

        return res.status(500).json({ status: false, message: "Server error" });
    }
};






exports.closeAgent = async (req, res) => {
    try {
        const { user_id } = req.params;
        const { reason } = req.body;
        const admin_id = req.user?.id || "SYSTEM";

        // Ensure reason is provided
        if (!reason || reason.trim() === "") {
            return res.status(400).json({
                status: false,
                message: "Closure reason is required"
            });
        }

        // Check if user exists and fetch account_type
        const [rows] = await pool.query(
            `SELECT user_id, account_type 
             FROM users_account 
             WHERE user_id = ? 
             LIMIT 1`,
            [user_id]
        );

        if (rows.length === 0) {
            await logAction({
                user_id,
                action: "CLOSE_AGENT",
                log_message: `Attempted closing account but agent not found. Reason: ${reason}`,
                status: "FAILED",
                action_by: admin_id
            });

            return res.status(404).json({ status: false, message: "Agent not found" });
        }

        const account = rows[0];

        // Check if account_type is AGENT
        if (account.account_type !== "AGENT") {
            await logAction({
                user_id,
                action: "CLOSE_CUSTOMER",
                log_message: `Attempted closure but account_type is ${account.account_type}, not AGENT.`,
                status: "FAILED",
                action_by: admin_id
            });

            return res.status(400).json({
                status: false,
                message: "Only AGENT accounts can be closed"
            });
        }

        // Update status = 5 (Closed) and store closure reason
        await pool.query(
            `UPDATE users_account 
             SET status = 5, closure_reason = ? 
             WHERE user_id = ?`,
            [reason, user_id]
        );

        await logAction({
            user_id,
            action: "CLOSE_CUSTOMER",
            log_message: `Agent ${user_id} account closed. Reason: ${reason}`,
            status: "SUCCESS",
            action_by: admin_id
        });

        return res.json({
            status: true,
            message: "Agent account closed successfully"
        });

    } catch (err) {
        console.error(err);

        await logAction({
            user_id: req.params.user_id,
            action: "CLOSE_AGENT",
            log_message: `Server error: ${err.message}`,
            status: "FAILED",
            action_by: req.user?.id || null
        });

        return res.status(500).json({ status: false, message: "Server error" });
    }
};







exports.deleteAgent = async (req, res) => {
    try {
        const { user_id } = req.params;
        const admin_id = req.user?.id || "SYSTEM";

        // Check if user exists and fetch account_type
        const [rows] = await pool.query(
            `SELECT user_id, account_type 
             FROM users_account 
             WHERE user_id = ? 
             LIMIT 1`,
            [user_id]
        );

        if (rows.length === 0) {
            await logAction({
                user_id,
                action: "DELETE_AGENT",
                log_message: "Attempted deleting account but user not found",
                status: "FAILED",
                action_by: admin_id
            });

            return res.status(404).json({ status: false, message: "User not found" });
        }

        const account = rows[0];

        // Ensure account is an AGENT
        if (account.account_type !== "AGENT") {
            await logAction({
                user_id,
                action: "DELETE_AGENT",
                log_message: `Attempted deletion but account_type is ${account.account_type}, not AGENT.`,
                status: "FAILED",
                action_by: admin_id
            });

            return res.status(400).json({
                status: false,
                message: "Only AGENT accounts can be deleted"
            });
        }

        // Soft delete: update status = 2
        await pool.query(
            `UPDATE users_account 
             SET status = 2 
             WHERE user_id = ?`,
            [user_id]
        );

        await logAction({
            user_id,
            action: "DELETE_AGENT",
            log_message: `Agent ${user_id} deleted successfully`,
            status: "SUCCESS",
            action_by: admin_id
        });

        return res.json({
            status: true,
            message: "Agent deleted successfully"
        });

    } catch (err) {
        console.error(err);

        await logAction({
            user_id: req.params.user_id,
            action: "DELETE_AGENT",
            log_message: `Server error: ${err.message}`,
            status: "FAILED",
            action_by: req.user?.id || null
        });

        return res.status(500).json({ status: false, message: "Server error" });
    }
};






exports.restoreAgent = async (req, res) => {
    try {
        const { user_id } = req.params;
        const admin_id = req.user?.id || 'SYSTEM';

        // Fetch user by ID
        const [rows] = await pool.query(
            `SELECT user_id, status, account_type 
             FROM users_account 
             WHERE user_id = ? 
             LIMIT 1`,
            [user_id]
        );

        if (rows.length === 0) {
            await logAction({
                user_id,
                action: "RESTORE_AGENT",
                log_message: "Attempted restore but user not found",
                status: "FAILED",
                action_by: admin_id
            });

            return res.status(404).json({ status: false, message: "Agent not found" });
        }

        const { status: currentStatus, account_type } = rows[0];

        // Ensure account is AGENT
        if (account_type !== "AGENT") {
            await logAction({
                user_id,
                action: "RESTORE_AGENT",
                log_message: `Attempted restore but account_type is ${account_type}, not AGENT.`,
                status: "FAILED",
                action_by: admin_id
            });

            return res.status(400).json({
                status: false,
                message: "Only AGENT accounts can be restored"
            });
        }

        // Only allow restore if status is 2 (deleted), 3 (suspended), or 5 (closed)
        if (![2, 3, 5].includes(currentStatus)) {
            await logAction({
                user_id,
                action: "RESTORE_AGENT",
                log_message: `Restore failed. Current status is ${currentStatus} (active/not restorable)`,
                status: "FAILED",
                action_by: admin_id
            });

            return res.status(400).json({
                status: false,
                message: "Agent account is active and cannot be restored"
            });
        }

        // Restore account (set status back to 1 = ACTIVE)
        await pool.query(
            `UPDATE users_account 
             SET status = 1 
             WHERE user_id = ?`,
            [user_id]
        );

        await logAction({
            user_id,
            action: "RESTORE_AGENT",
            log_message: `Agent ${user_id} restored successfully`,
            status: "SUCCESS",
            action_by: admin_id
        });

        return res.json({
            status: true,
            message: "Agent restored successfully",
            data: { user_id, status: 1 }
        });

    } catch (err) {
        console.error(err);

        await logAction({
            user_id: req.params.user_id,
            action: "RESTORE_AGENT",
            log_message: `Server error: ${err.message}`,
            status: "FAILED",
            action_by: req.user?.id || null
        });

        return res.status(500).json({ status: false, message: "Server error" });
    }
};






exports.updateAgent = async (req, res) => {
    try {
        const { user_id } = req.params;
        const { first_name, last_name, email_address, phone_number } = req.body;
        const admin_id = req.user?.id || 'SYSTEM';

        // Validate required fields
        if (!first_name || !last_name || !email_address || !phone_number) {
            return res.status(400).json({
                status: false,
                message: "first_name, last_name, email_address, and phone_number are required"
            });
        }

        // Check if user exists and is an AGENT
        const [rows] = await pool.query(
            `SELECT user_id, account_type 
             FROM users_account 
             WHERE user_id = ? 
             LIMIT 1`,
            [user_id]
        );

        if (rows.length === 0) {
            await logAction({
                user_id,
                action: "UPDATE_AGENT",
                log_message: "Attempted update but user not found",
                status: "FAILED",
                action_by: admin_id
            });

            return res.status(404).json({ status: false, message: "User not found" });
        }

        if (rows[0].account_type !== "AGENT") {
            await logAction({
                user_id,
                action: "UPDATE_AGENT",
                log_message: "Attempted update but user is not an AGENT",
                status: "FAILED",
                action_by: admin_id
            });

            return res.status(400).json({ status: false, message: "User is not an AGENT" });
        }

        // Update user record
        await pool.query(
            `UPDATE users_account 
             SET first_name = ?, last_name = ?, email_address = ?, phone_number = ? 
             WHERE user_id = ?`,
            [first_name, last_name, email_address, phone_number, user_id]
        );

        await logAction({
            user_id,
            action: "UPDATE_AGENT",
            log_message: `Agent ${user_id} updated successfully`,
            status: "SUCCESS",
            action_by: admin_id
        });

        return res.json({
            status: true,
            message: "Agent updated successfully",
            data: { user_id, first_name, last_name, email_address, phone_number }
        });

    } catch (err) {
        console.error(err);

        await logAction({
            user_id: req.params.user_id,
            action: "UPDATE_AGENT",
            log_message: `Server error: ${err.message}`,
            status: "FAILED",
            action_by: req.user?.id || null
        });

        return res.status(500).json({ status: false, message: "Server error" });
    }
};





exports.changeAgentPassword = async (req, res) => {
  const { user_id } = req.params;
  const { password } = req.body;
  const admin_id = req.user?.id || "SYSTEM";

  if (!password) {
    return res.status(400).json({ status: false, message: "Password is required" });
  }

  try {
    // Validate password strength
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{7,}$/;
    if (!passwordRegex.test(password)) {
      return res.status(400).json({
        status: false,
        message:
          "Password must be at least 7 characters, include uppercase, lowercase, number, and special character",
      });
    }

    // Hash password
    const hashedPassword = await hashPassword(password, 10);

    // Ensure user exists and is an AGENT
    const [rows] = await pool.query(
      "SELECT user_id, account_type FROM users_account WHERE user_id = ? LIMIT 1",
      [user_id]
    );

    if (rows.length === 0) {
      await logAction({
        user_id,
        action: "CHANGE_PASSWORD",
        log_message: `Attempted to change password but user not found`,
        status: "FAILED",
        action_by: admin_id,
      });

      return res.status(404).json({ status: false, message: "User not found" });
    }

    if (rows[0].account_type !== "AGENT") {
      await logAction({
        user_id,
        action: "CHANGE_PASSWORD",
        log_message: `Attempted to change password but user is not an AGENT`,
        status: "FAILED",
        action_by: admin_id,
      });

      return res.status(400).json({ status: false, message: "User is not an AGENT" });
    }

    // Update password
    await pool.query("UPDATE users_account SET password = ? WHERE user_id = ?", [
      hashedPassword,
      user_id,
    ]);

    // Delete any reset record (if exists)
    await pool.query("DELETE FROM reset_password WHERE user_id = ?", [user_id]);

    await logAction({
      user_id,
      action: "CHANGE_PASSWORD",
      log_message: `Password changed successfully for agent ${user_id}`,
      status: "SUCCESS",
      action_by: admin_id,
    });

    return res.status(200).json({
      status: true,
      message: "Password changed successfully",
    });
  } catch (err) {
    console.error("Change user password error:", err);

    await logAction({
      user_id,
      action: "CHANGE_PASSWORD",
      log_message: `Server error: ${err.message}`,
      status: "FAILED",
      action_by: admin_id,
    });

    return res.status(500).json({ status: false, message: "Server error" });
  }
};

