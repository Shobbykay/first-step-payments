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
        let limit = parseInt(req.query.limit) || 10;
        let offset = (page - 1) * limit;

        // Get total count of agents
        const [countResult] = await pool.query(`
            SELECT COUNT(*) AS total 
            FROM users_account 
            WHERE account_type = 'AGENT' 
            AND status IN (0,1)
        `);
        const total = countResult[0].total;
        const totalPages = Math.ceil(total / limit);

        // Fetch paginated user agents
        const [rows] = await pool.query(`
            SELECT 
                u.user_id,
                u.agent_id,
                u.account_type,
                u.phone_number,
                u.status,
                u.first_name,
                u.last_name,
                u.email_address,
                u.dob,
                IFNULL(u.address, ca.address) AS house_address,
                IFNULL(u.business_hours, b.business_hours) AS business_hours,
                u.business_name,
                u.business_address,
                u.security_question,
                u.kyc_status,
                IFNULL(u.business_location, b.location) AS location,
                w.balance AS available_cash,
                u.date_created
            FROM users_account u
            LEFT JOIN become_an_agent b ON u.email_address = b.email_address
            LEFT JOIN wallet_balance w ON u.email_address = w.email_address
            LEFT JOIN customer_addresses ca ON ca.user_id = u.user_id
            WHERE u.account_type = 'AGENT'
            AND u.status IN (0,1)
            ORDER BY u.date_created DESC
            LIMIT ? OFFSET ?`,
            [limit, offset]
        );

        // Extract all user_ids for batch operations
        const userIds = rows.map(r => r.user_id).filter(Boolean);
        let kycDocs = [];
        let prefunding = [];
        let linkedAccounts = [];

        if (userIds.length > 0) {
            // Fetch KYC docs
            const [kycRows] = await pool.query(
                `SELECT * FROM customer_kyc WHERE user_id IN (?)`,
                [userIds]
            );
            kycDocs = kycRows;

            // Fetch prefunding records
            const [fundingRows] = await pool.query(
                `SELECT * FROM prefunding WHERE user_id IN (?)`,
                [userIds]
            );
            prefunding = fundingRows;

            // Fetch linked accounts
            const [linkedRows] = await pool.query(
                `SELECT * FROM linked_accounts WHERE user_id IN (?)`,
                [userIds]
            );
            linkedAccounts = linkedRows;
        }

        // Attach KYC docs and funding records
        const formattedRows = rows.map(agent => {
            const agentKyc = kycDocs.filter(k => k.user_id === agent.user_id);
            const agentLinked = linkedAccounts.filter(l => l.user_id === agent.user_id);
            const agentFunding = prefunding.filter(f => f.user_id === agent.user_id);
            return {
                ...agent,
                status: statusMap[agent.status] || "UNKNOWN",
                documents: agentKyc.length ? agentKyc : [],
                funding: agentFunding.length ? agentFunding : [],
                linked_accounts: agentLinked.length ? agentLinked : []
            };
        });

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
    let limit = parseInt(req.query.limit) || 10;
    let offset = (page - 1) * limit;

    // Get total count of suspended AGENTs
    const [countResult] = await pool.query(`
      SELECT COUNT(*) AS total 
      FROM users_account 
      WHERE status = 3 
      AND account_type = 'AGENT'
    `);

    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limit);

    // Fetch paginated suspended AGENTs
    const [rows] = await pool.query(
      `SELECT 
          user_id,
          agent_id,
          account_type,
          phone_number,
          status,
          first_name,
          last_name,
          email_address,
          dob,
          business_name,
          business_address,
          business_hours,
          security_question,
          date_created,
          kyc_status,
          suspension_reason,
          suspended_by,
          suspended_date
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

    // Extract user_ids for batch fetch
    const userIds = rows.map(r => r.user_id).filter(Boolean);
    let kycDocs = [];
    let prefunding = [];
    let linkedAccounts = [];

    if (userIds.length > 0) {
      // Fetch KYC docs
      const [kycRows] = await pool.query(
        `SELECT * FROM customer_kyc WHERE user_id IN (?)`,
        [userIds]
      );
      kycDocs = kycRows;

      // Fetch prefunding records
      const [fundingRows] = await pool.query(
        `SELECT * FROM prefunding WHERE user_id IN (?)`,
        [userIds]
      );
      prefunding = fundingRows;

      // Fetch linked accounts
      const [linkedRows] = await pool.query(
        `SELECT * FROM linked_accounts WHERE user_id IN (?)`,
        [userIds]
      );
      linkedAccounts = linkedRows;
    }

    // Attach KYC docs and funding records
    const formattedRows = rows.map(agent => {
      const agentKyc = kycDocs.filter(k => k.user_id === agent.user_id);
      const agentFunding = prefunding.filter(f => f.user_id === agent.user_id);
      const agentLinked = linkedAccounts.filter(l => l.user_id === agent.user_id);
      return {
        ...agent,
        status: statusMap[agent.status] || "UNKNOWN",
        documents: agentKyc.length ? agentKyc : [],
        funding: agentFunding.length ? agentFunding : [],
        linked_accounts: agentLinked.length ? agentLinked : []
      };
    });

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
    let limit = parseInt(req.query.limit) || 10;
    let offset = (page - 1) * limit;

    // Get total count of archived agents (deleted or closed)
    const [countResult] = await pool.query(`
      SELECT COUNT(*) as total 
      FROM users_account 
      WHERE status IN (2, 5) 
      AND account_type = 'AGENT'
    `);

    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limit);

    // Fetch paginated archived agents
    const [rows] = await pool.query(
      `SELECT 
          user_id,
          agent_id,
          account_type,
          phone_number,
          status,
          first_name,
          last_name,
          email_address,
          dob,
          business_name,
          business_location,
          business_address,
          business_hours,
          security_question,
          date_created,
          closure_reason,
          closed_by,
          closed_date,
          kyc_status
       FROM users_account 
       WHERE status IN (2, 5)
       AND account_type = 'AGENT'
       ORDER BY date_created DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        status: false,
        message: "No archived agent accounts found",
      });
    }

    // Extract user_ids to batch fetch related data
    const userIds = rows.map(r => r.user_id).filter(Boolean);
    let kycDocs = [];
    let prefunding = [];
    let linkedAccounts = [];

    if (userIds.length > 0) {
      // Fetch KYC documents
      const [kycRows] = await pool.query(
        `SELECT * FROM customer_kyc WHERE user_id IN (?)`,
        [userIds]
      );
      kycDocs = kycRows;

      // Fetch funding history
      const [fundingRows] = await pool.query(
        `SELECT * FROM prefunding WHERE user_id IN (?)`,
        [userIds]
      );
      prefunding = fundingRows;

      // Fetch linked accounts
      const [linkedRows] = await pool.query(
        `SELECT * FROM linked_accounts WHERE user_id IN (?)`,
        [userIds]
      );
      linkedAccounts = linkedRows;
    }

    // Attach KYC docs & funding records to each archived agent, and linked accounts
    const formattedRows = rows.map(agent => {
      const agentKyc = kycDocs.filter(k => k.user_id === agent.user_id);
      const agentFunding = prefunding.filter(f => f.user_id === agent.user_id);
      const agentLinked = linkedAccounts.filter(l => l.user_id === agent.user_id);

      return {
        ...agent,
        status: statusMap[agent.status] || "UNKNOWN",
        documents: agentKyc.length ? agentKyc : [],
        funding: agentFunding.length ? agentFunding : [],
        linked_accounts: agentLinked.length ? agentLinked : []
      };
    });

    return res.json({
      status: true,
      message: "Archived Agent accounts fetched successfully",
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
    console.error("Fetch Archived Agents Error:", err);
    return res.status(500).json({ status: false, message: "Server error" });
  }
};







