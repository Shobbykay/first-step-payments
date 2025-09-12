const { sha1Hex } = require("../../utils/utilities");
const pool = require('../../services/db');
const jwt = require("jsonwebtoken");
const { sendMail } = require("../../utils/mailHelper");
const crypto = require('crypto');

// Status mapping
const statusMap = {
    0: "PENDING",
    1: "VERIFIED",
    2: "DELETED",
    3: "SUSPENDED",
    4: "INCOMPLETE_DETAILS"
};

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

        // Transform rows: rename `status` -> `kyc_status`
        const formattedRows = rows.map(({ status, ...rest }) => ({
            ...rest,
            kyc_status: statusMap[status] || "UNKNOWN"
        }));

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




exports.fetchSingleCustomer = async (req, res) => {
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