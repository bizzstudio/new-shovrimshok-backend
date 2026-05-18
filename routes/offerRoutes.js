// routes/offerRoutes.js
const express = require("express");
const router = express.Router();
const {
  addOffer,
  getAllOffers,
  getOfferById,
  updateOffer,
  deleteOffer,
  deleteManyOffers,
} = require("../controller/offerController");
const { isAdmin, storeCustomerOrExtract } = require("../config/auth");

// add a offer
router.post("/add", isAdmin, addOffer);

// get a offer
router.get("/:id", storeCustomerOrExtract, getOfferById);

// get all offers
router.get("/", storeCustomerOrExtract, getAllOffers);

// update a offer
router.put("/:id", isAdmin, updateOffer);

// delete a offer
router.delete("/:id", isAdmin, deleteOffer);

// delete many offers
router.patch("/delete/many", isAdmin, deleteManyOffers);

module.exports = router;