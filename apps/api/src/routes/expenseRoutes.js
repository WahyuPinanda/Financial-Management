const express = require('express');
const expenseController = require('../controllers/expenseController');

const router = express.Router();
router.post('/harvests/:harvestId/expenses', expenseController.createExpense);
router.patch('/expenses/:expenseId', expenseController.updateExpense);

module.exports = router;
