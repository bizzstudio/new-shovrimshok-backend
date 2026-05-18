const express = require('express');
const router = express.Router();
const {
  addCoupon,
  addAllCoupon,
  getAllCoupons,
  getShowingCoupons,
  getCouponById,
  updateCoupon,
  updateStatus,
  deleteCoupon,
  updateManyCoupons,
  deleteManyCoupons,
  useCoupon,
} = require('../controller/couponController');
const { isAdmin } = require('../config/auth');

// use coupon
router.put('/use/:couponCode', useCoupon);

// add a coupon
router.post('/add', isAdmin, addCoupon);

// add multiple coupon
router.post('/add/all', isAdmin, addAllCoupon);

// get all coupon
router.get('/', isAdmin, getAllCoupons);

// get only enable coupon
router.get('/show', isAdmin, getShowingCoupons);

// get a coupon
router.get('/:id', isAdmin, getCouponById);

// update a coupon
router.put('/:id', isAdmin, updateCoupon);

// update many coupon
router.patch('/update/many', isAdmin, updateManyCoupons);

// show/hide a coupon
router.put('/status/:id', isAdmin, updateStatus);

// delete a coupon
router.delete('/:id', isAdmin, deleteCoupon);

// delete many coupon
router.patch('/delete/many', isAdmin, deleteManyCoupons);

module.exports = router;
