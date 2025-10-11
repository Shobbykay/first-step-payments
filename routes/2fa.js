const express = require('express');
const router = express.Router();
const { twofa_sendEmailOtp, twofa_verifyEmailOtp } = require('../controllers/2faController');
const auth = require("../middleware/userAuth");

router.post('/add_email', auth, twofa_sendEmailOtp);
router.post('/verify_email', auth, twofa_verifyEmailOtp);

module.exports = router;