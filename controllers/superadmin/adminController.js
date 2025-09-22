const jwt = require("jsonwebtoken");
const { sendMail } = require("../../utils/mailHelper");
const crypto = require('crypto');
const logAction = require("../../utils/logger");
const pool = require('../../services/db');
const { sha1Hex, hashPassword, allowedAdminRoles } = require("../../utils/utilities");
const { v4: uuidv4 } = require("uuid");


exports.addAdminUser = async (req, res) => {
  const { fullname, email_address, role } = req.body;
  const admin_id = req.user?.id || "SYSTEM";

  try {
    // Validate required fields
    if (!fullname || !email_address || !role) {
      return res.status(400).json({
        status: false,
        message: "fullname, email_address, and role are required",
      });
    }

    // Validate role
    const validRoles = ["ADMINISTRATOR", "CUSTOMER_SUPPORT", "FINANCE_OFFICER", "COMPLIANCE"];
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        status: false,
        message: `Invalid role. Must be one of: ${validRoles.join(", ")}`,
      });
    }

    // Generate UUIDv4 for user_id
    const user_id = uuidv4();

    // Default status
    const status = "PENDING";

    // Insert admin user
    await pool.query(
      `INSERT INTO admin_users (user_id, fullname, email_address, role, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [user_id, fullname, email_address, role, status, admin_id]
    );

    // Generate 6-digit OTP
    const otp = crypto.randomInt(100000, 999999).toString();

    // Expiry = 1 hour from now
    const expires = new Date(Date.now() + 60 * 60 * 1000);

    // Insert OTP record
    await pool.query(
      `INSERT INTO admin_otp (email_address, otp, expires) VALUES (?, ?, ?)`,
      [email_address, otp, expires]
    );

    // Log action
    await logAction({
      user_id,
      action: "ADD_ADMIN_USER",
      log_message: `New admin user ${fullname} (${role}) created successfully`,
      status: "SUCCESS",
      action_by: admin_id,
    });


    const setupUrl = process.env.ADMIN_SETUP_URL || 'http://yetziratlabs.com.ng/fsf-admin';


    // Send notification email
    await sendMail(
      email_address,
      "FirstStep Payments Admin Profile Created",
      `Hello <strong>${fullname}</strong>,<br><br>

      An administrator account has been created for you on the <strong>FirstStep Payments</strong> platform with the role of <strong>${role}</strong>.<br><br>

      To activate your account, please click the link below to set up your password:<br><br>

      <a href="${setupUrl}/auth/setup-password?msn=${encodeURIComponent(otp)}" style="background-color:#4CAF50;color:white;padding:10px 20px;text-decoration:none;border-radius:5px;">Set Up My Password</a><br><br>

      This link will expire in <strong>1 hour</strong>. If the link has expired, you can request a new setup link from the login page.<br><br>If you did not expect this email, please contact our support team immediately.<br><br>

      Best regards,<br>
      <strong>FirstStep Payments Team</strong>
      `
    );

    return res.status(201).json({
      status: true,
      message: "Admin user created successfully",
      data: {
        user_id,
        fullname,
        email_address,
        role,
        status,
        created_by: admin_id,
        otp_expires: expires,
      },
    });
  } catch (err) {
    console.error("Add admin user error:", err);

    await logAction({
      user_id: null,
      action: "ADD_ADMIN_USER",
      log_message: `Server error while creating admin user: ${err.message}`,
      status: "FAILED",
      action_by: admin_id,
    });

    return res.status(500).json({ status: false, message: "Server error" });
  }
};





//?page=1
exports.adminListOtps = async (req, res) => {
  try {
    let { page } = req.query;
    page = parseInt(page) || 1;

    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    // Fetch paginated OTPs
    const [rows] = await pool.query(
      "SELECT * FROM admin_otp ORDER BY date_created DESC LIMIT ? OFFSET ?",
      [limit, offset]
    );

    // Count total records
    const [[{ total }]] = await pool.query("SELECT COUNT(*) as total FROM admin_otp");

    return res.json({
      status: true,
      message: "Admin OTP list",
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      totalRecords: total,
      data: rows,
    });
  } catch (error) {
    console.error("Error fetching admin OTPs:", error);
    return res.status(500).json({
      status: false,
      message: "Server error fetching admin OTPs",
    });
  }
};






exports.changeRole = async (req, res) => {
  try {
    const { email_address, role } = req.body;
    const admin_id = req.user?.id || "SYSTEM";

    const admin_email = req.user?.email_address || "";

    // Only SYSTEM or super admin can change roles
    if (
      admin_id !== "SYSTEM" &&
      admin_email !== "developer@firststepfinancials.com"
    ) {
      return res.status(403).json({
        status: false,
        message: "You are not authorized to change admin roles",
      });
    }

    // Validate inputs
    if (!email_address || !role) {
      return res.status(400).json({
        status: false,
        message: "Email address and role are required",
      });
    }

    // Validate role against allowed list
    if (!allowedAdminRoles().includes(role)) {
      return res.status(400).json({
        status: false,
        message: `Invalid role`,
      });
    }

    // Check if admin exists
    const [rows] = await pool.query(
      "SELECT user_id, role FROM admin_users WHERE email_address = ? LIMIT 1",
      [email_address]
    );

    if (rows.length === 0) {
      await logAction({
        user_id: null,
        action: "CHANGE_ROLE",
        log_message: `Attempted to change role but admin with email ${email_address} not found`,
        status: "FAILED",
        action_by: admin_id,
      });

      return res.status(404).json({
        status: false,
        message: "Admin user not found",
      });
    }

    const { user_id, role: oldRole } = rows[0];

    // Update role
    await pool.query(
      "UPDATE admin_users SET role = ? WHERE email_address = ?",
      [role, email_address]
    );

    // Log success
    await logAction({
      user_id,
      action: "CHANGE_ROLE",
      log_message: `Role changed from ${oldRole} to ${role} for admin ${email_address}`,
      status: "SUCCESS",
      action_by: admin_id,
    });

    return res.status(200).json({
      status: true,
      message: `Role updated successfully to ${role}`,
      data: {
        email_address,
        oldRole,
        newRole: role,
      },
    });
  } catch (err) {
    console.error("Change Role error:", err);

    await logAction({
      user_id: null,
      action: "CHANGE_ROLE",
      log_message: `Server error: ${err.message}`,
      status: "FAILED",
      action_by: req.user?.id || "SYSTEM",
    });

    return res.status(500).json({
      status: false,
      message: "Server error while changing role",
    });
  }
};





exports.addPassword = async (req, res) => {
  const { email_address, password } = req.body;

  if (!email_address || !password) {
    return res.status(400).json({
      status: false,
      message: "Email address and password are required",
    });
  }

  try {
    // Check if email exists in admin_otp
    const [otpRows] = await pool.query(
      "SELECT * FROM admin_otp WHERE email_address = ? LIMIT 1",
      [email_address]
    );

    if (otpRows.length === 0) {
      return res.status(404).json({
        status: false,
        message: "Email not found in OTP records or setup not requested",
      });
    }

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
    const hashedPassword = await sha1Hex(password);

    // Update admin_users with hashed password and activate account
    const [result] = await pool.query(
      "UPDATE admin_users SET password = ?, status = 'ACTIVE' WHERE email_address = ?",
      [hashedPassword, email_address]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        status: false,
        message: "Admin user not found for this email",
      });
    }

    // Delete OTP record
    await pool.query("DELETE FROM admin_otp WHERE email_address = ?", [
      email_address,
    ]);

    return res.status(200).json({
      status: true,
      message: "Password set successfully. Your account is now active.",
    });
  } catch (error) {
    console.error("Add password error:", error);
    return res.status(500).json({
      status: false,
      message: "Server error while setting password",
    });
  }
};





exports.verifyAdminOtp = async (req, res) => {
  try {
    const { otp } = req.params;

    if (!otp) {
      return res.status(400).json({
        status: false,
        message: "OTP is required",
      });
    }

    // Check if OTP exists and is still valid
    const [otpRows] = await pool.query(
      "SELECT email_address, expires FROM admin_otp WHERE otp = ? LIMIT 1",
      [otp]
    );

    if (otpRows.length === 0) {
      return res.status(404).json({
        status: false,
        message: "Invalid OTP",
      });
    }

    const { email_address, expires } = otpRows[0];

    // Check if expired
    if (new Date(expires) < new Date()) {
      return res.status(400).json({
        status: false,
        message: "OTP has expired",
      });
    }

    // Fetch user info from admin_users
    const [userRows] = await pool.query(
      "SELECT user_id, fullname, email_address FROM admin_users WHERE email_address = ? LIMIT 1",
      [email_address]
    );

    if (userRows.length === 0) {
      return res.status(404).json({
        status: false,
        message: "Admin user not found for this OTP",
      });
    }

    const { user_id, fullname } = userRows[0];

    return res.status(200).json({
      status: true,
      message: "OTP verified successfully",
      data: {
        user_id,
        fullname,
        email_address,
      },
    });
  } catch (err) {
    console.error("Verify Admin OTP error:", err);
    return res.status(500).json({
      status: false,
      message: "Server error while verifying OTP",
    });
  }
};





exports.deactivateAdmin = async (req, res) => {
  try {
    const { email_address } = req.body;
    const admin_id = req.user?.id || "SYSTEM";

    if (!email_address) {
      return res.status(400).json({
        status: false,
        message: "Email address is required",
      });
    }

    // Check if admin exists
    const [rows] = await pool.query(
      "SELECT user_id FROM admin_users WHERE email_address = ? LIMIT 1",
      [email_address]
    );

    if (rows.length === 0) {
      await logAction({
        user_id: null,
        action: "DEACTIVATE_ADMIN",
        log_message: `Attempted deactivation but admin with email ${email_address} not found`,
        status: "FAILED",
        action_by: admin_id,
      });

      return res.status(404).json({
        status: false,
        message: "Admin user not found",
      });
    }

    // Update status to DEACTIVATED
    await pool.query(
      "UPDATE admin_users SET status = 'DEACTIVATED' WHERE email_address = ?",
      [email_address]
    );

    await logAction({
      user_id: rows[0].user_id,
      action: "DEACTIVATE_ADMIN",
      log_message: `Admin user ${email_address} deactivated successfully`,
      status: "SUCCESS",
      action_by: admin_id,
    });

    return res.status(200).json({
      status: true,
      message: "Admin user deactivated successfully",
    });
  } catch (err) {
    console.error("Deactivate Admin error:", err);

    await logAction({
      user_id: null,
      action: "DEACTIVATE_ADMIN",
      log_message: `Server error: ${err.message}`,
      status: "FAILED",
      action_by: req.user?.id || "SYSTEM",
    });

    return res.status(500).json({
      status: false,
      message: "Server error while deactivating admin",
    });
  }
};




exports.reactivateAdmin = async (req, res) => {
  try {
    const { email_address } = req.body;
    const admin_id = req.user?.id || "SYSTEM";

    if (!email_address) {
      return res.status(400).json({
        status: false,
        message: "Email address is required",
      });
    }

    // Check if admin exists
    const [rows] = await pool.query(
      "SELECT user_id FROM admin_users WHERE email_address = ? LIMIT 1",
      [email_address]
    );

    if (rows.length === 0) {
      await logAction({
        user_id: null,
        action: "REACTIVATE_ADMIN",
        log_message: `Attempted reactivation but admin with email ${email_address} not found`,
        status: "FAILED",
        action_by: admin_id,
      });

      return res.status(404).json({
        status: false,
        message: "Admin user not found",
      });
    }

    // Update status to ACTIVE
    await pool.query(
      "UPDATE admin_users SET status = 'ACTIVE' WHERE email_address = ?",
      [email_address]
    );

    await logAction({
      user_id: rows[0].user_id,
      action: "REACTIVATE_ADMIN",
      log_message: `Admin user ${email_address} reactivated successfully`,
      status: "SUCCESS",
      action_by: admin_id,
    });

    return res.status(200).json({
      status: true,
      message: "Admin user reactivated successfully",
    });
  } catch (err) {
    console.error("Reactivate Admin error:", err);

    await logAction({
      user_id: null,
      action: "REACTIVATE_ADMIN",
      log_message: `Server error: ${err.message}`,
      status: "FAILED",
      action_by: req.user?.id || "SYSTEM",
    });

    return res.status(500).json({
      status: false,
      message: "Server error while reactivating admin",
    });
  }
};





exports.listAdminUsers = async (req, res) => {
  try {
    let page = parseInt(req.query.page) || 1;
    let limit = parseInt(req.query.limit) || 10;
    let offset = (page - 1) * limit;

    // Get total count of admin users
    const [countResult] = await pool.query(
      "SELECT COUNT(*) as total FROM admin_users"
    );
    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limit);

    // Fetch paginated admin users
    const [rows] = await pool.query(
      `SELECT * 
       FROM admin_users
       ORDER BY date_created DESC 
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    return res.json({
      status: true,
      message: "Admin Users fetched successfully",
      data: {
        pagination: {
          total,
          page,
          totalPages,
          limit,
        },
        records: rows,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      status: false,
      message: "Server error",
    });
  }
};
