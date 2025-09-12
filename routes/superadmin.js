const express = require('express');
const router = express.Router();
const { login, forgot, reset, confirmResetToken } = require('../controllers/superadmin/loginController');
const { fetchAllCustomers } = require('../controllers/superadmin/customerController');
const auth = require("../middleware/auth");

//auth
router.post('/auth/login', login);
router.post('/auth/forgot', forgot);
router.post('/auth/confirm_reset_token', confirmResetToken);
router.post('/auth/reset', reset);


//customer
router.get('/customer/all', auth, fetchAllCustomers);

module.exports = router;