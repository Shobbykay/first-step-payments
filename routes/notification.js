const express = require('express');
const router = express.Router();
const { notifications_settings, retrieve_notifications, register_token, get_user_notifications } = require('../controllers/notificationController');
const auth = require("../middleware/userAuth");

router.post('/settings', auth, notifications_settings);
router.get('/retrieve', auth, retrieve_notifications);
router.get('/get', auth, get_user_notifications);
router.post('/register_token', auth, register_token);

module.exports = router;