exports.fetchSingleAgent = async (req, res) => {
  try {
    const { user_id } = req.params;

    // Fetch agent user by ID
    const [rows] = await pool.query(
      `SELECT user_id, account_type, agent_id, phone_number, status, first_name, last_name, email_address, dob, business_name, business_address, security_question, security_answer, profile_img, suspension_reason, suspended_by, suspended_date, closure_reason, closed_by, closed_date, date_created, date_updated
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
    const agent_email = userRecord.email_address;

    // Ensure the account is an AGENT
    if (userRecord.account_type !== "AGENT") {
      return res.status(400).json({
        status: false,
        message: "User is not an AGENT",
      });
    }


    //check for documents
    const [rows_] = await pool.query(
      `SELECT *
       FROM become_an_agent 
       WHERE email_address = ? 
       LIMIT 1`,
      [agent_email]
    );

    let business_details = {};

    if (rows_.length === 0) {
      business_details.is_verified = "NOT_UPLOADED";
    } else{
        business_details = rows_[0];
    }

    // Format user
    const user = {
      ...userRecord,
    //   kyc_status: statusMap[userRecord.status] || "UNKNOWN",
      business_details: business_details, 
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
        const admin_id = req.user?.email || "SYSTEM";

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
             SET status = 3, suspension_reason = ?,
             suspended_by = ?, suspended_date = NOW() 
             WHERE user_id = ?`,
            [reason, admin_id, user_id]
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
        const admin_id = req.user?.email || "SYSTEM";

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
             SET status = 5, closure_reason = ?,
             closed_by = ?, closed_date = NOW()
             WHERE user_id = ?`,
            [reason, admin_id, user_id]
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






exports.reinstateAgent = async (req, res) => {
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

        // const currentStatus = rows[0].status;
        const { status: currentStatus, account_type } = rows[0];

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
                message: "Only AGENT accounts can be Reinstated"
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

