const { sha1Hex } = require("../../utils/utilities");
const pool = require('../../services/db');
const jwt = require("jsonwebtoken");
const { sendMail } = require("../../utils/mailHelper");
const crypto = require('crypto');

exports.fetchAllCustomers = async (req, res) => {
    try {

        let page = parseInt(req.query.page) || 1;
        let limit = 30;
        let offset = (page - 1) * limit;

        // Get total count
        const [countResult] = await pool.query("SELECT COUNT(*) as total FROM users_account");
        const total = countResult[0].total;
        const totalPages = Math.ceil(total / limit);

        // Fetch paginated users
        const [rows] = await pool.query(
            `SELECT user_id, account_type, phone_number, status, first_name, last_name, email_address, dob, business_name, business_address, security_question, date_created 
            FROM users_account 
            ORDER BY date_created DESC
            LIMIT ? OFFSET ?`,
            [limit, offset]
        );

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
                records: rows
            }
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ status: false, message: "Server error" });
    }
};