'use strict';

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const resetPasswordSchema = new mongoose.Schema(
  {
    codeHash: { type: String, select: false },
    expiresAt: { type: Date, select: false },
    requestedAt: { type: Date, select: false },
  },
  { _id: false }
);

const phoneVerificationSchema = new mongoose.Schema(
  {
    codeHash: { type: String, select: false },
    expiresAt: { type: Date, select: false },
    requestedAt: { type: Date, select: false },
    verifiedAt: { type: Date, select: false },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    name: { type: String, trim: true, maxlength: 80 },
    email: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
    },
    phoneVerified: { type: Boolean, default: false, index: true },
    password: { type: String, required: true, minlength: 8, select: false },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    isStaff: { type: Boolean, default: false, index: true },
    adminLevel: {
      type: String,
      enum: ['support', 'admin', 'super_admin', null],
      default: null,
      index: true,
    },
    referralCode: {
      type: String,
      unique: true,
      sparse: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    referredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    referredAt: { type: Date, default: null },
    referralStats: {
      referredUsersCount: { type: Number, default: 0, min: 0 },
      bonusEarned: { type: Number, default: 0, min: 0 },
    },
    referralReward: {
      qualifyingDepositAt: { type: Date, default: null },
      bonusGrantedAt: { type: Date, default: null },
      qualifyingDepositTotal: { type: Number, default: 0, min: 0 },
      bonusAmount: { type: Number, default: 0, min: 0 },
    },
    phoneVerification: { type: phoneVerificationSchema, default: () => ({}) },
    resetPassword: { type: resetPasswordSchema, default: () => ({}) },
    balance: { type: Number, default: 0, min: 0 },
    airtimeBalance: { type: Number, default: 0, min: 0 },
    // Tracks how much of the Celo gateway's per-user custodial balance has
    // already been swept into `balance`, so celo/deposit/sync can credit
    // only the newly-arrived delta instead of double-crediting on repeat
    // calls. Populated lazily — absent until the first sync for an asset.
    celoSweptBalances: {
      USDT: { type: Number, default: 0, min: 0 },
      USDC: { type: Number, default: 0, min: 0 },
      cUSD: { type: Number, default: 0, min: 0 },
    },
    activeWallet: { type: String, enum: ['balance', 'airtime'], default: 'balance' },
    status: { type: String, enum: ['active', 'suspended'], default: 'active' },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        delete ret.password;
        delete ret.__v;
        return ret;
      },
    },
  }
);

userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('User', userSchema);
