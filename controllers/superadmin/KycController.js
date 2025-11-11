const { sha1Hex, hashPassword } = require("../../utils/utilities");
const pool = require('../../services/db');
const jwt = require("jsonwebtoken");
const { sendMail } = require("../../utils/mailHelper");
const crypto = require('crypto');
const logAction = require("../../utils/logger");


exports.fetchCustomersKYC = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT 
        a.user_id, 
        a.first_name, 
        a.last_name, 
        a.phone_number, 
        a.email_address, 
        b.date_uploaded AS submission_date, 
        b.document_type, 
        b.document_link, 
        b.status
      FROM users_account a
      INNER JOIN customer_kyc b 
        ON a.user_id = b.user_id
      WHERE a.account_type = 'USER'`
    );

    // Transform response to rename 'document_link' → 'document_selfie' when type is SELFIE
    const formattedData = rows.map((item) => {
      if (item.document_type === "SELFIE") {
        return {
          ...item,
          document_selfie: item.document_link,
          document_link: undefined, // optionally remove old key
        };
      }
      return item;
    });

    return res.status(200).json({
      status: true,
      message: "Customer KYC records fetched successfully",
      data: formattedData,
    });
  } catch (err) {
    console.error("Error fetching customer KYC records:", err);
    return res.status(500).json({
      status: false,
      message: "Server error while fetching customer KYC records",
    });
  }
};




exports.fetchAgentsKYC = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT 
        a.user_id, 
        a.first_name, 
        a.last_name, 
        a.phone_number, 
        a.email_address, 
        b.business_name, 
        b.government_id,
        b.utility_bill,
        b.passport_photo,
        b.date_created AS submission_date, 
        b.is_verified,
        b.verified_by,
        b.verified_date
      FROM users_account a
      INNER JOIN become_an_agent b 
        ON a.email_address = b.email_address
      WHERE a.account_type = 'AGENT'`
    );

    return res.status(200).json({
      status: true,
      message: "Agents fetched successfully",
      data: rows,
    });
  } catch (err) {
    console.error("Error fetching agents:", err);
    return res.status(500).json({
      status: false,
      message: "Server error while fetching agents",
    });
  }
};





exports.approveCustomerKYC = async (req, res) => {
  const { user_id, document_type } = req.body;
  const email_address = req.user?.email;// from middleware

  if (!user_id || !document_type) {
    return res.status(400).json({ status: false, message: "user_id and document_type are required" });
  }

  try {
    // Check if document exists
    const [docs] = await pool.query(
      "SELECT * FROM customer_kyc WHERE user_id = ? AND document_type = ? LIMIT 1",
      [user_id, document_type]
    );

    if (docs.length === 0) {
      return res.status(404).json({ status: false, message: "KYC document not found" });
    }

    const doc = docs[0];

    // Check if already approved
    if (doc.status === "APPROVED") {
      return res.status(200).json({
        status: false,
        message: `This ${document_type.replace(/_/g, " ")} has already been approved.`,
      });
    }

    // Update record
    await pool.query(
      `UPDATE customer_kyc 
       SET status = 'APPROVED', approved_by = ?, approved_date = NOW() 
       WHERE user_id = ? AND document_type = ?`,
      [email_address, user_id, document_type]
    );

    // Check if user now meets full verification conditions
    const [kycDocs] = await pool.query(
      `SELECT document_type, status 
       FROM customer_kyc 
       WHERE user_id = ? AND status = 'APPROVED'`,
      [user_id]
    );

    const approvedTypes = kycDocs.map(d => d.document_type.toUpperCase());
    const hasSelfie = approvedTypes.includes("SELFIE");
    const hasUtilityBill = approvedTypes.includes("UTILITY_BILL");
    const hasValidID = ["NATIONAL_ID", "DRIVERS_LICENSE", "INTL_PASSPORT"].some(idType =>
      approvedTypes.includes(idType)
    );

    if (hasSelfie && hasUtilityBill && hasValidID) {
      await pool.query(
        "UPDATE users_account SET kyc_status = 'VERIFIED' WHERE user_id = ?",
        [user_id]
      );
    }

    // Fetch user details for email
    const [userRows] = await pool.query(
      "SELECT first_name, email_address FROM users_account WHERE user_id = ? LIMIT 1",
      [user_id]
    );

    if (userRows.length > 0) {
      const { first_name, email_address: userEmail } = userRows[0];

      // Send mail
      await sendMail(
        userEmail,
        "KYC Document Approved",
        `Hi <strong>${first_name}</strong>,<br><br>
        Your ${document_type.replace(/_/g, " ")} is approved successfully 🎉.<br>
        You can now enjoy sending money with <strong>FirstStep Financials</strong>.<br><br>
        Best regards,<br><strong>FirstStep Financials Team</strong>`
      );
    }

    // Log success
    await logAction({
      user_id,
      action: "APPROVE_CUSTOMER_KYC",
      log_message: `KYC document ${document_type} approved for user_id ${user_id}`,
      status: "SUCCESS",
      action_by: email_address,
    });

    return res.status(200).json({
      status: true,
      message: `${document_type.replace(/_/g, " ")} approved successfully.`,
    });
  } catch (err) {
    console.error("Error approving KYC:", err);
    return res.status(500).json({ status: false, message: "Server error" });
  }
};





