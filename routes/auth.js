const express = require('express');
const router = express.Router();
const { create_account_first, verifyOtp, updateUserProfile } = require('../controllers/authController');

router.post('/sign_first', create_account_first);
router.post('/verify_otp', verifyOtp);
router.post('/update_profile', updateUserProfile);

module.exports = router;