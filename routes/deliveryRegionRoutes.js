// routes/deliveryRegionRoutes.js
const express = require('express');
const router = express.Router();
const deliveryRegionController = require('../controller/deliveryRegionController');
const { isAdmin } = require('../config/auth');

router.get('/', deliveryRegionController.getAllRegions);
router.get('/:regionId/deliveries', deliveryRegionController.getDeliveriesByRegion);
router.put('/:regionId/price-rules', isAdmin, deliveryRegionController.updatePriceRules);
router.get('/:id', deliveryRegionController.getRegionById);
router.post('/', isAdmin, deliveryRegionController.createRegion);
router.put('/:id', isAdmin, deliveryRegionController.updateRegion);
router.delete('/:id', isAdmin, deliveryRegionController.deleteRegion);

module.exports = router;
