const mongoose = require("mongoose");

const formSubmissionSchema = new mongoose.Schema(
  {
    formCode: { type: String, required: true, index: true },
    submittedAt: { type: Date, required: true },
    melaketId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Status",
      default: null,
    },
    data: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { timestamps: true }
);

const FormSubmission =
  mongoose.models.FormSubmission ||
  mongoose.model("FormSubmission", formSubmissionSchema);

module.exports = FormSubmission;
