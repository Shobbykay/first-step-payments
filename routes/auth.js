const express = require('express');
const router = express.Router();
const { create_account_first, login, verifyOtp, listOtps, updateUserProfile, updateUserDetails, resetPasswordRequest, changePassword } = require('../controllers/authController');

// {BASE_URL}/api/v1/auth/

router.post('/sign_first', create_account_first);
router.post('/verify_otp', verifyOtp);
router.get('/list_otps', listOtps);
router.post('/update_profile', updateUserProfile);
router.post('/update_profile', updateUserDetails);
router.post('/login', login);
router.post('/reset', resetPasswordRequest);
router.post('/password', changePassword);

module.exports = router;