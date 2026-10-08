const router = require('express').Router();
const controller = require('../controllers/cashExpenseController');
router.get('/cash-expenses', require('../controllers/retiredList').retiredList);
router.post('/cash-expenses/:category', controller.save);
router.patch('/cash-expenses/:category/:id', controller.save);
module.exports = router;
