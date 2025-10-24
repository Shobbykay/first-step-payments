const pool = require('../services/db');
const jwt = require("jsonwebtoken");
const { sendMail } = require("../utils/mailHelper");
const crypto = require('crypto');
const logAction = require("../utils/logger");


exports.listNearbyAgents = async (req, res) => {
  try {
    const { search = "", page = 1, limit = 10 } = req.body;
    const offset = (page - 1) * limit;

    let queryConditions = "";
    let queryParams = [];

    if (search.trim()) {
      // Split search string into words (e.g. "ikeja lagos" → ["ikeja", "lagos"])
      const words = search.trim().split(/\s+/);

      // Build dynamic OR conditions for all words
      const conditions = words
        .map(
          () =>
            `(a.business_name LIKE ? OR a.business_address LIKE ? OR a.location LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ?)`
        )
        .join(" OR ");

      queryConditions = `WHERE ${conditions}`;

      // Add parameters for each word
      words.forEach((word) => {
        const likeWord = `%${word}%`;
        queryParams.push(likeWord, likeWord, likeWord, likeWord, likeWord);
      });
    }

    // COUNT total agents that match search
    const [countResult] = await pool.query(
      `
      SELECT COUNT(*) AS total 
      FROM become_an_agent a
      INNER JOIN users_account u ON a.email_address = u.email_address
      ${queryConditions}
      `,
      queryParams
    );

    const total = countResult[0]?.total || 0;

    // FETCH paginated agents with join
    const [agents] = await pool.query(
      `
      SELECT 
        u.user_id,
        u.agent_id,
        u.first_name,
        u.last_name,
        u.email_address,
        u.profile_img,
        u.phone_number,
        a.business_name,
        a.business_address,
        a.location,
        a.business_hours,
        a.is_verified,
        "AVAILABLE" is_online
      FROM become_an_agent a
      INNER JOIN users_account u ON a.email_address = u.email_address
      ${queryConditions}
      ORDER BY RAND()
      LIMIT ? OFFSET ?
      `,
      [...queryParams, parseInt(limit), parseInt(offset)]
    );

    return res.status(200).json({
      status: true,
      message: "Agents fetched successfully",
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        total_pages: Math.ceil(total / limit),
      },
      data: agents,
    });
  } catch (err) {
    console.error("Error fetching agents:", err);
    return res.status(500).json({
      status: false,
      message: "Server error while fetching agents",
    });
  }
};





exports.getRandomAgents = async (req, res) => {
  try {
    // Fetch 10 random agents with joined user details
    const [agents] = await pool.query(
      `
      SELECT 
        u.user_id,
        u.agent_id,
        u.first_name,
        u.last_name,
        u.profile_img,
        u.phone_number,
        a.business_name,
        a.business_address,
        a.location,
        a.business_hours,
        a.is_verified,
        "AVAILABLE" is_online
      FROM become_an_agent a
      INNER JOIN users_account u 
        ON a.email_address = u.email_address
      ORDER BY RAND()
      LIMIT 10
      `
    );

    return res.status(200).json({
      status: true,
      message: "Random agents loaded successfully",
      data: agents,
    });
  } catch (err) {
    console.error("Error loading random agents:", err);
    return res.status(500).json({
      status: false,
      message: "Server error while loading random agents",
    });
  }
};







exports.listNearbyAgents_ = async (req, res) => {
  try {
    const { search = "", page = 1, limit = 10 } = req.body;

    const offset = (page - 1) * limit;

    // Count total agents that match the search
    const [countResult] = await pool.query(
      `SELECT COUNT(*) AS total 
       FROM become_an_agent
       WHERE 
         business_name LIKE CONCAT('%', ?, '%')
         OR business_address LIKE CONCAT('%', ?, '%')
         OR location LIKE CONCAT('%', ?, '%')`,
      [search, search, search]
    );

    const total = countResult[0]?.total || 0;

    // Fetch agents with pagination
    const [agents] = await pool.query(
      `SELECT 
          email_address,
          business_name,
          business_address,
          location,
          business_hours,
          business_license
       FROM become_an_agent
       WHERE 
          business_name LIKE CONCAT('%', ?, '%')
          OR business_address LIKE CONCAT('%', ?, '%')
          OR location LIKE CONCAT('%', ?, '%')
       ORDER BY RAND()
       LIMIT ? OFFSET ?`,
      [search, search, search, parseInt(limit), parseInt(offset)]
    );

    return res.status(200).json({
      status: true,
      message: "Agents fetched successfully",
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        total_pages: Math.ceil(total / limit),
      },
      data: agents,
    });
  } catch (err) {
    console.error("Error fetching agents:", err);
    return res.status(500).json({
      status: false,
      message: "Server error while fetching agents",
    });
  }
};
