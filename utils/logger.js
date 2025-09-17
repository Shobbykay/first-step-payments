const pool = require("../services/db");

/**
 * 
 * @param {Object} params
 * @param {string|number} params.user_id - The user being affected
 * @param {string} params.action - The action performed (e.g. "SUSPEND_CUSTOMER")
 * @param {string} params.log_message - Details about the action
 * @param {string|number} params.status - Status (e.g. "SUCCESS" | "FAILED" or numeric code)
 * @param {string|number} params.action_by - The user/admin performing the action
 */

async function logAction({ user_id, action, log_message, status, action_by }) {
    try {
        await pool.query(
            `INSERT INTO audit_logs (user_id, action, log_message, status, action_by) 
             VALUES (?, ?, ?, ?, ?)`,
            [user_id, action, log_message, status, action_by]
        );
    } catch (err) {
        console.error("Failed to insert audit log:", err.message);
    }
}

module.exports = logAction;
