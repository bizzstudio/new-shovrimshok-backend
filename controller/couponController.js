const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
dayjs.extend(utc);

// const { mongo_connection } = require('../config/db'); // CCDev
const Coupon = require("../models/Coupon");

const addCoupon = async (req, res) => {
  try {
    const newCoupon = new Coupon(req.body);
    await newCoupon.save();
    res.send({ message: "Coupon Added Successfully!" });
  } catch (err) {
    console.log('addCoupon error: ', err);
    res.status(500).send({ message: err.message });
  }
};

const addAllCoupon = async (req, res) => {
  try {
    await Coupon.deleteMany();
    await Coupon.insertMany(req.body);
    res.status(200).send({
      message: "Coupon Added successfully!",
    });
  } catch (err) {
    console.log('addAllCoupon error: ', err);
    res.status(500).send({
      message: err.message,
    });
  }
};

const getAllCoupons = async (req, res) => {
  // console.log('coupe')
  try {
    const queryObject = {};
    const { status } = req.query;

    if (status) {
      queryObject.status = { $regex: `${status}`, $options: "i" };
    }
    const coupons = await Coupon.find(queryObject).sort({ _id: -1 });
    // console.log('coups',coupons)
    res.send(coupons);
  } catch (err) {
    console.log('getAllCoupons error: ', err);
    res.status(500).send({
      message: err.message,
    });
  }
};

const getShowingCoupons = async (req, res) => {
  try {
    const coupons = await Coupon.find({
      status: "show",
    }).sort({ _id: -1 });
    res.send(coupons);
  } catch (err) {
    console.log('getShowingCoupons error: ', err);
    res.status(500).send({
      message: err.message,
    });
  }
};

const getCouponById = async (req, res) => {
  try {
    const coupon = await Coupon.findById(req.params.id);
    res.send(coupon);
  } catch (err) {
    console.log('getCouponById error: ', err);
    res.status(500).send({
      message: err.message,
    });
  }
};

const updateCoupon = async (req, res) => {
  try {
    const coupon = await Coupon.findById(req.params.id);

    if (coupon) {
      coupon.title = { ...coupon.title, ...req.body.title };
      coupon.couponCode = req.body.couponCode;
      coupon.endTime = dayjs().utc().format(req.body.endTime);
      // coupon.discountPercentage = req.body.discountPercentage;
      coupon.minimumAmount = req.body.minimumAmount;
      coupon.productType = req.body.productType;
      coupon.discountType = req.body.discountType;
      coupon.logo = req.body.logo;

      await coupon.save();
      res.send({ message: "Coupon Updated Successfully!" });
    }
  } catch (err) {
    console.log('updateCoupon error: ', err);
    res.status(404).send({ message: "Coupon not found!" });
  }
};

const updateManyCoupons = async (req, res) => {
  try {
    await Coupon.updateMany(
      { _id: { $in: req.body.ids } },
      {
        $set: {
          status: req.body.status,
          startTime: req.body.startTime,
          endTime: req.body.endTime,
        },
      },
      {
        multi: true,
      }
    );

    res.send({
      message: "Coupons update successfully!",
    });
  } catch (err) {
    console.log('updateManyCoupons error: ', err);
    res.status(500).send({
      message: err.message,
    });
  }
};

const updateStatus = async (req, res) => {
  try {
    const newStatus = req.body.status;

    await Coupon.updateOne(
      { _id: req.params.id },
      {
        $set: {
          status: newStatus,
        },
      }
    );
    res.status(200).send({
      message: `Coupon ${newStatus === "show" ? "Published" : "Un-Published"
        } Successfully!`,
    });
  } catch (err) {
    console.log('updateStatus error: ', err);
    res.status(500).send({
      message: err.message,
    });
  }
};

const deleteCoupon = async (req, res) => {
  try {
    await Coupon.deleteOne({ _id: req.params.id });
    res.status(200).send({
      message: "Coupon Deleted Successfully!",
    });
  } catch (err) {
    console.log('deleteCoupon error: ', err);
    res.status(500).send({ message: err.message });
  }
};

const deleteManyCoupons = async (req, res) => {
  try {
    await Coupon.deleteMany({ _id: req.body.ids });
    res.send({
      message: `Coupons Delete Successfully!`,
    });
  } catch (err) {
    console.log('deleteManyCoupons error: ', err);
    res.status(500).send({
      message: err.message,
    });
  }
};

const useCoupon = async (req, res) => {
  try {
    const { couponCode } = req.params;
    const currentTime = dayjs().utc().toDate();

    const coupon = await Coupon.findOne({ couponCode });

    if (!coupon) {
      return res.status(404).send({ message: "קופון לא נמצא!" });
    }

    if (coupon.isUsed) {
      return res.status(400).send({ message: "הקופון כבר שומש ואינו ניתן לשימוש חוזר!" });
    }

    if (coupon.startTime && currentTime < coupon.startTime) {
      return res.status(400).send({ message: "קופון עדיין לא בתוקף!" });
    }

    if (coupon.endTime && currentTime > coupon.endTime) {
      return res.status(400).send({ message: "קופון פג תוקף!" });
    }

    if (coupon.status == 'hide') {
      return res.status(400).send({ message: "קופון לא פעיל!" });
    }
    res.status(200).send({
      data: {
        couponCode: coupon.couponCode,
        discountType: coupon.discountType,
        _id: coupon._id,
      },
      message: "הקופון הוחל בהצלחה!"
    });
  } catch (err) {
    console.log('useCoupon error: ', err);
    res.status(500).send({ message: "שגיאה פנימית בשרת, נסה שוב מאוחר יותר." });
  }
};

module.exports = {
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
};
