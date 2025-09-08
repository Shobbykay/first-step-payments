const express = require('express');
const router = express.Router();
const { createTransactionPin } = require('../controllers/dashboardController');

router.post('/create_pin', createTransactionPin);

module.exports = router;