const express = require('express');
const harvestController = require('../controllers/harvestController');

const router = express.Router();
router.get('/harvests', require('../controllers/retiredList').retiredList);
router.post('/harvests', harvestController.createHarvest);
router.post('/harvests/:harvestId/spks', harvestController.createSpk);
router.patch('/spks/:spkId', harvestController.updateSpk);

module.exports = router;
