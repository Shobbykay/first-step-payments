const pool = require('../../services/db');
const logAction = require("../../utils/logger");

exports.fetchTickets = async (req, res) => {
  try {
    // Default pagination params
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    // Fetch total count
    const [[{ total }]] = await pool.query("SELECT COUNT(*) AS total FROM tickets");

    // Fetch paginated tickets
    const [tickets] = await pool.query(
      "SELECT * FROM tickets ORDER BY date_created DESC LIMIT ? OFFSET ?",
      [limit, offset]
    );

    const totalPages = Math.ceil(total / limit);

    return res.status(200).json({
      status: true,
      message: "Tickets fetched successfully",
      pagination: {
        total,
        page,
        limit,
        total_pages: totalPages,
        has_next: page < totalPages,
        has_prev: page > 1,
      },
      data: tickets,
    });
  } catch (err) {
    console.error("Error fetching tickets:", err);
    return res.status(500).json({
      status: false,
      message: "Server error while fetching tickets",
    });
  }
};




exports.fetchSingleTicket = async (req, res) => {
  try {
    const { ticket_id } = req.params;

    if (!ticket_id) {
      return res.status(400).json({
        status: false,
        message: "ticket_id is required in the request parameters",
      });
    }

    // Fetch ticket by ID
    const [rows] = await pool.query(
      "SELECT * FROM tickets WHERE ticket_id = ? LIMIT 1",
      [ticket_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        status: false,
        message: "Ticket not found",
      });
    }

    return res.status(200).json({
      status: true,
      message: "Ticket fetched successfully",
      data: rows[0],
    });
  } catch (err) {
    console.error("Error fetching ticket:", err);
    return res.status(500).json({
      status: false,
      message: "Server error while fetching ticket",
    });
  }
};





exports.changeTicketStatus = async (req, res) => {
  try {
    const { ticket_id } = req.params;
    const { status, resolved_response } = req.body;
    const user_id = req.user?.user_id || "SYSTEM";
    const email_address = req.user?.email || "SYSTEM";

    const ALLOWED_STATUSES = ["IN_PROGRESS", "RESOLVED", "CLOSED"];

    // Validate input
    if (!ticket_id) {
      return res.status(400).json({
        status: false,
        message: "ticket_id is required in request parameters",
      });
    }

    if (!status || !ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({
        status: false,
        message: `Invalid status. Allowed values are: ${ALLOWED_STATUSES.join(", ")}`,
      });
    }

    // Check if ticket exists
    const [existing] = await pool.query(
      "SELECT status FROM tickets WHERE ticket_id = ? LIMIT 1",
      [ticket_id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        status: false,
        message: "Ticket not found",
      });
    }

    const currentStatus = existing[0].status;

    // Prevent reverting to OPEN or updating closed tickets
    if (status === "OPEN") {
      return res.status(400).json({
        status: false,
        message: "You cannot change a ticket back to OPEN",
      });
    }

    if (currentStatus === "CLOSED") {
      return res.status(400).json({
        status: false,
        message: "Cannot update a ticket that is already CLOSED",
      });
    }

    // Update the ticket status (include resolved info)
    await pool.query(
      `UPDATE tickets 
       SET status = ?, 
           resolved_response = ?, 
           resolved_date = NOW(), 
           resolved_by = ?
       WHERE ticket_id = ?`,
      [status, resolved_response || null, email_address, ticket_id]
    );

    // Log the action
    await logAction({
      user_id,
      action: "UPDATE_TICKET_STATUS",
      log_message: `Ticket (${ticket_id}) status changed from ${currentStatus} → ${status} by ${email_address}${
        resolved_response ? ` | Response: ${resolved_response}` : ""
      }`,
      status: "SUCCESS",
      action_by: email_address,
    });

    return res.status(200).json({
      status: true,
      message: `Ticket status updated to ${status} successfully`,
      data: {
        ticket_id,
        new_status: status,
        resolved_by: email_address,
        resolved_response: resolved_response || null,
      },
    });
  } catch (err) {
    console.error("Error updating ticket status:", err);
    return res.status(500).json({
      status: false,
      message: "Server error while updating ticket status",
    });
  }
};
