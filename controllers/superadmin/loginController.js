const { sha1Hex } = require("../../utils/utilities");
const pool = require('../../services/db');
const jwt = require("jsonwebtoken");
const { sendMail } = require("../../utils/mailHelper");
const crypto = require('crypto');

exports.login = async (req, res) => {
    const { email_address, password } = req.body;

    if (!email_address || !password) {
        return res.status(400).json({ status: false, message: "Missing credentials" });
    }

    try {
        // hash password using SHA1
        const hashedPassword = await sha1Hex(password);

        // check for ACTIVE user only
        const [rows] = await pool.query(
        "SELECT * FROM admin_users WHERE email_address = ? AND password = ? AND status='ACTIVE'",
        [email_address, hashedPassword]
        );

        if (rows.length === 0) {
        return res.status(401).json({ status: false, message: "Invalid credentials or inactive account" });
        }

        const user = rows[0];

        // generate JWT token
        const token = jwt.sign(
        { user_id: user.user_id, email: user.email_address, role: user.role },
        process.env.JWT_SECRET || "your_jwt_secret",
        { expiresIn: "7d" } // token valid for 7 days
        );

        let user_id = user.user_id;

        //INSERT token to login table
        await pool.query(
        `INSERT INTO admin_login_token (user_id, login_token)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE
        login_token = VALUES(login_token),
        date_created = CURRENT_TIMESTAMP`,
        [user_id, token]
        );

        // return user data + token
        return res.json({
            status: true,
            message: "Login successful",
            token,
            data: user
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ status: false, message: "Server error" });
    }
};

exports.logoutAdmin = async (req, res) => {
    const { email_address } = req.body;

    if (!email_address) {
        return res.status(400).json({
        status: false,
        message: "Email address is required"
        });
    }

    try {
        // Fetch user_id from admin_users
        const [rows] = await pool.query(
        "SELECT user_id FROM admin_users WHERE email_address = ? LIMIT 1",
        [email_address]
        );

        if (rows.length === 0) {
        return res.status(404).json({
            status: false,
            message: "User not found"
        });
        }

        const user_id = rows[0].user_id;

        // Delete token from login table
        const [result] = await pool.query(
        "DELETE FROM admin_login_token WHERE user_id = ?",
        [user_id]
        );

        if (result.affectedRows === 0) {
        return res.status(404).json({
            status: false,
            message: "No active session found"
        });
        }

        return res.json({
        status: true,
        message: "Logout successful"
        });
    } catch (error) {
        console.error("Logout error:", error);
        return res.status(500).json({
        status: false,
        message: "Server error"
        });
    }
};

  


exports.forgot = async (req, res) => {
    const { email_address } = req.body;

    if (!email_address) {
        return res.status(400).json({ status: false, message: "Email address is required" });
    }

    try {
        // check if user exists
        const [rows] = await pool.query(
        "SELECT * FROM admin_users WHERE email_address = ? LIMIT 1",
        [email_address]
        );

        const fullname = rows[0].fullname;

        if (rows.length === 0) {
        return res.status(404).json({ status: false, message: "Email not found" });
        }

        // generate reset token + expiry
        const resetToken = crypto.randomBytes(20).toString("hex");
        const resetExpires = new Date(Date.now() + 3600 * 1000); // 1 hour from now

        // insert into admin_otp
        await pool.query(
        "INSERT INTO admin_otp (email_address, otp, expires) VALUES (?, ?, ?)",
        [email_address, resetToken, resetExpires]
        );

        // build reset link
        const resetLink = `${process.env.APP_URL || "http://localhost:3000"}/auth/new-password?resettoken=${resetToken}`;

        // Send notification email
        await sendMail(
            email_address,
            "FirstStep Admin Password Reset",
            `Hello <strong>${fullname}</strong>,<br><br>You requested a reset password, <a href='${resetLink}'>click here</a> or copy this ${resetLink} into another browser tab to complete your password reset.<br><br>If you did not perform this action, please contact super admin immediately.<br><br>Best regards,<br><strong>First Step Payments Team</strong>`
        );


        return res.json({
            status: true,
            message: "Password reset instructions sent",
            data: {
                reset_link: resetLink
            }
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ status: false, message: "Server error" });
    }
};


exports.confirmResetToken = async (req, res) => {
    const { resetToken } = req.body;

    if (!resetToken) {
        return res.status(400).json({ status: false, message: "resetToken is required" });
    }

    try {
        // find token
        const [rows] = await pool.query(
        "SELECT * FROM admin_otp WHERE otp = ? LIMIT 1",
        [resetToken]
        );

        if (rows.length === 0) {
        return res.status(400).json({ status: false, message: "Reset token not found" });
        }

        const record = rows[0];

        // check expiry
        if (new Date(record.expires) <= new Date()) {
            // delete expired token
            await pool.query("DELETE FROM admin_otp WHERE otp = ?", [resetToken]);

            return res.status(400).json({
                status: false,
                message: "Reset token expired and has been removed"
            });
        }

        // valid token
        return res.json({
            status: true,
            message: "Valid reset token",
            data: {
                email_address: record.email_address
            }
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ status: false, message: "Server error" });
    }
};


exports.reset = async (req, res) => {
    const { email_address, new_password } = req.body;

    if (!email_address || !new_password) {
        return res.status(400).json({ status: false, message: "Email and new password are required" });
    }

    try {
        // check if OTP record exists for this email
        const [otpRows] = await pool.query(
        "SELECT * FROM admin_otp WHERE email_address = ? LIMIT 1",
        [email_address]
        );

        if (otpRows.length === 0) {
        return res.status(400).json({ status: false, message: "No password reset request found for this email" });
        }

        // hash new password with SHA1
        const hashedPassword = await sha1Hex(new_password);

        // update password in admin_users
        await pool.query(
        "UPDATE admin_users SET password = ? WHERE email_address = ?",
        [hashedPassword, email_address]
        );

        // delete otp record
        await pool.query(
        "DELETE FROM admin_otp WHERE email_address = ?",
        [email_address]
        );

        // Fetch user by ID
        const [rows] = await pool.query(
            `SELECT fullname
             FROM admin_users 
             WHERE email_address = ? 
             LIMIT 1`,
            [email_address]
        );

        const fullname = rows[0].fullname || '';

        // Send notification email
        await sendMail(
            email_address,
            "FirstStep Admin Password Reset Success",
            `Hello <strong>${fullname}</strong>,<br><br>Your password reset was successful, please attempt a login https://yetziratlabs.com.ng/fsf-admin/login.<br><br>If you did not perform this action, please contact super admin immediately.<br><br>Best regards,<br><strong>First Step Payments Team</strong>`
        );

        return res.json({ status: true, message: "Password has been reset successfully" });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ status: false, message: "Server error" });
    }
};