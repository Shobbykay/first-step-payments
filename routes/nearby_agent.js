const express = require('express');
const router = express.Router();
const { listNearbyAgents, getRandomAgents } = require('../controllers/nearbyAgentController');
const auth = require("../middleware/userAuth");

router.post('/search', auth, listNearbyAgents);
router.get('/random', auth, getRandomAgents);

module.exports = router;