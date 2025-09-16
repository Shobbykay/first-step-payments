const { v4: uuidv4 } = require('uuid');
const mysql = require('mysql2/promise');
const pool = require('../services/db');
const validator = require('validator');
const jwt = require("jsonwebtoken");
const { hashPassword, generateAgentId } = require("../utils/utilities");
const { sendMail } = require("../utils/mailHelper");
const bcrypt = require("bcrypt");


let refreshTokens = [];


//Create Account (first segment)
exports.create_account_first = async (req, res) => {
    if (!req.body) {
        return res.status(400).json({
            status: false,
            message: 'Request body is missing or invalid JSON'
        });
    }

    const { account_type, phone_number } = req.body;

    // Validate account_type
    const validTypes = ['USER', 'AGENT'];
    if (!validTypes.includes(account_type)) {
        return res.status(400).json({
            status: false,
            message: 'Invalid account type submitted' 
        });
    }

    // Validate phone_number length and numeric
    if (!phone_number || phone_number.length !== 11 || /^\d{10}$/.test(phone_number)) {
        return res.status(400).json({ 
            status: false,
            message: 'Phone number must be exactly 11 digits' + phone_number.length + !phone_number
        });
    }

    try {
        // Check if phone_number already exists
        const [existing] = await pool.query(
        'SELECT * FROM users_account WHERE phone_number = ?',
        [phone_number]
        );

        if (existing.length > 0) {
            return res.status(409).json({ 
                status: false,
                message: 'Phone number already exists' 
            });
        }


        // Generate UUID and insert
        const id = uuidv4();


        let query;
        let values;
        let agent_id = generateAgentId;
        if (account_type === "AGENT") {
            query = `
              INSERT INTO users_account (user_id, phone_number, account_type, agent_id) 
              VALUES (?, ?, ?, ?)
            `;
            values = [id, phone_number, account_type, agent_id];
        } else {
            query = `
              INSERT INTO users_account (user_id, phone_number, account_type) 
              VALUES (?, ?, ?)
            `;
            values = [id, phone_number, account_type];
        }

        //query
        await pool.query(query, values);


        //generate otp
        const otp = Math.floor(100000 + Math.random() * 900000);
        await pool.query(
            'INSERT INTO users_otp (phone_number, otp) VALUES (?, ?)',
            [phone_number, otp]
        );


        res.status(201).json({
            status: true,
            message: 'OTP sent to ' + phone_number + ' successfully',
            data: {
                id,
                phone_number,
                account_type
            }
        });
    } catch (err) {
        console.error('Account Creation Error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
  
};




// generates a token that will be used to update user profile
exports.verifyOtp = async (req, res) => {
    const { phone_number, otp } = req.body;
  
    if (!phone_number || !otp) {
      return res.status(400).json({ success: false, message: 'phone_number and otp are required' });
    }
  
    try {
      // Check if OTP exists
      const [otpResult] = await pool.query(
        'SELECT * FROM users_otp WHERE phone_number = ? AND otp = ? LIMIT 1',
        [phone_number, otp]
      );
  
      if (otpResult.length === 0) {
        return res.status(404).json({ success: false, message: 'Invalid or expired OTP' });
      }
  
      // Delete OTP entry
      await pool.query(
        'DELETE FROM users_otp WHERE phone_number = ? AND otp = ?',
        [phone_number, otp]
      );
  
      // Update user account status
      await pool.query(
        'UPDATE users_account SET status = 1 WHERE phone_number = ?',
        [phone_number]
      );

      // Get user details (for token payload)
      const [userResult] = await pool.query(
        'SELECT user_id, phone_number FROM users_account WHERE phone_number = ? LIMIT 1',
        [phone_number]
      );
  
      if (userResult.length === 0) {
        return res.status(404).json({ success: false, message: 'User not found after OTP verification' });
      }
  
      const user = userResult[0];
  
      // Generate JWT token
      const token = jwt.sign(
        { user_id: user.id, phone_number: user.phone_number },
        process.env.JWT_SECRET || "your_jwt_secret",
        { expiresIn: "7d" } // token validity (7 days)
      );
  
      // Return response with token
      return res.status(200).json({
        status: true,
        message: 'OTP verified and account activated',
        token,
        data: {
          id: user.user_id,
          phone_number: user.phone_number
        }
      });
    } catch (err) {
      console.error('Error verifying OTP:', err);
      return res.status(500).json({ status: false, message: 'Server error' });
    }
};





// generates and resends a new OTP
exports.resendOtp = async (req, res) => {
  const { phone_number } = req.body;

  if (!phone_number) {
    return res
      .status(400)
      .json({ status: false, message: "phone_number is required" });
  }

  try {
    // 1. Check if phone_number exists in users_account
    const [userResult] = await pool.query(
      "SELECT user_id FROM users_account WHERE phone_number = ? LIMIT 1",
      [phone_number]
    );

    if (userResult.length === 0) {
      return res
        .status(404)
        .json({ status: false, message: "Phone number not registered" });
    }

    // 2. Generate new OTP (6-digit)
    const otp = Math.floor(100000 + Math.random() * 900000);

    // 3. Insert or update users_otp table
    await pool.query(
      `
      INSERT INTO users_otp (phone_number, otp) 
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE otp = VALUES(otp), date_created = NOW()
      `,
      [phone_number, otp]
    );

    // 4. Respond with success
    return res.status(200).json({
      status: true,
      message: "OTP generated successfully",
    });
  } catch (err) {
    console.error("Error generating OTP:", err);
    return res
      .status(500)
      .json({ status: false, message: "Server error while generating OTP" });
  }
};






// this is only for test
exports.listOtps = async (req, res) => {

  try {
    // Check if OTP exists
    const [otpResult] = await pool.query(
      'SELECT * FROM users_otp'
    );


    // Return response with token
    return res.status(200).json({
      status: true,
      message: 'Listed all Pending OTPs',
      data: otpResult
    });
  } catch (err) {
    console.error('Error listing OTP:', err);
    return res.status(500).json({ status: false, message: 'Server error' });
  }
};





exports.updateUserProfile = async (req, res) => {

  // validate JWT token
    const authHeader = req.headers["authorization"];
    console.log(process.env.JWT_SECRET, authHeader);
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ status: false, message: "Authorization token required" });
    }

    const token = authHeader.split(" ")[1];

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);//|| "your_jwt_secret" 
    } catch (err) {
      console.log(err);
      return res.status(401).json({ status: false, message: "Invalid or expired token"+err });
    }

    const {
      user_id,
      phone_number,
      first_name,
      last_name,
      email_address,
      date_of_birth,
      business_name,
      business_address,
      password,
      security_question,
      security_answer
    } = req.body;
  
    if (!phone_number) {
      return res.status(400).json({ status: false, message: 'phone_number is required' });
    }

    //  Ensure the token user_id matches the request user_id or phone_number
    if (decoded.user_id !== user_id && decoded.phone_number !== phone_number) {
      return res.status(403).json({ status: false, message: "You are not authorized to update this profile" });
    }
  
    try {
      // 1. Get account_type and status
      const [userResult] = await pool.query(
        'SELECT account_type, status FROM users_account WHERE phone_number = ? LIMIT 1',
        [phone_number]
      );
  
      if (userResult.length === 0) {
        return res.status(404).json({ status: false, message: 'User not found' });
      }
  
      const { account_type, status } = userResult[0];
  
      // 2. Validate account status
      if (status === 0) {
        return res.status(403).json({ status: false, message: 'Verify account first before profile update' });
      } else if (status !== 1) {
        return res.status(403).json({ status: false, message: 'Unable to update account, contact administrator' });
      }
  
      // 3. Validate password strength
      const isStrong = validator.isStrongPassword(password || '', {
        minLength: 8,
        minLowercase: 1,
        minUppercase: 1,
        minNumbers: 1,
        minSymbols: 1,
      });
  
      if (!isStrong) {
        return res.status(400).json({
          status: false,
          message:
            'Password must be at least 8 characters long and include uppercase, lowercase, number, and symbol.',
        });
      }
  
      let updateQuery = '';
      let updateParams = [];
      let hash_password = await hashPassword(password);
  
      // 4. Validate fields and prepare update
      if (account_type === 'USER') {
        if (!first_name || !last_name || !email_address || !date_of_birth || !password || !security_question || !security_answer) {
          return res.status(400).json({ success: false, message: 'Missing required USER fields' });
        }

        // Validate date_of_birth format: YYYY-MM-DD
        const dobPattern = /^\d{4}-\d{2}-\d{2}$/;
        if (!dobPattern.test(date_of_birth) || !validator.isDate(date_of_birth, { format: 'YYYY-MM-DD', strictMode: true })) {
            return res.status(400).json({ status: false, message: 'date_of_birth must be in format YYYY-MM-DD' });
        }
  
        updateQuery = `
          UPDATE users_account
          SET first_name = ?, last_name = ?, email_address = ?, dob = ?, password = ?, security_question = ?, security_answer = ?
          WHERE phone_number = ?
        `;
        updateParams = [first_name, last_name, email_address, date_of_birth, hash_password, security_question, security_answer, phone_number];
  
      } else if (account_type === 'AGENT') {
        if (!first_name || !email_address || !business_name || !business_address || !password || !security_question || !security_answer) {
          return res.status(400).json({ status: false, message: 'Missing required AGENT fields' });
        }
  
        updateQuery = `
          UPDATE users_account
          SET first_name = ?, email_address = ?, business_name = ?, business_address = ?, password = ?, security_question = ?, security_answer = ?
          WHERE phone_number = ?
        `;
        updateParams = [first_name, email_address, business_name, business_address, hash_password, security_question, security_answer, phone_number];
  
      } else {
        return res.status(400).json({ status: false, message: 'Unknown account type' });
      }
  
      // 5. Execute update
      await pool.query(updateQuery, updateParams);

      // Send notification email
      await sendMail(
        email_address,
        "FirstStep Payments Profile Update",
        `Hello <strong>${first_name}</strong>,<br><br>Your profile has been updated successfully.<br><br>If you did not perform this action, please contact support immediately.<br><br>Best regards,<br><strong>First Step Payments Team</strong>`
      );


      //status
      let status_ = ["UNVERIFIED", "VERIFIED", "DELETED", "SUSPENDED", "INCOMPLETE_DETAILS"];

      // fetch user data
      const [rows] = await pool.query(
        "SELECT user_id, account_type, agent_id, phone_number, status, first_name, last_name, email_address, dob, business_name, business_address, security_question, security_answer, date_created, date_updated FROM users_account WHERE phone_number = ?",
        [phone_number]
      );

      // map numeric status to text
      if (rows[0]) {
        // map status
        rows[0].status = status_[rows[0].status];

        // remove fields if account_type = USER
        if (rows[0].account_type === "USER") {
          const { agent_id, business_name, business_address, ...rest } = rows[0];
          rows[0] = rest;
        }
      }
  
      return res.status(200).json({ status: true, message: 'Profile updated successfully', data: rows[0] });
    } catch (err) {
      console.error('Error updating user profile:', err);
      return res.status(500).json({ status: false, message: 'Server error' });
    }
};






