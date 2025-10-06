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
      INNER JOIN agents_documents b 
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
  const { email_address } = req.user?.email || {}; // from middleware

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
  const { email_address } = req.user?.email || {}; // approver from middleware
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
      return res.status(404).json({
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
      `Agent KYC rejected by ${email_address}. Reason: ${reason}`
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
