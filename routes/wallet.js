const express = require('express');
const router = express.Router();
const { refreshWalletBalance } = require('../controllers/WalletController');
const { sendMoneyToRecipient_W2W } = require('../controllers/FundController');
const auth = require("../middleware/userAuth");

router.get('/refresh', auth, refreshWalletBalance);
router.post('/to_wallet/transfer', auth, sendMoneyToRecipient_W2W);

module.exports = router;