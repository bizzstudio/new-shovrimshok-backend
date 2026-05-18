// routes/deliveryRoutes.js
const express = require('express');
const router = express.Router();
const deliveryController = require('../controller/deliveryController');
const { isAdmin } = require('../config/auth');

router.post('/', isAdmin, deliveryController.createDelivery);
router.get('/', deliveryController.getAllDeliveries);
router.get('/getbycity/:city', deliveryController.getDeliveryByCity);
router.get('/:id', deliveryController.getDelivery);
router.put('/:id', isAdmin, deliveryController.updateDelivery);
router.delete('/:id', isAdmin, deliveryController.deleteDelivery);
//delete many product
router.patch('/delete/many', isAdmin, deliveryController.deleteManyDelivery);

module.exports = router;