exports.rejectCustomerKYC = async (req, res) => {
  const { user_id, document_type, rejected_reason } = req.body;
  const email_address = req.user?.email; // from middleware

  if (!user_id || !document_type || !rejected_reason) {
    return res.status(400).json({
      status: false,
      message: "user_id, document_type, and rejected_reason are required",
    });
  }

  try {
    // Check if document exists
    const [docs] = await pool.query(
      "SELECT * FROM customer_kyc WHERE user_id = ? AND document_type = ? LIMIT 1",
      [user_id, document_type]
    );

    if (docs.length === 0) {
      return res.status(404).json({
        status: false,
        message: "KYC document not found",
      });
    }

    const doc = docs[0];

    // Check if already rejected
    if (doc.status === "REJECTED") {
      return res.status(200).json({
        status: false,
        message: `This ${document_type.replace(/_/g, " ")} has already been rejected.`,
      });
    }

    // Update document status to REJECTED
    await pool.query(
      `UPDATE customer_kyc 
       SET status = 'REJECTED',
           rejected_reason = ?,
           rejected_by = ?,
           rejected_date = NOW()
       WHERE user_id = ? AND document_type = ?`,
      [rejected_reason, email_address, user_id, document_type]
    );

    // When a KYC doc is rejected, reset user’s overall KYC status to PENDING
    await pool.query(
      "UPDATE users_account SET kyc_status = 'PENDING' WHERE user_id = ?",
      [user_id]
    );

    // Fetch user details for email
    const [userRows] = await pool.query(
      "SELECT first_name, email_address FROM users_account WHERE user_id = ? LIMIT 1",
      [user_id]
    );

    if (userRows.length > 0) {
      const { first_name, email_address: userEmail } = userRows[0];

      // Send rejection email
      await sendMail(
        userEmail,
        "KYC Document Rejected",
        `Hi <strong>${first_name}</strong>,<br><br>
        Unfortunately, your ${document_type.replace(/_/g, " ")} was rejected.<br>
        <strong>Reason:</strong> ${rejected_reason}.<br><br>
        Please log in to your account and upload a valid replacement document.<br><br>
        Best regards,<br><strong>FirstStep Financials Team</strong>`
      );
    }

    // Log the action
    await logAction({
      user_id,
      action: "REJECT_CUSTOMER_KYC",
      log_message: `KYC document ${document_type} rejected for user_id ${user_id}. Reason: ${rejected_reason}`,
      status: "SUCCESS",
      action_by: email_address,
    });

    return res.status(200).json({
      status: true,
      message: `${document_type.replace(/_/g, " ")} rejected successfully.`,
    });
  } catch (err) {
    console.error("Error rejecting KYC:", err);
    return res.status(500).json({ status: false, message: "Server error" });
  }
};






exports.approveCustomerAgentKYC = async (req, res) => {
  const { email_address } = req.user?.email || {}; // middleware
  const { agent_email } = req.body; // we’ll use agent’s email to locate document

  if (!agent_email) {
    return res.status(400).json({ status: false, message: "Agent email is required" });
  }

  try {
    // Check if agent document exists
    const [docs] = await pool.query(
      "SELECT * FROM agents_documents WHERE email_address = ? LIMIT 1",
      [agent_email]
    );

    if (docs.length === 0) {
      return res.status(404).json({ status: false, message: "Agent KYC document not found" });
    }

    const doc = docs[0];

    //  Already verified check
    if (doc.is_verified === "APPROVED") {
      return res.status(400).json({
        status: false,
        message: `This agent’s KYC is already approved.`,
      });
    }

    //  Update KYC to approved
    await pool.query(
      `UPDATE agents_documents 
       SET is_verified = 'APPROVED', verified_by = ?, verified_date = NOW() 
       WHERE email_address = ?`,
      [email_address, agent_email]
    );

    // Fetch agent user details
    const [userRows] = await pool.query(
      "SELECT first_name, email_address FROM users_account WHERE email_address = ? LIMIT 1",
      [agent_email]
    );

    if (userRows.length > 0) {
      const { first_name, email_address: userEmail } = userRows[0];

      // Send mail
      await sendMail(
        userEmail,
        "Agent KYC Approved",
        `Hi <strong>${first_name}</strong>,<br><br>
        Your Agent KYC has been approved 🎉.<br>
        You can now operate fully with <strong>FirstStep</strong>.<br><br>
        Best regards,<br><strong>FirstStep Team</strong>`
      );
    }

    // Log success
    await logAction(
      agent_email,
      "AGENT_KYC_APPROVAL",
      `Agent KYC approved by ${email_address}`
    );

    return res.status(200).json({
      status: true,
      message: `Agent KYC approved successfully.`,
    });
  } catch (err) {
    console.error("Error approving Agent KYC:", err);
    return res.status(500).json({ status: false, message: "Server error" });
  }
};





