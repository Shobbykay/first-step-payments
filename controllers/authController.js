const { v4: uuidv4 } = require('uuid');
const mysql = require('mysql2/promise');
const pool = require('../services/db');
const validator = require('validator');


//Create Account (first segment)
exports.create_account_first = async (req, res) => {
    if (!req.body) {
        return res.status(400).json({
            status: "error",
            message: 'Request body is missing or invalid JSON'
        });
    }

    const { account_type, phone_number } = req.body;

    // Validate account_type
    const validTypes = ['USER', 'AGENT'];
    if (!validTypes.includes(account_type)) {
        return res.status(400).json({
            status: "error",
            message: 'Invalid account type submitted' 
        });
    }

    // Validate phone_number length and numeric
    if (!phone_number || phone_number.length !== 11 || /^\d{10}$/.test(phone_number)) {
        return res.status(400).json({ 
            status: "error",
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
                status: "error",
                message: 'Phone number already exists' 
            });
        }

        // Generate UUID and insert
        const id = uuidv4();
        await pool.query(
        'INSERT INTO users_account (user_id, phone_number, account_type) VALUES (?, ?, ?)',
        [id, phone_number, account_type]
        );


        //generate otp
        const otp = Math.floor(100000 + Math.random() * 900000);
        await pool.query(
            'INSERT INTO users_otp (phone_number, otp) VALUES (?, ?)',
            [phone_number, otp]
        );


        res.status(201).json({
            status: "success",
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





exports.verifyOtp = async (req, res) => {
    const { phone_number, otp } = req.body;
  
    if (!phone_number || !otp) {
      return res.status(400).json({ success: "error", message: 'phone_number and otp are required' });
    }
  
    try {
      // Check if OTP exists
      const [otpResult] = await pool.query(
        'SELECT * FROM users_otp WHERE phone_number = ? AND otp = ? LIMIT 1',
        [phone_number, otp]
      );
  
      if (otpResult.length === 0) {
        return res.status(404).json({ success: "error", message: 'Invalid or expired OTP' });
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
  
      return res.status(200).json({ success: "success", message: 'OTP verified and account activated' });
    } catch (err) {
      console.error('Error verifying OTP:', err);
      return res.status(500).json({ success: "error", message: 'Server error' });
    }
};





exports.updateUserProfile = async (req, res) => {
    const {
      phone_number,
      first_name,
      last_name,
      email_address,
      date_of_birth,
      business_name,
      business_address,
      password
    } = req.body;
  
    if (!phone_number) {
      return res.status(400).json({ success: false, message: 'phone_number is required' });
    }
  
    try {
      // 1. Get account_type and status
      const [userResult] = await pool.query(
        'SELECT account_type, status FROM users_account WHERE phone_number = ? LIMIT 1',
        [phone_number]
      );
  
      if (userResult.length === 0) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }
  
      const { account_type, status } = userResult[0];
  
      // 2. Validate account status
      if (status === 0) {
        return res.status(403).json({ success: false, message: 'Verify account first before profile update' });
      } else if (status !== 1) {
        return res.status(403).json({ success: false, message: 'Unable to update account, contact administrator' });
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
          success: false,
          message:
            'Password must be at least 8 characters long and include uppercase, lowercase, number, and symbol.',
        });
      }
  
      let updateQuery = '';
      let updateParams = [];
  
      // 4. Validate fields and prepare update
      if (account_type === 'USER') {
        if (!first_name || !last_name || !email_address || !date_of_birth || !password) {
          return res.status(400).json({ success: false, message: 'Missing required USER fields' });
        }

        // ✅ Validate date_of_birth format: YYYY-MM-DD
        const dobPattern = /^\d{4}-\d{2}-\d{2}$/;
        if (!dobPattern.test(date_of_birth) || !validator.isDate(date_of_birth, { format: 'YYYY-MM-DD', strictMode: true })) {
            return res.status(400).json({ success: false, message: 'date_of_birth must be in format YYYY-MM-DD' });
        }
  
        updateQuery = `
          UPDATE users_account
          SET first_name = ?, last_name = ?, email_address = ?, dob = ?, password = ?
          WHERE phone_number = ?
        `;
        updateParams = [first_name, last_name, email_address, date_of_birth, password, phone_number];
  
      } else if (account_type === 'AGENT') {
        if (!first_name || !email_address || !business_name || !business_address || !password) {
          return res.status(400).json({ success: false, message: 'Missing required AGENT fields' });
        }
  
        updateQuery = `
          UPDATE users_account
          SET first_name = ?, email_address = ?, business_name = ?, business_address = ?, password = ?
          WHERE phone_number = ?
        `;
        updateParams = [first_name, email_address, business_name, business_address, password, phone_number];
  
      } else {
        return res.status(400).json({ success: false, message: 'Unknown account type' });
      }
  
      // 5. Execute update
      await pool.query(updateQuery, updateParams);
  
      return res.status(200).json({ success: true, message: 'Profile updated successfully' });
    } catch (err) {
      console.error('Error updating user profile:', err);
      return res.status(500).json({ success: false, message: 'Server error' });
    }
};