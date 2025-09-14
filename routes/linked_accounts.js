const express = require('express');
const router = express.Router();
const { add_account, fetch_user_accounts, remove_user_accounts } = require('../controllers/linkedAccountController');
const auth = require("../middleware/userAuth");

router.post('/add', auth, add_account);
router.get('/fetch', auth, fetch_user_accounts);
router.delete('/unlink', auth, remove_user_accounts);

module.exports = router;