// OLD
exports.approveAgentKYC = async (req, res) => {
  const { email_address } = req.user?.email || {}; // middleware
  const { agent_email } = req.body; // we’ll use agent’s email to locate document

  if (!agent_email) {
    return res.status(400).json({ status: false, message: "Agent email is required" });
  }

  try {
    // Check if agent document exists
    const [docs] = await pool.query(
      "SELECT * FROM agents_documents WHERE email_address = ? LIMIT 1",
      [agent_email]
    );

    if (docs.length === 0) {
      return res.status(404).json({ status: false, message: "Agent KYC document not found" });
    }

    const doc = docs[0];

    //  Already verified check
    if (doc.is_verified === "APPROVED") {
      return res.status(400).json({
        status: false,
        message: `This agent’s KYC is already approved.`,
      });
    }

    //  Update KYC to approved
    await pool.query(
      `UPDATE agents_documents 
       SET is_verified = 'APPROVED', verified_by = ?, verified_date = NOW() 
       WHERE email_address = ?`,
      [email_address, agent_email]
    );

    // Fetch agent user details
    const [userRows] = await pool.query(
      "SELECT first_name, email_address FROM users_account WHERE email_address = ? LIMIT 1",
      [agent_email]
    );

    if (userRows.length > 0) {
      const { first_name, email_address: userEmail } = userRows[0];

      // Send mail
      await sendMail(
        userEmail,
        "Agent KYC Approved",
        `Hi <strong>${first_name}</strong>,<br><br>
        Your Agent KYC has been approved 🎉.<br>
        You can now operate fully with <strong>FirstStep</strong>.<br><br>
        Best regards,<br><strong>FirstStep Team</strong>`
      );
    }

    // Log success
    await logAction(
      agent_email,
      "AGENT_KYC_APPROVAL",
      `Agent KYC approved by ${email_address}`
    );

    return res.status(200).json({
      status: true,
      message: `Agent KYC approved successfully.`,
    });
  } catch (err) {
    console.error("Error approving Agent KYC:", err);
    return res.status(500).json({ status: false, message: "Server error" });
  }
};





exports.rejectAgentKYC = async (req, res) => {
  const email_address = req.user?.email;// from middleware
  const { agent_email, reason } = req.body;

  if (!agent_email || !reason) {
    return res.status(400).json({
      status: false,
      message: "Agent email and rejection reason are required",
    });
  }

  try {
    // Check if agent document exists
    const [docs] = await pool.query(
      "SELECT * FROM agents_documents WHERE email_address = ? LIMIT 1",
      [agent_email]
    );

    if (docs.length === 0) {
      return res.status(400).json({
        status: false,
        message: "Agent KYC document not found",
      });
    }

    const doc = docs[0];

    // If already rejected or approved
    // if (doc.is_verified === "APPROVED") {
    //   return res.status(400).json({
    //     status: false,
    //     message: "Agent KYC is already approved. Cannot reject.",
    //   });
    // }
    if (doc.is_verified === "REJECTED") {
      return res.status(400).json({
        status: false,
        message: "Agent KYC is already rejected.",
      });
    }

    //  Reject KYC
    await pool.query(
      `UPDATE agents_documents 
       SET is_verified = 'REJECTED',
           rejected_reason = ?,
           rejected_by = ?,
           rejected_date = NOW()
       WHERE email_address = ?`,
      [reason, email_address, agent_email]
    );

    // Fetch agent user details
    const [userRows] = await pool.query(
      "SELECT first_name, email_address FROM users_account WHERE email_address = ? LIMIT 1",
      [agent_email]
    );

    if (userRows.length > 0) {
      const { first_name, email_address: userEmail } = userRows[0];

      // Send rejection mail
      await sendMail(
        userEmail,
        "Agent KYC Rejected",
        `Hi <strong>${first_name}</strong>,<br><br>
        Unfortunately, your Agent KYC submission was <strong>rejected</strong>.<br>
        Reason: <em>${reason}</em>.<br><br>
        Please update and resubmit your documents for approval.<br><br>
        Best regards,<br><strong>FirstStep FinancialsTeam</strong>`
      );
    }

    // Log rejection
    await logAction(
      agent_email,
      "AGENT_KYC_REJECTION",
      `Agent KYC rejected by ${email_address}. Reason: ${reason}`,
      email_address
    );

    return res.status(200).json({
      status: true,
      message: "Agent KYC rejected successfully",
    });
  } catch (err) {
    console.error("Error rejecting Agent KYC:", err);
    return res.status(500).json({ status: false, message: "Server error" });
  }
};





