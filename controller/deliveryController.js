const Delivery = require('../models/Delivery');
const Region = require('../models/Region');
const { getShippingCostByRegionRules, getShippingCostByRegionRulesWithDebug } = require('../utils/shippingUtils');

// יצירת יעד משלוח חדש – regionId חובה (או region)
const createDelivery = async (req, res) => {
  const { city, price, days, regionId, region } = req.body;
  const regionObjectId = regionId || region;

  try {
    if (!regionObjectId) {
      return res.status(400).json({ message: 'regionId is required' });
    }
    const regionExists = await Region.findById(regionObjectId);
    if (!regionExists) {
      return res.status(400).json({ message: 'Region not found' });
    }
    const newDelivery = await Delivery.create({
      city,
      price: price != null ? Number(price) : 0,
      days: days || [],
      region: regionObjectId,
    });
    res.status(201).json(newDelivery);
  } catch (err) {
    console.log('createDelivery error: ', err);
    res.status(400).json({ message: err.message });
  }
};

// קריאת כל יעדי המשלוח
const getAllDeliveries = async (req, res) => {
  try {
    const deliveries = await Delivery.find().sort({ createdAt: -1 });
    res.json(deliveries);
  } catch (err) {
    console.log('getAllDeliveries error: ', err);
    res.status(500).json({ message: err.message });
  }
};

// קריאת יעד משלוח מסוים
const getDelivery = async (req, res) => {
  try {
    const delivery = await Delivery.findById(req.params.id).populate('region');
    if (!delivery) {
      return res.status(404).json({ message: 'Delivery not found' });
    }
    res.json(delivery);
  } catch (err) {
    console.log('getDelivery error: ', err);
    res.status(500).json({ message: err.message });
  }
};

// בדיקה אם יעד משלוח קיים על פי עיר.
// query orderTotal: סכום הזמנה אחרי הנחות – מחשב דמי משלוח לפי כללי האזור. תמיד מחזירים shippingCost בתשובה.
const getDeliveryByCity = async (req, res) => {
  try {
    const rawTotal = req.query.orderTotal;
    const orderTotal = rawTotal != null && rawTotal !== '' && !Number.isNaN(Number(rawTotal)) && Number(rawTotal) >= 0
      ? Number(rawTotal)
      : 0;
    let cityName = (req.params.city || '').trim();
    if (decodeURIComponent(cityName) !== cityName) {
      cityName = decodeURIComponent(cityName).trim();
    }
    if (!cityName) {
      return res.status(400).json({ message: 'City is required' });
    }
    let delivery = await Delivery.findOne({ 'city.city_name_he': cityName }).populate('region');
    if (!delivery) {
      delivery = await Delivery.findOne({
        $expr: { $eq: [{ $trim: { input: { $ifNull: ['$city.city_name_he', ''] } } }, cityName] },
      }).populate('region');
    }
    if (!delivery) {
      const normalized = cityName.replace(/\s+/g, ' ').trim();
      if (normalized !== cityName) {
        delivery = await Delivery.findOne({ 'city.city_name_he': normalized }).populate('region');
      }
    }
    if (!delivery) {
      return res.status(404).json({ message: 'Delivery not found' });
    }
    const payload = delivery.toObject ? delivery.toObject() : { ...delivery };
    const wantDebug = process.env.NODE_ENV !== 'production' || req.query.debug === '1' || req.query.debug === 'true';
    const result = wantDebug ? getShippingCostByRegionRulesWithDebug(delivery, orderTotal) : getShippingCostByRegionRules(delivery, orderTotal);
    const computed = typeof result === 'number' ? result : result.cost;
    payload.shippingCost = computed;
    if (wantDebug && typeof result === 'object' && result.debug) payload._debug = result.debug;
    res.set('X-Order-Total-Received', String(orderTotal));
    res.set('X-Shipping-Cost', String(computed));
    res.json(payload);
  } catch (err) {
    console.log('getDeliveryByCity error: ', err);
    res.status(500).json({ message: err.message });
  }
};

// עדכון יעד משלוח מסוים
const updateDelivery = async (req, res) => {
  try {
    const { city, price, days, regionId, region } = req.body;
    const delivery = await Delivery.findById(req.params.id);
    if (!delivery) {
      return res.status(404).json({ message: 'Delivery not found' });
    }
    if (city) delivery.city = city;
    if (price !== undefined) delivery.price = Number(price);
    if (days) delivery.days = days;
    const regionObjectId = regionId || region;
    if (regionObjectId) delivery.region = regionObjectId;
    const updatedDelivery = await delivery.save();
    res.json(updatedDelivery);
  } catch (err) {
    console.log('updateDelivery error: ', err);
    res.status(400).json({ message: err.message });
  }
};

// מחיקת יעד משלוח מסוים
const deleteDelivery = async (req, res) => {
  try {
    const delivery = await Delivery.findById(req.params.id);
    if (!delivery) {
      return res.status(404).json({ message: 'Delivery not found' });
    }
    await delivery.deleteOne();
    res.json({ message: 'Delivery deleted' });
  } catch (err) {
    console.log('deleteDelivery error: ', err);
    res.status(500).json({ message: err.message });
  }
};

// מחיקת כמה יעדים
const deleteManyDelivery = async (req, res) => {
  try {
    await Delivery.deleteMany({ _id: req.body.ids });
    res.send({
      message: `Delivery Delete Successfully!`,
    });
  } catch (err) {
    console.log('deleteManyDelivery error: ', err);
    res.status(500).send({
      message: err.message,
    });
  }
};

module.exports = {
  createDelivery,
  getAllDeliveries,
  getDelivery,
  getDeliveryByCity,
  updateDelivery,
  deleteDelivery,
  deleteManyDelivery,
};
