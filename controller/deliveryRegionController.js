// controller/deliveryRegionController.js – CRUD אזורי משלוח + כללי תמחור
const Region = require('../models/Region');
const Delivery = require('../models/Delivery');

// מיגרציה: תמיד מחזיקים סקשן אמיתי "כל הארץ" – יוצר אם לא קיים, ומשייך אליו את כל היעדים בלי אזור
const ensureDefaultRegion = async () => {
  let allCountry = await Region.findOne({ name: 'כל הארץ' });
  if (!allCountry) {
    allCountry = await Region.create({ name: 'כל הארץ', order: 0 });
    console.log('Delivery regions: created region "כל הארץ"');
  }
  const updated = await Delivery.updateMany(
    { $or: [{ region: null }, { region: { $exists: false } }] },
    { $set: { region: allCountry._id } }
  );
  if (updated.modifiedCount > 0) {
    console.log('Delivery regions: assigned', updated.modifiedCount, 'deliveries to "כל הארץ"');
  }
  return allCountry;
};

// רשימת כל האזורים עם יעדים (לאדמין)
const getAllRegions = async (req, res) => {
  try {
    await ensureDefaultRegion();
    const regions = await Region.find()
      .sort({ order: 1, name: 1 })
      .lean();
    const deliveryIdsByRegion = await Delivery.aggregate([
      { $match: { region: { $exists: true, $ne: null } } },
      { $group: { _id: '$region', ids: { $push: '$_id' } } },
    ]);
    const map = new Map(deliveryIdsByRegion.map((g) => [g._id.toString(), g.ids]));
    const allDeliveryIds = deliveryIdsByRegion.flatMap((g) => g.ids);
    const deliveries = allDeliveryIds.length
      ? await Delivery.find({ _id: { $in: allDeliveryIds } }).lean()
      : [];
    const deliveriesById = new Map(deliveries.map((d) => [d._id.toString(), d]));
    const regionsWithDeliveries = regions.map((r) => {
      const ids = map.get(r._id.toString()) || [];
      return {
        ...r,
        deliveries: ids.map((id) => deliveriesById.get(id.toString())).filter(Boolean),
      };
    });
    res.json({ regions: regionsWithDeliveries });
  } catch (err) {
    console.log('getAllRegions error: ', err);
    res.status(500).json({ message: err.message });
  }
};

// אזור בודד עם יעדים
const getRegionById = async (req, res) => {
  try {
    const region = await Region.findById(req.params.id).lean();
    if (!region) return res.status(404).json({ message: 'Region not found' });
    const deliveries = await Delivery.find({ region: req.params.id }).lean();
    res.json({ ...region, deliveries });
  } catch (err) {
    console.log('getRegionById error: ', err);
    res.status(500).json({ message: err.message });
  }
};

// יצירת אזור
const createRegion = async (req, res) => {
  try {
    const { name, order } = req.body;
    const newRegion = await Region.create({ name: name || '', order: order != null ? Number(order) : 0 });
    res.status(201).json(newRegion);
  } catch (err) {
    console.log('createRegion error: ', err);
    res.status(400).json({ message: err.message });
  }
};

// עדכון אזור (שם, סדר)
const updateRegion = async (req, res) => {
  try {
    const { name, order } = req.body;
    const region = await Region.findById(req.params.id);
    if (!region) return res.status(404).json({ message: 'Region not found' });
    if (name !== undefined) region.name = name;
    if (order !== undefined) region.order = Number(order);
    await region.save();
    res.json(region);
  } catch (err) {
    console.log('updateRegion error: ', err);
    res.status(400).json({ message: err.message });
  }
};

// מחיקת אזור – לא מוחק יעדים; מנתק אותם מהאזור (משאיר region: null)
const deleteRegion = async (req, res) => {
  try {
    const region = await Region.findById(req.params.id);
    if (!region) return res.status(404).json({ message: 'Region not found' });
    await Delivery.updateMany({ region: req.params.id }, { $unset: { region: 1 } });
    await region.deleteOne();
    res.json({ message: 'Region deleted' });
  } catch (err) {
    console.log('deleteRegion error: ', err);
    res.status(500).json({ message: err.message });
  }
};

// עדכון כללי תמחור – ממוין יורד לפי minOrderTotal
const updatePriceRules = async (req, res) => {
  try {
    const { priceRules } = req.body;
    if (!Array.isArray(priceRules)) {
      return res.status(400).json({ message: 'priceRules must be an array' });
    }
    const region = await Region.findById(req.params.regionId);
    if (!region) return res.status(404).json({ message: 'Region not found' });
    const sorted = priceRules
      .map((r) => {
        const minOrderTotal = Number(r.minOrderTotal) || 0;
        const shippingCost = Number(r.shippingCost) || 0;
        const hasMax = r.maxOrderTotal != null && r.maxOrderTotal !== '';
        const rule = { minOrderTotal, shippingCost };
        if (hasMax) rule.maxOrderTotal = Number(r.maxOrderTotal);
        return rule;
      })
      .sort((a, b) => b.minOrderTotal - a.minOrderTotal);
    region.priceRules = sorted;
    await region.save();
    res.json(region);
  } catch (err) {
    console.log('updatePriceRules error: ', err);
    res.status(400).json({ message: err.message });
  }
};

// יעדים לפי אזור (אופציונלי)
const getDeliveriesByRegion = async (req, res) => {
  try {
    const deliveries = await Delivery.find({ region: req.params.regionId }).sort({ createdAt: -1 });
    res.json(deliveries);
  } catch (err) {
    console.log('getDeliveriesByRegion error: ', err);
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  getAllRegions,
  getRegionById,
  createRegion,
  updateRegion,
  deleteRegion,
  updatePriceRules,
  getDeliveriesByRegion,
};
