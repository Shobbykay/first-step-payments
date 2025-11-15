const express = require('express');
const router = express.Router();
const { create_account_first, login, verifyOtp, resendOtp, refreshToken, listOtps, updateUserProfile, updateUserDetails, resetPasswordRequest, changePassword, changePassword_signedin } = require('../controllers/authController');
const auth = require("../middleware/userAuth");

// {BASE_URL}/api/v1/auth/

router.post('/sign_first', create_account_first);
router.post('/verify_otp', verifyOtp);
router.get('/resend_otp', resendOtp);
router.get('/list_otps', listOtps);
router.post('/refresh', refreshToken);
router.post('/update_profile', updateUserProfile);
// router.post('/update_profile', updateUserDetails);
router.post('/login', login);
router.post('/reset', resetPasswordRequest);
router.post('/password', changePassword);

//protected (signed in)
router.post('/change_password', auth, changePassword_signedin);

module.exports = router;