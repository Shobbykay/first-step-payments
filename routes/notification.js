const express = require('express');
const router = express.Router();
const { notifications_settings, retrieve_notifications } = require('../controllers/notificationController');
const auth = require("../middleware/userAuth");

router.post('/settings', auth, notifications_settings);
router.get('/retrieve', auth, retrieve_notifications);

module.exports = router;