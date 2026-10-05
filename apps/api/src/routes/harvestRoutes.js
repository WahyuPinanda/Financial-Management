const express = require('express');
const harvestController = require('../controllers/harvestController');
const { checkAuth } = require('../middlewares/authMiddleware');

const router = express.Router();
router.use(checkAuth);
router.get('/harvests', harvestController.listHarvests);
router.post('/harvests', harvestController.createHarvest);
router.post('/harvests/:harvestId/spks', harvestController.createSpk);
router.patch('/spks/:spkId', harvestController.updateSpk);

module.exports = router;
