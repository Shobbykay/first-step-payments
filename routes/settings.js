const express = require('express');
const router = express.Router();
const { retrieveSecurityQuestion, validateSecurityQuestion, updateTransactionPin, closeAccount } = require('../controllers/SettingsController');
const auth = require("../middleware/userAuth");

router.get('/security_question', auth, retrieveSecurityQuestion);
router.post('/security_question/validate', auth, validateSecurityQuestion);
router.post('/transaction_pin/update', auth, updateTransactionPin);
router.post('/close_account', auth, closeAccount);

module.exports = router;