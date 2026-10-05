const { z } = require('zod');
const { harvestSchema, spkSchema } = require('@sawit/shared');
const harvestService = require('../services/harvestService');

const uuid = z.string().uuid('ID tidak valid.');

async function listHarvests(req, res, next) {
  try {
    const data = await harvestService.listHarvests(req.database);
    return res.json({ status: true, data, server_time: new Date().toISOString() });
  } catch (error) {
    return next(error);
  }
}

async function createHarvest(req, res, next) {
  try {
    const input = harvestSchema.parse(req.body);
    const data = await harvestService.createHarvest(req.database, input, req.user.id);
    return res.status(201).json({ status: true, data });
  } catch (error) {
    return next(error);
  }
}

async function createSpk(req, res, next) {
  try {
    const harvestId = uuid.parse(req.params.harvestId);
    const input = spkSchema.parse(req.body);
    const data = await harvestService.createSpk(req.database, harvestId, input, req.user.id);
    return res.status(201).json({ status: true, data });
  } catch (error) {
    return next(error);
  }
}

async function updateSpk(req, res, next) {
  try {
    const spkId = uuid.parse(req.params.spkId);
    const input = spkSchema.parse(req.body);
    const data = await harvestService.updateSpk(req.database, spkId, input);
    return res.json({ status: true, data });
  } catch (error) {
    return next(error);
  }
}

module.exports = { listHarvests, createHarvest, createSpk, updateSpk };
