'use strict';

const mongoose = require('mongoose');

// A staff role: a named set of permissions. Staff accounts point at a role
// through `User.adminLevel`, which holds the role's `key`.
const staffRoleSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      trim: true,
      match: /^[a-z][a-z0-9_]{1,39}$/,
    },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    description: { type: String, trim: true, maxlength: 200, default: '' },
    permissions: { type: [String], default: [] },
    // Built-in roles can be edited but not deleted.
    system: { type: Boolean, default: false, immutable: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('StaffRole', staffRoleSchema);