exports.listRejectedKYC = async (req, res) => {
  try {
    // Extract pagination parameters
    let { page = 1, limit = 20 } = req.query;
    page = parseInt(page);
    limit = parseInt(limit);

    const offset = (page - 1) * limit;

    // Count total rejected KYC entries
    const [countRows] = await pool.query(
      `SELECT COUNT(DISTINCT user_id) AS total 
       FROM customer_kyc 
       WHERE status = 'REJECTED'`
    );
    const total = countRows[0]?.total || 0;
    const totalPages = Math.ceil(total / limit);

    // Fetch paginated rejected KYCs
    // Fetch rejected KYC summary per user
    const [rows] = await pool.query(
      `SELECT 
          c.user_id,
          CONCAT(u.first_name, ' ', u.last_name) AS customer_name,
          u.email_address,
          u.phone_number,
          u.profile_img,
          ca.address,
          u.kyc_status,
          u.account_type,
          MAX(c.rejected_reason) AS rejected_reason,
          MAX(c.rejected_by) AS rejected_by,
          MAX(c.rejected_date) AS rejected_date
       FROM customer_kyc c
       INNER JOIN users_account u ON u.user_id = c.user_id
       LEFT JOIN customer_addresses ca ON ca.user_id = c.user_id
       WHERE c.status = 'REJECTED'
       GROUP BY c.user_id
       ORDER BY MAX(c.rejected_date) DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    // Fetch each user's rejected documents and attach to result
    const formattedRows = await Promise.all(
      rows.map(async (user) => {
        const [documents] = await pool.query(
          `SELECT document_type, document_link, rejected_reason, rejected_by, rejected_date, date_uploaded 
           FROM customer_kyc 
           WHERE user_id = ? AND status = 'REJECTED' 
           ORDER BY rejected_date DESC`,
          [user.user_id]
        );

        return {
          ...user,
          documents, // attach array of documents
        };
      })
    );

    return res.status(200).json({
      status: true,
      message: "Rejected KYC list fetched successfully",
      pagination: {
        total,
        page,
        limit,
        total_pages: totalPages,
        has_next: page < totalPages,
        has_prev: page > 1,
      },
      data: formattedRows,
    });
  } catch (err) {
    console.error("Error listing rejected KYC:", err);
    return res.status(500).json({
      status: false,
      message: "Server error fetching rejected KYC list",
    });
  }
};




exports.listApprovedKYC = async (req, res) => {
  try {
    // Extract pagination parameters
    let { page = 1, limit = 20 } = req.query;
    page = parseInt(page);
    limit = parseInt(limit);

    const offset = (page - 1) * limit;

    // Count distinct approved users
    const [countRows] = await pool.query(
      `SELECT COUNT(DISTINCT user_id) AS total 
       FROM customer_kyc 
       WHERE status = 'APPROVED'`
    );

    const total = countRows[0]?.total || 0;
    const totalPages = Math.ceil(total / limit);

    // Fetch paginated approved KYCs grouped by user
    const [rows] = await pool.query(
      `SELECT 
          c.user_id,
          CONCAT(u.first_name, ' ', u.last_name) AS customer_name,
          u.phone_number,
          u.email_address,
          u.profile_img,
          u.account_type,
          u.kyc_status,
          ca.address,
          MAX(c.approved_by) AS approved_by,
          MAX(c.approved_date) AS approved_date
       FROM customer_kyc c
       INNER JOIN users_account u ON u.user_id = c.user_id
       LEFT JOIN customer_addresses ca ON ca.user_id = c.user_id
       WHERE c.status = 'APPROVED'
       GROUP BY c.user_id
       ORDER BY MAX(c.approved_date) DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    // Fetch each user's approved documents and attach to result
    const formattedRows = await Promise.all(
      rows.map(async (user) => {
        const [documents] = await pool.query(
          `SELECT 
              document_type, 
              document_link, 
              approved_by, 
              approved_date, 
              date_uploaded
           FROM customer_kyc 
           WHERE user_id = ? AND status = 'APPROVED'
           ORDER BY approved_date DESC`,
          [user.user_id]
        );

        return {
          ...user,
          documents, // attach array of approved documents
        };
      })
    );

    return res.status(200).json({
      status: true,
      message: "Approved KYC list fetched successfully",
      pagination: {
        total,
        page,
        limit,
        total_pages: totalPages,
        has_next: page < totalPages,
        has_prev: page > 1,
      },
      data: formattedRows,
    });
  } catch (err) {
    console.error("Error listing approved KYC:", err);
    return res.status(500).json({
      status: false,
      message: "Server error fetching approved KYC list",
    });
  }
};






exports.listPendingKYC = async (req, res) => {
  try {
    // Extract pagination parameters
    let { page = 1, limit = 20 } = req.query;
    page = parseInt(page);
    limit = parseInt(limit);

    const offset = (page - 1) * limit;

    // Count total pending KYC records
    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total 
       FROM customer_kyc 
       WHERE status = 'PENDING'`
    );

    const total = countRows[0]?.total || 0;
    const totalPages = Math.ceil(total / limit);

    // Fetch paginated pending KYC records
    const [rows] = await pool.query(
      `SELECT 
          c.user_id,
          CONCAT(u.first_name, ' ', u.last_name) AS customer_name,
          u.phone_number,
          u.email_address,
          u.profile_img,
          c.date_uploaded AS submission_date,
          c.document_type,
          c.document_link
       FROM customer_kyc c
       INNER JOIN users_account u ON u.user_id = c.user_id
       WHERE c.status = 'PENDING'
       ORDER BY c.date_uploaded DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    return res.status(200).json({
      status: true,
      message: "Pending KYC list fetched successfully",
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
    console.error("Error listing pending KYC:", err);
    return res.status(500).json({
      status: false,
      message: "Server error fetching pending KYC list",
    });
  }
};






exports.listPendingCustomerKYC = async (req, res) => {
  try {
    // Extract pagination parameters
    let { page = 1, limit = 20 } = req.query;
    page = parseInt(page);
    limit = parseInt(limit);

    const offset = (page - 1) * limit;

    // Count total pending KYCs (not grouped)
    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total
       FROM customer_kyc c
       INNER JOIN users_account u ON u.user_id = c.user_id
       WHERE c.status = 'PENDING'
       AND u.account_type = 'USER'`
    );

    const total = countRows[0]?.total || 0;
    const totalPages = Math.ceil(total / limit);

    // Fetch all pending KYCs (not grouped)
    const [rows] = await pool.query(
      `SELECT 
          c.id AS kyc_id,
          c.user_id,
          c.document_type,
          c.document_link,
          c.status,
          c.date_uploaded,
          CONCAT(u.first_name, ' ', u.last_name) AS customer_name,
          u.phone_number,
          u.email_address,
          u.profile_img,
          u.account_type,
          u.kyc_status
       FROM customer_kyc c
       INNER JOIN users_account u ON u.user_id = c.user_id
       WHERE c.status = 'PENDING'
       AND u.account_type = 'USER'
       ORDER BY c.date_uploaded DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    // Attach documents for each record’s user
    const formattedRows = await Promise.all(
      rows.map(async (record) => {
        const [documents] = await pool.query(
          `SELECT 
              document_type, 
              document_link, 
              date_uploaded 
           FROM customer_kyc 
           WHERE user_id = ?
           ORDER BY date_uploaded DESC`,
          [record.user_id]
        );

        return {
          ...record,
          documents, // all KYC documents by this user
        };
      })
    );

    return res.status(200).json({
      status: true,
      message: "Pending KYC list fetched successfully",
      pagination: {
        total,
        page,
        limit,
        total_pages: totalPages,
        has_next: page < totalPages,
        has_prev: page > 1,
      },
      data: formattedRows,
    });
  } catch (err) {
    console.error("Error listing pending KYC:", err);
    return res.status(500).json({
      status: false,
      message: "Server error fetching pending KYC list",
    });
  }
};






exports.listPendingAgentKYC = async (req, res) => {
  try {
    // Extract pagination parameters
    let { page = 1, limit = 20 } = req.query;
    page = parseInt(page);
    limit = parseInt(limit);

    const offset = (page - 1) * limit;

    // Count distinct pending agent KYCs
    const [countRows] = await pool.query(
      `SELECT COUNT(DISTINCT c.user_id) AS total 
       FROM customer_kyc c
       INNER JOIN users_account u ON u.user_id = c.user_id
       WHERE c.status = 'PENDING' 
       AND u.account_type = 'AGENT'`
    );

    const total = countRows[0]?.total || 0;
    const totalPages = Math.ceil(total / limit);

    // Fetch distinct pending KYCs grouped by agent
    const [rows] = await pool.query(
      `SELECT 
          c.user_id,
          CONCAT(u.first_name, ' ', u.last_name) AS customer_name,
          u.phone_number,
          u.email_address,
          IFNULL(ca.address, u.address) AS address,
          u.profile_img,
          u.kyc_status,
          u.account_type,
          MAX(c.date_uploaded) AS latest_submission
       FROM customer_kyc c
       INNER JOIN users_account u ON u.user_id = c.user_id
       LEFT JOIN customer_addresses ca ON ca.user_id = c.user_id
       WHERE c.status = 'PENDING'
       AND u.account_type = 'AGENT'
       GROUP BY c.user_id
       ORDER BY latest_submission DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    // Attach KYC documents for each agent
    const formattedRows = await Promise.all(
      rows.map(async (agent) => {
        const [documents] = await pool.query(
          `SELECT 
              document_type, 
              document_link, 
              date_uploaded 
           FROM customer_kyc 
           WHERE user_id = ? AND status = 'PENDING'
           ORDER BY date_uploaded DESC`,
          [agent.user_id]
        );

        return {
          ...agent,
          documents, // array of pending KYC docs
        };
      })
    );

    return res.status(200).json({
      status: true,
      message: "Pending agent KYC list fetched successfully",
      pagination: {
        total,
        page,
        limit,
        total_pages: totalPages,
        has_next: page < totalPages,
        has_prev: page > 1,
      },
      data: formattedRows,
    });
  } catch (err) {
    console.error("Error listing pending agent KYC:", err);
    return res.status(500).json({
      status: false,
      message: "Server error fetching pending agent KYC list",
    });
  }
};







exports.listCustomerToAgent = async (req, res) => {
  try {
    // Pagination
    let { page = 1, limit = 20 } = req.query;
    page = parseInt(page);
    limit = parseInt(limit);
    const offset = (page - 1) * limit;

    // Count total pending applications
    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total 
       FROM become_an_agent b
       INNER JOIN users_account u ON u.email_address = b.email_address
       WHERE b.is_verified = 'PENDING'`
    );

    const total = countRows[0]?.total || 0;
    const totalPages = Math.ceil(total / limit);

    // Fetch pending applications
    const [rows] = await pool.query(
      `SELECT 
          u.user_id,
          CONCAT(u.first_name, ' ', u.last_name) AS customer_name,
          u.phone_number,
          b.email_address,
          b.business_name,
          b.business_address,
          b.location,
          b.business_hours,
          b.business_license,
          b.date_created AS applied_date
       FROM become_an_agent b
       INNER JOIN users_account u ON u.email_address = b.email_address
       WHERE b.is_verified = 'PENDING'
       ORDER BY b.date_created DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    // Parse business_hours JSON safely
    const formattedRows = rows.map((row) => {
      let businessHours = null;
      try {
        businessHours =
          typeof row.business_hours === "string"
            ? JSON.parse(row.business_hours)
            : row.business_hours;
      } catch {
        businessHours = null; // fallback if JSON is invalid
      }

      return {
        ...row,
        business_hours: businessHours,
      };
    });

    return res.status(200).json({
      status: true,
      message: "Pending customer-to-agent applications fetched successfully",
      pagination: {
        total,
        page,
        limit,
        total_pages: totalPages,
        has_next: page < totalPages,
        has_prev: page > 1,
      },
      data: formattedRows,
    });
  } catch (err) {
    console.error("Error fetching pending customer-to-agent applications:", err);
    return res.status(500).json({
      status: false,
      message: "Server error fetching pending customer-to-agent applications",
    });
  }
};





exports.viewCustomerKYC = async (req, res) => {
  try {
    const { user_id } = req.params;

    if (!user_id) {
      return res.status(400).json({
        status: false,
        message: "user_id is required",
      });
    }

    // --- Check if user exists ---
    const [userCheck] = await pool.query(
      "SELECT email_address FROM users_account WHERE user_id = ? LIMIT 1",
      [user_id]
    );

    if (userCheck.length === 0) {
      return res.status(404).json({
        status: false,
        message: "User not found",
      });
    }

    // --- Fetch customer summary info ---
    const [customerRows] = await pool.query(
      `SELECT 
          u.user_id, 
          u.email_address, 
          CONCAT(u.first_name, ' ', u.last_name) AS customer_name, 
          u.phone_number, 
          IFNULL(u.address, ca.address) AS customer_address, 
          u.kyc_status, 
          MAX(c.date_uploaded) AS submission_date
       FROM users_account u
       INNER JOIN customer_kyc c ON c.user_id = u.user_id
       LEFT JOIN customer_addresses ca ON ca.user_id = u.user_id
       WHERE u.user_id = ?
       GROUP BY u.user_id`,
      [user_id]
    );

    if (customerRows.length === 0) {
      return res.status(404).json({
        status: false,
        message: "No KYC record found for this user",
      });
    }

    const customerInfo = customerRows[0];

    // --- Fetch KYC documents ---
    const [docs] = await pool.query(
      `SELECT 
          document_type, 
          document_link, 
          date_uploaded, 
          status 
       FROM customer_kyc 
       WHERE user_id = ?
       ORDER BY date_uploaded DESC`,
      [user_id]
    );

    // --- response ---
    const response = {
      ...customerInfo,
      documents: docs,
    };

    return res.status(200).json({
      status: true,
      message: "Customer KYC details fetched successfully",
      data: response,
    });
  } catch (err) {
    console.error("Error fetching customer KYC:", err);
    return res.status(500).json({
      status: false,
      message: "Server error fetching customer KYC details",
    });
  }
};





exports.verifyKYC = async (req, res) => {
  try {
    const { user_id } = req.params;
    const { verification_note } = req.body;
    const approved_by = req.user?.email || "SYSTEM"; // from middleware

    if (!user_id || !verification_note) {
      return res.status(400).json({
        status: false,
        message: "user_id and verification_note are required",
      });
    }

    // Verify user exists and has KYC status PENDING or REJECTED
    const [userRows] = await pool.query(
      `SELECT first_name, email_address, kyc_status 
       FROM users_account 
       WHERE user_id = ? 
       LIMIT 1`,
      [user_id]
    );

    if (userRows.length === 0) {
      return res.status(404).json({
        status: false,
        message: "User not found",
      });
    }

    const { first_name, email_address, kyc_status } = userRows[0];

    if (!["PENDING", "REJECTED"].includes(kyc_status)) {
      return res.status(400).json({
        status: false,
        message: "KYC verification not allowed — user is neither PENDING nor REJECTED",
      });
    }

    // Ensure user has at least one KYC record
    const [kycDocs] = await pool.query(
      `SELECT COUNT(*) AS kyc_count 
       FROM customer_kyc 
       WHERE user_id = ?`,
      [user_id]
    );

    if (kycDocs[0].kyc_count === 0) {
      return res.status(400).json({
        status: false,
        message: "No KYC records found for this user",
      });
    }

    // Fetch address from customer_addresses
    const [addressRows] = await pool.query(
      `SELECT address 
       FROM customer_addresses 
       WHERE user_id = ? 
       LIMIT 1`,
      [user_id]
    );

    if (addressRows.length === 0 || !addressRows[0].address) {
      return res.status(400).json({
        status: false,
        message: "No address found for this user in customer_addresses",
      });
    }

    const customerAddress = addressRows[0].address;

    // Approve all KYC documents
    await pool.query(
      `UPDATE customer_kyc 
       SET status = 'APPROVED', 
           approved_by = ?, 
           approved_date = NOW(),
           verification_notes = ?,
           rejected_reason = NULL,
           rejected_by = NULL,
           rejected_date = NULL 
       WHERE user_id = ?`,
      [approved_by, verification_note, user_id]
    );

    // Update user record → VERIFIED
    await pool.query(
      `UPDATE users_account 
       SET kyc_status = 'VERIFIED', address = ? 
       WHERE user_id = ?`,
      [customerAddress, user_id]
    );

    // Send mail
    await sendMail(
      email_address,
      "KYC Verification Successful 🎉",
      `Hi <strong>${first_name}</strong>,<br><br>
      We’re pleased to inform you that your KYC verification has been successfully completed.<br><br>
      <strong>Verification Note:</strong><br>${verification_note}<br><br>
      You now have full access to <strong>FirstStep Financials</strong> services.<br><br>
      Best regards,<br>
      <strong>FirstStep Financials Team</strong>`
    );

    // Log action
    await logAction({
      user_id,
      action: "VERIFY_CUSTOMER_KYC",
      log_message: `Customer KYC verified successfully. Note: ${verification_note}`,
      status: "SUCCESS",
      action_by: approved_by,
    });

    return res.status(200).json({
      status: true,
      message: "Customer KYC verified successfully and email sent",
    });
  } catch (err) {
    console.error("Error verifying customer KYC:", err);
    return res.status(500).json({
      status: false,
      message: "Server error verifying customer KYC",
    });
  }
};





exports.rejectKYC = async (req, res) => {
  try {
    const { user_id } = req.params;
    const { rejection_reason } = req.body;
    const rejected_by = req.user?.email || 'SYSTEM'; // from middleware

    if (!user_id || !rejection_reason) {
      return res.status(400).json({
        status: false,
        message: "user_id and rejection_reason are required",
      });
    }

    // Check if user exists
    const [userRows] = await pool.query(
      `SELECT first_name, email_address 
       FROM users_account 
       WHERE user_id = ? 
       LIMIT 1`,
      [user_id]
    );

    if (userRows.length === 0) {
      return res.status(404).json({
        status: false,
        message: "User not found",
      });
    }

    const { first_name, email_address } = userRows[0];

    // Ensure user has at least one KYC record (any status)
    const [kycDocs] = await pool.query(
      `SELECT COUNT(*) AS total_docs 
       FROM customer_kyc 
       WHERE user_id = ?`,
      [user_id]
    );

    if (kycDocs[0].total_docs === 0) {
      return res.status(400).json({
        status: false,
        message: "No KYC documents found for this user",
      });
    }

    // Update all KYC documents for user → REJECTED (forcefully)
    await pool.query(
      `UPDATE customer_kyc 
       SET status = 'REJECTED',
           rejected_reason = ?,
           rejected_by = ?,
           rejected_date = NOW(),
           verification_notes = NULL,
           approved_by = NULL,
           approved_date = NULL 
       WHERE user_id = ?`,
      [rejection_reason, rejected_by, user_id]
    );

    // Update user KYC status to PENDING (so they can resubmit)
    await pool.query(
      `UPDATE users_account 
       SET kyc_status = 'PENDING'
       WHERE user_id = ?`,
      [user_id]
    );

    // Send rejection email
    await sendMail(
      email_address,
      "KYC Verification Rejected",
      `Hi <strong>${first_name}</strong>,<br><br>
      Your KYC verification has been <strong>rejected</strong>.<br><br>
      <strong>Reason:</strong> ${rejection_reason}<br><br>
      Please review your documents and resubmit them for re-verification.<br><br>
      Best regards,<br>
      <strong>FirstStep Financials Team</strong>`
    );

    // Log rejection action
    await logAction({
      user_id,
      action: "REJECT_CUSTOMER_KYC",
      log_message: `Customer KYC rejected. Reason: ${rejection_reason}`,
      status: "SUCCESS",
      action_by: rejected_by,
    });

    return res.status(200).json({
      status: true,
      message: "Customer KYC rejected successfully and email sent",
    });
  } catch (err) {
    console.error("Error rejecting customer KYC:", err);
    return res.status(500).json({
      status: false,
      message: "Server error rejecting customer KYC",
    });
  }
};





exports.resubmitKYCRequest = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { email_address } = req.body;
    const action_by = req.user?.email || "SYSTEM"; // from middleware

    if (!email_address) {
      return res.status(400).json({
        status: false,
        message: "Email address is required",
      });
    }

    // Check if user exists
    const [userRows] = await connection.query(
      "SELECT user_id, first_name FROM users_account WHERE email_address = ?",
      [email_address]
    );

    if (userRows.length === 0) {
      return res.status(404).json({
        status: false,
        message: "User not found",
      });
    }

    const { user_id, first_name } = userRows[0];

    // Fetch KYC records
    const [kycRows] = await connection.query(
      `SELECT user_id, document_type, document_link, date_uploaded, status, 
              verification_notes, approved_by, approved_date, 
              rejected_reason, rejected_by, rejected_date 
       FROM customer_kyc 
       WHERE user_id = ?`,
      [user_id]
    );

    if (kycRows.length === 0) {
      return res.status(404).json({
        status: false,
        message: "No KYC records found for this user",
      });
    }

    // Ensure at least one is REJECTED
    const hasRejected = kycRows.some((doc) => doc.status === "REJECTED");
    if (!hasRejected) {
      return res.status(400).json({
        status: false,
        message: "Resubmission not allowed — no rejected KYC found",
      });
    }

    // Start transaction
    await connection.beginTransaction();

    // Move all records to customer_kyc_rejected
    const insertPromises = kycRows.map((row) =>
      connection.query(
        `INSERT INTO customer_kyc_rejected 
         (user_id, document_type, document_link, date_uploaded, status, 
          verification_notes, approved_by, approved_date, rejected_reason, 
          rejected_by, rejected_date, archived_by, archived_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          row.user_id,
          row.document_type,
          row.document_link,
          row.date_uploaded,
          row.status,
          row.verification_notes,
          row.approved_by,
          row.approved_date,
          row.rejected_reason,
          row.rejected_by,
          row.rejected_date,
          action_by
        ]
      )
    );

    await Promise.all(insertPromises);

    // Delete old KYC records for fresh resubmission
    await connection.query("DELETE FROM customer_kyc WHERE user_id = ?", [user_id]);

    // Log action
    await logAction({
      user_id,
      action: "KYC_RESUBMISSION_REQUEST",
      log_message: `User ${email_address} requested KYC resubmission after rejection.`,
      status: "SUCCESS",
      action_by,
    });

    // Send mail
    await sendMail(
      email_address,
      "KYC Resubmission Request Accepted",
      `Hi <strong>${first_name}</strong>,<br><br>
      We’ve received your request to resubmit your KYC documents after a previous rejection.<br><br>
      You can now upload fresh documents for verification.<br><br>
      Best regards,<br>
      <strong>FirstStep Financials Team</strong>`
    );

    // Commit transaction
    await connection.commit();

    return res.status(200).json({
      status: true,
      message: "KYC resubmission request processed successfully",
    });
  } catch (err) {
    console.error("Error processing KYC resubmission:", err);
    await connection.rollback();
    return res.status(500).json({
      status: false,
      message: "Server error while processing KYC resubmission",
    });
  } finally {
    connection.release();
  }
};