exports.updateUserDetails = async (req, res) => {
  const { user_id, first_name, last_name, email_address, dob, security_question, security_answer } = req.body;

  // 1. Validate input
  if (!user_id || !first_name || !last_name || !email_address || !dob || !security_question || !security_answer) {
    return res.status(400).json({
      success: false,
      message: 'All fields are required: user_id, first_name, last_name, email_address, dob, security_question, security_answer'
    });
  }

  try {
    // 2. Check if user_id exists in user_details
    const [existing] = await pool.query(
      'SELECT id FROM user_details WHERE user_id = ? LIMIT 1',
      [user_id]
    );

    if (existing.length === 0) {
      // 3. Insert new record
      await pool.query(
        `INSERT INTO user_details 
          (user_id, first_name, last_name, email_address, dob, security_question, security_answer)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [user_id, first_name, last_name, email_address, dob, security_question, security_answer]
      );

      return res.status(201).json({ success: true, message: 'User details inserted successfully' });
    } else {
      // 4. Update existing record
      await pool.query(
        `UPDATE user_details 
         SET first_name = ?, last_name = ?, email_address = ?, dob = ?, security_question = ?, security_answer = ?
         WHERE user_id = ?`,
        [first_name, last_name, email_address, dob, security_question, security_answer, user_id]
      );

      return res.status(200).json({ success: true, message: 'User details updated successfully' });
    }

  } catch (err) {
    console.error('Error upserting user details:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};





function formatDate(date) {
  const day = date.getDate();

  // Add "st", "nd", "rd", "th" suffix
  const suffix =
    day % 10 === 1 && day !== 11 ? "st" :
    day % 10 === 2 && day !== 12 ? "nd" :
    day % 10 === 3 && day !== 13 ? "rd" : "th";

  const month = date.toLocaleString("en-US", { month: "long" });
  const year = date.getFullYear();

  // Format time (e.g., 5:07 PM)
  const time = date.toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });

  return `${day}${suffix} of ${month}, ${year} at ${time}`;
}



function getFormattedNow() {
  const date = new Date(); // always "now"

  const day = date.getDate();

  // Add "st", "nd", "rd", "th" suffix
  const suffix =
    day % 10 === 1 && day !== 11 ? "st" :
    day % 10 === 2 && day !== 12 ? "nd" :
    day % 10 === 3 && day !== 13 ? "rd" : "th";

  const month = date.toLocaleString("en-US", { month: "long" });
  const year = date.getFullYear();

  // Format time (e.g., 5:07 PM)
  const time = date.toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });

  return `${day}${suffix} of ${month}, ${year} at ${time}`;
}





exports.login = async (req, res) => {
  const { phone_number, password } = req.body;

  if (!phone_number || !password) {
    return res.status(400).json({ status: false, message: "Phone number and password are required" });
  }

  try {
    // Find user
    const [rows] = await pool.query(
      "SELECT user_id, first_name, last_name, phone_number, dob, email_address, password, account_type, security_question, business_name, business_address, status, date_created, agent_id FROM users_account WHERE phone_number = ? LIMIT 1",
      [phone_number]
    );

    if (rows.length === 0) {
      return res.status(404).json({ status: false, message: "User not found" });
    }

    const user = rows[0];

    // Check account status
    if (user.status === 0) {
      return res.status(403).json({ status: false, message: "Account not verified" });
    }
    if (user.status !== 1) {
      return res.status(403).json({ status: false, message: "Account inactive, contact support" });
    }

    // Compare password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ status: false, message: "Invalid credentials" });
    }

    // Sign JWT token
    const token = jwt.sign(
      {
        user_id: user.user_id,
        phone_number: user.phone_number,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" } // adjust as needed
    );


    const now = getFormattedNow();
    const email_address = user.email_address;
    const first_name = user.first_name;

    // check if transaction pin is set
    const [rows_pin] = await pool.query(
      "SELECT * FROM transaction_pin WHERE user_id = ?",
      [user.user_id]
    );

    const is_transaction_pin_set = (rows_pin.length > 0) ? true : false;

    // Send notification email
    await sendMail(
      email_address,
      "FirstStep Payments Successful Login",
      `Dear <strong>${first_name}</strong>,<br><br>You have logged-in successfully to First Step Payments on ${now}.<br><br>If you did not perform this action, please contact support immediately on <a href="mailto:support@firststeppayments.com">support@firststeppayments.com</a>.<br><br>Best regards,<br><strong>First Step Payments Team</strong>`
    );


    //status
    let status_ = ["UNVERIFIED", "VERIFIED", "DELETED", "SUSPENDED", "INCOMPLETE_DETAILS"];

    let responseData = {
      user_id: user.user_id,
      first_name: user.first_name,
      last_name: user.last_name,
      phone_number: user.phone_number,
      email: user.email_address,
      date_of_birth: user.dob,
      account_type: user.account_type,
      security_question: user.security_question,
      is_transaction_pin_set,
      account_status: status_[user.status],
      account_created: user.date_created,
    };

    // Add business info if not USER
    if (user.account_type !== "USER") {
      responseData.agent_id = user.agent_id;
      responseData.business_name = user.business_name;
      responseData.business_address = user.business_address;
    }

    return res.status(200).json({
      status: true,
      message: "Login successful",
      token,
      data: responseData,
    });

  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ status: false, message: "Server error" });
  }
};





exports.resetPasswordRequest = async (req, res) => {
  const { phone_number } = req.body;

  if (!phone_number) {
    return res.status(400).json({ status: false, message: "Phone number is required" });
  }

  try {
    // Check if user exists
    const [users] = await pool.query(
      "SELECT user_id, phone_number FROM users_account WHERE phone_number = ? LIMIT 1",
      [phone_number]
    );

    if (users.length === 0) {
      return res.status(404).json({ status: false, message: "User not found" });
    }

    const { user_id, phone_number: dbPhone } = users[0];

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Insert or update reset_password table
    const [resetRecords] = await pool.query(
      "SELECT user_id FROM reset_password WHERE user_id = ? LIMIT 1",
      [user_id]
    );

    if (resetRecords.length > 0) {
      await pool.query(
        "UPDATE reset_password SET otp = ?, date_created = NOW() WHERE user_id = ?",
        [otp, user_id]
      );
    } else {
      await pool.query(
        "INSERT INTO reset_password (user_id, otp, date_created) VALUES (?, ?, NOW())",
        [user_id, otp]
      );
    }

    // Generate JWT token with user_id & phone_number
    const token = jwt.sign(
      { user_id, phone_number: dbPhone },
      process.env.JWT_SECRET,
      { expiresIn: "15m" } // short expiry for security
    );

    // 5. Return success
    return res.status(200).json({
      status: true,
      message: "OTP generated successfully. Use it to reset your password.",
      token, 
    });

  } catch (err) {
    console.error("Reset password error:", err);
    return res.status(500).json({ status: false, message: "Server error" });
  }
};




//for reset password
exports.changePassword = async (req, res) => {
  const { phone_number, password } = req.body;

  // Extract token from "Authorization: Bearer <token>"
  const authHeader = req.headers["authorization"];
  if (!authHeader) {
    return res.status(401).json({ status: false, message: "Authorization header missing" });
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({ status: false, message: "Invalid authorization format" });
  }

  try {
    // Decode & verify token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ status: false, message: "Invalid or expired token" });
    }

    if (decoded.phone_number !== phone_number) {
      return res.status(403).json({ status: false, message: "Phone number does not match token" });
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
    const hashedPassword = await hashPassword(password, 10);

    // Retrieve user_id from DB
    const [rows] = await pool.query(
      "SELECT user_id FROM users_account WHERE phone_number = ?",
      [phone_number]
    );

    if (rows.length === 0) {
      return res.status(404).json({ status: false, message: "User not found" });
    }

    const user_id = rows[0].user_id;

    // Update user password
    await pool.query("UPDATE users_account SET password = ? WHERE phone_number = ?", [
      hashedPassword,
      phone_number,
    ]);

    // Delete reset record
    await pool.query("DELETE FROM reset_password WHERE user_id = ?", [user_id]);

    return res.status(200).json({
      status: true,
      message: "Password changed successfully",
    });
  } catch (err) {
    console.error("Change password error:", err);
    return res.status(500).json({ status: false, message: "Server error" });
  }
};





//for within the app (signed in user)
exports.changePassword_signedin = async (req, res) => {
  const { old_password, new_password } = req.body;
  const { user_id } = req.user; // comes from auth middleware (decoded token)

  if (!old_password || !new_password) {
    return res.status(400).json({ status: false, message: "Both old and new passwords are required" });
  }

  try {
    // Fetch user by ID
    const [rows] = await pool.query(
      "SELECT password FROM users_account WHERE user_id = ? LIMIT 1",
      [user_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ status: false, message: "User not found" });
    }

    const hashedPassword = rows[0].password;

    // Compare old password
    const isMatch = await bcrypt.compare(old_password, hashedPassword);
    if (!isMatch) {
      return res.status(401).json({ status: false, message: "Old password is incorrect" });
    }

    // Hash new password
    const saltRounds = 10;
    const newHashedPassword = await bcrypt.hash(new_password, saltRounds);

    // Update DB
    await pool.query(
      "UPDATE users_account SET password = ?, date_updated = NOW() WHERE user_id = ?",
      [newHashedPassword, user_id]
    );

    return res.json({
      status: true,
      message: "Password updated successfully"
    });
  } catch (error) {
    console.error("Change password error:", error);
    return res.status(500).json({ status: false, message: "Database error" });
  }
};




exports.refreshToken = async (req, res) => {
  const { token } = req.body;

  if (!token) {// || !refreshTokens.includes(token)
    return res.status(403).json({ message: "Refresh token not valid" });
  }

  jwt.verify(token, process.env.JWT_SECRET || "your_jwt_secret", (err, user) => {
    if (err) return res.status(403).json({
        status: false,
        message: "Invalid refresh token" 
      });

    // create a new access token with the same payload
    const accessToken = jwt.sign(
      { user_id: user.user_id, phone_number: user.phone_number },
      process.env.JWT_SECRET || "your_jwt_secret",
      { expiresIn: "15m" }
    );

    // (optional) rotate refresh token for extra security
    const newRefreshToken = jwt.sign(
      { user_id: user.user_id, phone_number: user.phone_number },
      process.env.JWT_SECRET || "your_jwt_secret",
      { expiresIn: "7d" }
    );

    // replace old refresh token with the new one
    refreshTokens = refreshTokens.filter(t => t !== token);
    refreshTokens.push(newRefreshToken);

    res.json({ 
      status: true,
      accessToken, 
      refreshToken: newRefreshToken 
    });
  });
};
