const express = require('express');
const router = express.Router();
const { twofa_sendEmailOtp, twofa_verifyEmailOtp, disable_twofa } = require('../controllers/2faController');
const auth = require("../middleware/userAuth");

router.post('/add_email', auth, twofa_sendEmailOtp);
router.post('/verify_email', auth, twofa_verifyEmailOtp);
router.post('/disable', auth, disable_twofa);

module.exports = router;