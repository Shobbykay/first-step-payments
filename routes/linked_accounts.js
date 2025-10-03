const express = require('express');
const router = express.Router();
const { add_account, fetch_user_accounts, remove_user_accounts, fetchBankList, validateBankAccount } = require('../controllers/linkedAccountController');
const auth = require("../middleware/userAuth");

router.post('/add', auth, add_account);
router.get('/fetch', auth, fetch_user_accounts);
router.get('/banks', auth, fetchBankList);
router.post('/validate/bank_account', auth, validateBankAccount);
router.delete('/unlink', auth, remove_user_accounts);

module.exports = router;