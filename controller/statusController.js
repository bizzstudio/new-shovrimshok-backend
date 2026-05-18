const Status = require("../models/Status");

const createStatus = async (req, res) => {
  try {
    const payload = { ...req.body };
    const isSystem = payload.isSystem === true || payload.isSystem === 'true';
    if (isSystem || payload.phone === undefined || payload.phone === null || payload.phone === '') {
      payload.phone = payload.phone || '';
    }
    const status = new Status(payload);
    await status.save();
    res.status(201).send({ data: status, message: "Status created successfully!" });
  } catch (err) {
    res.status(400).send(err);
  }
};

const getAllStatuses = async (req, res) => {
  try {
    const filter = req.query.getAll === 'true' ? {} : { isActive: true };
    const statuses = await Status.find(filter).sort({ isActive: -1 });
    res.send(statuses);
  } catch (err) {
    res.status(500).send(err);
  }
};

const getStatusById = async (req, res) => {
  try {
    const status = await Status.findById(req.params.id).select('+password');
    if (!status) {
      return res.status(404).send();
    }
    res.send(status);
  } catch (err) {
    res.status(500).send(err);
  }
};

const getStatusByName = async (req, res) => {
  try {
    const status = await Status.findOne({ name: req.params.name });
    if (!status) {
      return res.status(404).send();
    }
    res.send(status);
  } catch (err) {
    res.status(500).send(err);
  }
};

const updateStatus = async (req, res) => {
  try {
    const status = await Status.findById(req.params.id).select('+password');

    if (!status) {
      return res.status(404).send();
    }
    if (status.isSystem) {
      return res.status(403).send({ message: { he: "לא ניתן לערוך סטטוס מערכת", en: "Cannot edit system status" } });
    }

    status.name = req.body.name || status.name;
    status.heName = req.body.heName || status.heName;
    status.phone = req.body.phone || status.phone;
    status.color = req.body.color || status.color;
    status.isActive = req.body.isActive !== undefined ? req.body.isActive : status.isActive;
    status.password = req.body.password !== undefined ? req.body.password : status.password;
    await status.save();
    res.send({ data: status, message: "Status updated successfully!" });
  } catch (err) {
    res.status(400).send(err);
  }
};

const deleteStatus = async (req, res) => {
  try {
    const status = await Status.findById(req.params.id);
    if (!status) {
      return res.status(404).send();
    }
    if (status.isSystem) {
      return res.status(403).send({ message: { he: "לא ניתן למחוק סטטוס מערכת", en: "Cannot delete system status" } });
    }
    await Status.findByIdAndUpdate(
      req.params.id,
      { $set: { isActive: false } },
      { new: true }
    );

    res.status(200).send({
      message: "Status Updated to Inactive Successfully!",
    });
  } catch (err) {
    res.status(500).send(err);
  }
};


const deleteManyStatuses = async (req, res) => {
  try {
    await Status.updateMany(
      { _id: { $in: req.body.ids } },
      { $set: { isActive: false } }
    );
    res.status(200).send({
      message: "Statuses Updated to Inactive Successfully!",
    });
  } catch (err) {
    console.log('deleteManyStatuses error: ', err);
    res.status(500).send(err);
  }
};


module.exports = {
  createStatus,
  getAllStatuses,
  getStatusById,
  getStatusByName,
  updateStatus,
  deleteStatus,
  deleteManyStatuses,
};
