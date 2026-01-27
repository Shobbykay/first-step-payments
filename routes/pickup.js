const express = require('express');
const router = express.Router();
const { searchAgent, getRecipientByPhone, sendAgentCashForCashPickup, CashPickupRegUser } = require('../controllers/pickUpController');
const auth = require("../middleware/userAuth");

router.post('/search_agent', auth, searchAgent);
router.post('/search_recipient', auth, getRecipientByPhone);
// router.get('/retrieve', auth, retrieve_notifications);
// router.get('/get', auth, get_user_notifications);
router.post('/send_agent_cash', auth, sendAgentCashForCashPickup);
router.post('/cash_pickup', auth, CashPickupRegUser);

module.exports = router;