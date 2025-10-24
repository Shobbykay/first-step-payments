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

exports.fetchAllCustomers = async (req, res) => {
    try {

        let page = parseInt(req.query.page) || 1;
        let limit = parseInt(req.query.limit) || 10;
        let offset = (page - 1) * limit;

        // Get total count
        const [countResult] = await pool.query("SELECT COUNT(*) as total FROM users_account WHERE account_type='USER' AND status IN (0,1)");
        const total = countResult[0].total;
        const totalPages = Math.ceil(total / limit);

        // Fetch paginated users
        const [rows] = await pool.query(
            `SELECT user_id, account_type, phone_number, status, kyc_status, first_name, last_name, email_address, dob, business_name, business_address, security_question, date_created 
            FROM users_account 
            WHERE account_type = 'USER'
            AND status='ACTIVE'
            ORDER BY date_created DESC
            LIMIT ? OFFSET ?`,
            [limit, offset]
        );

        // Transform rows: rename `status` -> `kyc_status`
        // const formattedRows = rows.map(({ status, ...rest }) => ({
        //     ...rest,
        //     kyc_status: statusMap[status] || "UNKNOWN"
        // }));

        return res.json({
            status: true,
            message: "User Accounts fetched successfully",
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




exports.fetchSuspendedCustomers = async (req, res) => {
    try {
        let page = parseInt(req.query.page) || 1;
        let limit = parseInt(req.query.limit) || 10;
        let offset = (page - 1) * limit;

        // Get total count of suspended users
        const [countResult] = await pool.query(
            "SELECT COUNT(*) as total FROM users_account WHERE status = 3 AND account_type = 'USER'"
        );
        const total = countResult[0].total;
        const totalPages = Math.ceil(total / limit);

        // Fetch paginated suspended users
        const [rows] = await pool.query(
            `SELECT user_id, account_type, phone_number, status, first_name, last_name, email_address, dob, business_name, business_address, security_question, date_created, suspension_reason
             FROM users_account 
             WHERE status = 3
             AND account_type = 'USER'
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
            message: "Suspended user accounts fetched successfully",
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




exports.fetchArchiveCustomers = async (req, res) => {
    try {
        //should show only CLOSED accounts
        let page = parseInt(req.query.page) || 1;
        let limit = parseInt(req.query.limit) || 10;
        let offset = (page - 1) * limit;

        // Get total count of archived users (deleted or closed)
        const [countResult] = await pool.query(
            "SELECT COUNT(*) as total FROM users_account WHERE status IN (5) AND account_type = 'USER'"
        );
        const total = countResult[0].total;
        const totalPages = Math.ceil(total / limit);

        // Fetch paginated archived users
        const [rows] = await pool.query(
            `SELECT user_id, account_type, phone_number, status, first_name, last_name, email_address, dob, business_name, business_address, security_question, date_created, closure_reason, closed_by, closed_date
             FROM users_account 
             WHERE status IN (5)
             AND account_type = 'USER'
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
            message: "Archived user accounts fetched successfully",
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






exports.fetchSingleCustomer = async (req, res) => {
    try {
        const { user_id } = req.params;
    
        // Fetch user by ID
        const [rows] = await pool.query(
            `SELECT user_id, account_type, agent_id, phone_number, status, first_name, last_name, email_address, dob, business_name, business_address, security_question, security_answer, profile_img, suspension_reason, suspended_by, suspended_date, closure_reason, closed_by, closed_date, date_created, date_updated
            FROM users_account 
            WHERE user_id = ? 
            LIMIT 1`,
            [user_id]
        );

        if (rows.length === 0) {
            return res.status(200).json({
            status: false,
            message: "User not found"
            });
        }

        // Format user
        const user = {
            ...rows[0],
            kyc_status: statusMap[rows[0].status] || "UNKNOWN"
        };

        // Remove numeric status
        delete user.status;

        return res.json({
            status: true,
            message: "User fetched successfully",
            data: user
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ status: false, message: "Server error" });
    }
};



exports.suspendCustomer = async (req, res) => {
    try {
        const { user_id } = req.params;
        const { reason } = req.body;
        const admin_id = req.user?.email || 'SYSTEM';

        // Ensure reason is provided
        if (!reason || reason.trim() === "") {
            return res.status(400).json({
                status: false,
                message: "Suspension reason is required"
            });
        }

        // Check if user exists
        const [rows] = await pool.query(
            `SELECT user_id FROM users_account WHERE user_id = ? LIMIT 1`,
            [user_id]
        );

        if (rows.length === 0) {
            await logAction({
                user_id,
                action: "SUSPEND_CUSTOMER",
                log_message: `Attempted suspension but user not found. Reason: ${reason}`,
                status: "FAILED",
                action_by: admin_id
            });

            return res.status(404).json({ status: false, message: "User not found" });
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
            action: "SUSPEND_CUSTOMER",
            log_message: `User ${user_id} suspended. Reason: ${reason}`,
            status: "SUCCESS",
            action_by: admin_id
        });

        return res.json({
            status: true,
            message: "User suspended successfully",
            data: { user_id, status: 3, reason }
        });

    } catch (err) {
        console.error(err);

        await logAction({
            user_id: req.params.user_id,
            action: "SUSPEND_CUSTOMER",
            log_message: `Server error: ${err.message}`,
            status: "FAILED",
            action_by: req.user?.email || null
        });

        return res.status(500).json({ status: false, message: "Server error" });
    }
};




exports.closeCustomer = async (req, res) => {
    try {
        const { user_id } = req.params;
        const { reason } = req.body;
        const admin_id = req.user?.email || 'SYSTEM';

        // Ensure reason is provided
        if (!reason || reason.trim() === "") {
            return res.status(400).json({
                status: false,
                message: "Closure reason is required"
            });
        }

        // Check if user exists
        const [rows] = await pool.query(
            `SELECT user_id FROM users_account WHERE user_id = ? LIMIT 1`,
            [user_id]
        );

        if (rows.length === 0) {
            await logAction({
                user_id,
                action: "CLOSED_CUSTOMER",
                log_message: `Attempted closing account but user not found. Reason: ${reason}`,
                status: "FAILED",
                action_by: admin_id
            });

            return res.status(404).json({ status: false, message: "User not found" });
        }

        // Update status = 5 (Closed) and store closure reason
        await pool.query(
            `UPDATE users_account 
             SET status = 5, closure_reason = ?, 
             closed_by = ?, closed_date = NOW()
             WHERE user_id = ?`,
            [reason, admin_id, user_id]
        );

        await logAction({
            user_id,
            action: "CLOSED_CUSTOMER",
            log_message: `User ${user_id} account closed. Reason: ${reason}`,
            status: "SUCCESS",
            action_by: admin_id
        });

        return res.json({
            status: true,
            message: "User account closed successfully",
            // data: { user_id, status: 5, reason }
        });

    } catch (err) {
        console.error(err);

        await logAction({
            user_id: req.params.user_id,
            action: "CLOSED_CUSTOMER",
            log_message: `Server error: ${err.message}`,
            status: "FAILED",
            action_by: req.user?.email || null
        });

        return res.status(500).json({ status: false, message: "Server error" });
    }
};






exports.deleteCustomer = async (req, res) => {
    try {
        const { user_id } = req.params;
        const admin_id = req.user?.email || 'SYSTEM';

        const [rows] = await pool.query(
            `SELECT user_id FROM users_account WHERE user_id = ? LIMIT 1`,
            [user_id]
        );

        if (rows.length === 0) {
            await logAction({
                user_id,
                action: "DELETED_CUSTOMER",
                log_message: "Attempted deleting account but user not found",
                status: "FAILED",
                action_by: admin_id
            });

            return res.status(404).json({ status: false, message: "User not found" });
        }

        await pool.query(`UPDATE users_account SET status = 2 WHERE user_id = ?`, [user_id]);

        await logAction({
            user_id,
            action: "DELETED_CUSTOMER",
            log_message: `User ${user_id} deleted successfully`,
            status: "SUCCESS",
            action_by: admin_id
        });

        return res.json({
            status: true,
            message: "User deleted successfully",
        });

    } catch (err) {
        console.error(err);

        await logAction({
            user_id: req.params.user_id,
            action: "DELETED_CUSTOMER",
            log_message: `Server error: ${err.message}`,
            status: "FAILED",
            action_by: req.user?.email || null
        });

        return res.status(500).json({ status: false, message: "Server error" });
    }
};





exports.restoreCustomer = async (req, res) => {
    try {
        //Restore is for CLOSED account
        const { user_id } = req.params;
        const admin_id = req.user?.email || 'SYSTEM';

        // Fetch user by ID
        const [rows] = await pool.query(
            `SELECT user_id, status FROM users_account WHERE user_id = ? LIMIT 1`,
            [user_id]
        );

        if (rows.length === 0) {
            await logAction({
                user_id,
                action: "RESTORE_CUSTOMER",
                log_message: "Attempted restore but user not found",
                status: "FAILED",
                action_by: admin_id
            });

            return res.status(404).json({ status: false, message: "User not found" });
        }

        const currentStatus = rows[0].status;

        if (currentStatus != 5){
            return res.status(400).json({
                status: false,
                message: "You can only restore a CLOSED account"
            });
        }

        // Only allow restore if status is 2 (deleted), 3 (suspended), or 5 (closed)
        if (![2, 3, 5].includes(currentStatus)) {
            await logAction({
                user_id,
                action: "RESTORE_CUSTOMER",
                log_message: `Restore failed. Current status is ${currentStatus} (active/not restorable)`,
                status: "FAILED",
                action_by: admin_id
            });

            return res.status(400).json({
                status: false,
                message: "Account is active and cannot be restored"
            });
        }

        // Restore account (set status back to 0 = pending)
        await pool.query(`UPDATE users_account SET status = 0 WHERE user_id = ?`, [user_id]);

        await logAction({
            user_id,
            action: "RESTORE_CUSTOMER",
            log_message: `User ${user_id} restored successfully`,
            status: "SUCCESS",
            action_by: admin_id
        });

        return res.json({
            status: true,
            message: "User restored successfully",
            data: { user_id, status: 1 }
        });

    } catch (err) {
        console.error(err);

        await logAction({
            user_id: req.params.user_id,
            action: "RESTORE_CUSTOMER",
            log_message: `Server error: ${err.message}`,
            status: "FAILED",
            action_by: req.user?.email || null
        });

        return res.status(500).json({ status: false, message: "Server error" });
    }
};






exports.reinstateCustomer = async (req, res) => {
    try {
        //Restore is for CLOSED account
        const { user_id } = req.params;
        const admin_id = req.user?.email || 'SYSTEM';

        // Fetch user by ID
        const [rows] = await pool.query(
            `SELECT user_id, status FROM users_account WHERE user_id = ? LIMIT 1`,
            [user_id]
        );

        if (rows.length === 0) {
            await logAction({
                user_id,
                action: "RE_INSTATE_CUSTOMER",
                log_message: "Attempted Reinstating but user not found",
                status: "FAILED",
                action_by: admin_id
            });

            return res.status(404).json({ status: false, message: "User not found" });
        }

        const currentStatus = rows[0].status;

        if (currentStatus != 3){
            return res.status(400).json({
                status: false,
                message: "You can only Reinstate a SUSPENDED account"
            });
        }

        // Only allow restore if status is 2 (deleted), 3 (suspended), or 5 (closed)
        if (![2, 3, 5].includes(currentStatus)) {
            await logAction({
                user_id,
                action: "RE_INSTATE_CUSTOMER",
                log_message: `Reinstate failed. Current status is ${currentStatus} (active/not reinstatable)`,
                status: "FAILED",
                action_by: admin_id
            });

            return res.status(400).json({
                status: false,
                message: "Account is active and cannot be Reinstated"
            });
        }

        // Restore account (set status back to 0 = pending)
        await pool.query(`UPDATE users_account SET status = 0 WHERE user_id = ?`, [user_id]);

        await logAction({
            user_id,
            action: "RE_INSTATE_CUSTOMER",
            log_message: `User ${user_id} Reinstated successfully`,
            status: "SUCCESS",
            action_by: admin_id
        });

        return res.json({
            status: true,
            message: "User Reinstated successfully",
            data: { user_id, status: 1 }
        });

    } catch (err) {
        console.error(err);

        await logAction({
            user_id: req.params.user_id,
            action: "RE_INSTATE_CUSTOMER",
            log_message: `Server error: ${err.message}`,
            status: "FAILED",
            action_by: req.user?.email || null
        });

        return res.status(500).json({ status: false, message: "Server error" });
    }
};





exports.updateCustomer = async (req, res) => {
    try {
        const { user_id } = req.params;
        const { first_name, last_name, email_address, phone_number } = req.body;
        const admin_id = req.user?.email || 'SYSTEM';

        // Validate required fields
        if (!first_name || !last_name || !email_address || !phone_number) {
            return res.status(400).json({
                status: false,
                message: "first_name, last_name, email_address, and phone_number are required"
            });
        }

        // Check if user exists
        const [rows] = await pool.query(
            `SELECT user_id FROM users_account WHERE user_id = ? LIMIT 1`,
            [user_id]
        );

        if (rows.length === 0) {
            await logAction({
                user_id,
                action: "UPDATE_CUSTOMER",
                log_message: "Attempted update but user not found",
                status: "FAILED",
                action_by: admin_id
            });

            return res.status(404).json({ status: false, message: "User not found" });
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
            action: "UPDATE_CUSTOMER",
            log_message: `User ${user_id} updated successfully`,
            status: "SUCCESS",
            action_by: admin_id
        });

        return res.json({
            status: true,
            message: "User updated successfully",
            data: { user_id, first_name, last_name, email_address, phone_number }
        });

    } catch (err) {
        console.error(err);

        await logAction({
            user_id: req.params.user_id,
            action: "UPDATE_CUSTOMER",
            log_message: `Server error: ${err.message}`,
            status: "FAILED",
            action_by: req.user?.email || null
        });

        return res.status(500).json({ status: false, message: "Server error" });
    }
};




exports.changeUserPassword = async (req, res) => {
  const { user_id } = req.params;
  const { password } = req.body;
  const admin_id = req.user?.email || "SYSTEM";

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

    // Ensure user exists
    const [rows] = await pool.query(
      "SELECT user_id FROM users_account WHERE user_id = ?",
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
      log_message: `Password changed successfully for user ${user_id}`,
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





exports.ApproveBecomeAnAgent = async (req, res) => {
  try {
    const { email_address } = req.body;
    const verified_by = req.user?.email || req.user?.email_address; // from middleware

    if (!email_address) {
      return res.status(400).json({
        status: false,
        message: "Email address is required",
      });
    }

    // Check if user exists in users_account
    const [userRows] = await pool.query(
      "SELECT user_id, first_name FROM users_account WHERE email_address = ?",
      [email_address]
    );

    if (userRows.length === 0) {
      return res.status(404).json({
        status: false,
        message: "User not found in users_account",
      });
    }

    const { first_name } = userRows[0];

    // Check if user has a record in become_an_agent
    const [agentRows] = await pool.query(
      "SELECT * FROM become_an_agent WHERE email_address = ?",
      [email_address]
    );

    if (agentRows.length === 0) {
      return res.status(404).json({
        status: false,
        message: "No agent request found for this email address",
      });
    }

    const agent = agentRows[0];

    // Ensure not already approved
    if (agent.is_verified === "APPROVED") {
      return res.status(400).json({
        status: false,
        message: "This agent request has already been approved",
      });
    }

    // Approve the agent request
    await pool.query(
      `UPDATE become_an_agent 
       SET is_verified = 'APPROVED', 
           verified_by = ?, 
           verified_date = NOW(),
           rejected_reason = NULL,
           rejected_by = NULL,
           rejected_date = NULL 
       WHERE email_address = ?`,
      [verified_by, email_address]
    );

    // Update users_account details
    await pool.query(
      `UPDATE users_account 
       SET business_name = ?, 
           business_address = ?, 
           business_location = ?, 
           business_hours = ?,
           account_type = 'AGENT'
       WHERE email_address = ?`,
      [
        agent.business_name,
        agent.business_address,
        agent.location,
        agent.business_hours,
        email_address,
      ]
    );

    // Send email notification
    await sendMail(
      email_address,
      "Agent Verification Approved ✅",
      `Hi <strong>${first_name}</strong>,<br><br>
      Congratulations! Your agent verification has been <strong>approved</strong> successfully.<br><br>
      You are now officially recognized as an agent on our platform.<br><br>
      You can now access your agent dashboard and enjoy full agent benefits.<br><br>
      Best regards,<br>
      <strong>FirstStep Financials Team</strong>`
    );

    // ✅ Success response
    return res.json({
      status: true,
      message: "Agent request approved successfully",
    });
  } catch (err) {
    console.error("ApproveBecomeAnAgent Error:", err);
    return res.status(500).json({
      status: false,
      message: "Server error",
    });
  }
};






exports.RejectBecomeAnAgent = async (req, res) => {
  try {
    const { email_address, rejected_reason } = req.body;
    const rejected_by = req.admin?.email_address || req.user?.email_address; // from middleware

    if (!email_address || !rejected_reason) {
      return res.status(400).json({
        status: false,
        message: "Email address and rejection reason are required",
      });
    }

    // Check if user exists in users_account
    const [userRows] = await pool.query(
      "SELECT user_id, first_name FROM users_account WHERE email_address = ?",
      [email_address]
    );

    if (userRows.length === 0) {
      return res.status(404).json({
        status: false,
        message: "User not found in users_account",
      });
    }

    const { first_name } = userRows[0];

    // Check if user has a record in become_an_agent
    const [agentRows] = await pool.query(
      "SELECT * FROM become_an_agent WHERE email_address = ?",
      [email_address]
    );

    if (agentRows.length === 0) {
      return res.status(404).json({
        status: false,
        message: "No agent request found for this email address",
      });
    }

    const agent = agentRows[0];

    // Ensure not already rejected
    if (agent.is_verified === "REJECTED") {
      return res.status(400).json({
        status: false,
        message: "This agent request has already been rejected",
      });
    }

    // Update rejection details
    await pool.query(
      `UPDATE become_an_agent 
       SET is_verified = 'REJECTED',
           rejected_reason = ?,
           rejected_by = ?,
           rejected_date = NOW(),
           verified_by = NULL,
           verified_date = NULL
       WHERE email_address = ?`,
      [rejected_reason, rejected_by, email_address]
    );

    // Send rejection email
    await sendMail(
      email_address,
      "Agent Verification Rejected",
      `Hi <strong>${first_name}</strong>,<br><br>
      We regret to inform you that your agent verification request has been <strong>rejected</strong>.<br><br>
      <strong>Reason:</strong> ${rejected_reason}<br><br>
      You may review your submission and reapply if you believe this was an error.<br><br>
      Best regards,<br>
      <strong>FirstStep Financials Team</strong>`
    );

    // ✅ Success response
    return res.json({
      status: true,
      message: "Agent request rejected successfully",
    });
  } catch (err) {
    console.error("RejectBecomeAnAgent Error:", err);
    return res.status(500).json({
      status: false,
      message: "Server error",
    });
  }
};
