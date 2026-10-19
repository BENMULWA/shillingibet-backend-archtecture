'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../../config');
const ApiError = require('../../utils/ApiError');
const logger = require('../../utils/logger');
const { normalizePhone } = require('../../utils/phone');
const smsService = require('../../services/sms.service');
const User = require('./user.model');
const { getStaffLevel, isStaffUser } = require('../../middlewares/auth');
const { normalizeReferralCode, makeReferralCodeCandidate } = require('./referral');
const { incWalletBalance, normalizeWalletType } = require('../../utils/db');

const signToken = (user) =>
  jwt.sign(
    {
      sub: user._id.toString(),
      role: user.role,
      isStaff: Boolean(user.isStaff),
      adminLevel: user.adminLevel || null,
    },
    config.jwt.secret,
    {
    expiresIn: config.jwt.expiresIn,
    }
  );

const hashResetCode = (code) =>
  crypto.createHash('sha256').update(`${code}:${config.jwt.secret}`).digest('hex');

const generateResetCode = () => `${Math.floor(100000 + Math.random() * 900000)}`;
const generatePhoneVerificationCode = () => `${Math.floor(100000 + Math.random() * 900000)}`;

const generateUniqueReferralCode = async () => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = makeReferralCodeCandidate();
    const exists = await User.exists({ referralCode: candidate });
    if (!exists) return candidate;
  }
  throw new Error('Unable to generate a unique referral code');
};

const ensureReferralCode = async (user) => {
  if (user.referralCode) return user;

  user.referralCode = await generateUniqueReferralCode();
  await user.save();
  return user;
};

const buildReferralProfile = async (user) => {
  const referredUsersCount = await User.countDocuments({ referredBy: user._id });
  return {
    code: user.referralCode || null,
    referredUsersCount,
    bonusEarned: user.referralStats?.bonusEarned || 0,
    bonusGrantedAt: user.referralReward?.bonusGrantedAt || null,
    qualifyingDepositTotal: user.referralReward?.qualifyingDepositTotal || 0,
    referredBy: user.referredBy
      ? {
          id: user.referredBy._id,
          phone: user.referredBy.phone,
          name: user.referredBy.name || null,
          referralCode: user.referredBy.referralCode || null,
        }
      : null,
  };
};

const buildPhoneVerificationState = (code) => {
  const now = new Date();
  return {
    codeHash: hashResetCode(code),
    expiresAt: new Date(now.getTime() + config.sms.phoneVerificationTtlMinutes * 60 * 1000),
    requestedAt: now,
    verifiedAt: null,
  };
};

const register = async ({ phone, password, name, email, referralCode }) => {
  const normalizedPhone = normalizePhone(phone);
  const exists = await User.exists({ phone: normalizedPhone });
  if (exists) throw ApiError.conflict('Phone number already registered');

  let referrer = null;
  const normalizedReferralCode = normalizeReferralCode(referralCode);
  if (normalizedReferralCode) {
    referrer = await User.findOne({ referralCode: normalizedReferralCode });
    if (!referrer) throw ApiError.badRequest('Referral code is invalid');
    await ensureReferralCode(referrer);
  }

  const phoneVerificationCode = generatePhoneVerificationCode();
  const user = await User.create({
    phone: normalizedPhone,
    password,
    name,
    email,
    phoneVerified: false,
    referralCode: await generateUniqueReferralCode(),
    referredBy: referrer?._id || null,
    referredAt: referrer ? new Date() : null,
    phoneVerification: buildPhoneVerificationState(phoneVerificationCode),
  });

  if (referrer) {
    await User.updateOne({ _id: referrer._id }, { $inc: { 'referralStats.referredUsersCount': 1 } });
  }

  const verificationSms = await smsService.safeSendPhoneVerificationCode({
    phone: user.phone,
    code: phoneVerificationCode,
  });
  const hydratedUser = await User.findById(user._id).populate('referredBy', 'phone name referralCode');
  return {
    user: { ...hydratedUser.toJSON(), referral: await buildReferralProfile(hydratedUser) },
    verificationRequired: true,
    verificationSmsSent: verificationSms.sent === true,
  };
};

const login = async ({ phone, password }) => {
  const user = await User.findOne({ phone: normalizePhone(phone) }).select('+password');
  if (!user || !(await user.comparePassword(password))) {
    throw ApiError.unauthorized('Invalid phone or password');
  }
  if (user.status !== 'active') throw ApiError.forbidden('Account is suspended');
  if (user.phoneVerified !== true) {
    throw ApiError.forbidden('Phone number not verified', {
      verificationRequired: true,
      phone: user.phone,
    });
  }

  await ensureReferralCode(user);
  await user.populate('referredBy', 'phone name referralCode');
  return { user: { ...user.toJSON(), referral: await buildReferralProfile(user) }, token: signToken(user) };
};

const staffLogin = async ({ phone, password }) => {
  const result = await login({ phone, password });
  if (!isStaffUser(result.user)) {
    throw ApiError.forbidden('Staff access is not enabled for this account');
  }
  return result;
};

const verifyPhone = async ({ phone, code }) => {
  const normalizedPhone = normalizePhone(phone);
  const user = await User.findOne({ phone: normalizedPhone }).select(
    '+phoneVerification.codeHash +phoneVerification.expiresAt +phoneVerification.requestedAt +phoneVerification.verifiedAt'
  );
  if (!user) throw ApiError.badRequest('Invalid verification code or phone number');

  if (user.phoneVerified) {
    await ensureReferralCode(user);
    await user.populate('referredBy', 'phone name referralCode');
    return { user: { ...user.toJSON(), referral: await buildReferralProfile(user) }, token: signToken(user) };
  }

  const codeHash = user.phoneVerification?.codeHash;
  const expiresAt = user.phoneVerification?.expiresAt;
  if (!codeHash || !expiresAt || expiresAt.getTime() < Date.now()) {
    throw ApiError.badRequest('Verification code is invalid or expired');
  }

  if (hashResetCode(code) !== codeHash) {
    throw ApiError.badRequest('Invalid verification code or phone number');
  }

  user.phoneVerified = true;
  user.phoneVerification = { verifiedAt: new Date() };
  await ensureReferralCode(user);
  await user.save();
  await user.populate('referredBy', 'phone name referralCode');
  await smsService.sendSignupWelcome({ phone: user.phone, name: user.name });

  return { user: { ...user.toJSON(), referral: await buildReferralProfile(user) }, token: signToken(user) };
};

const resendPhoneCode = async ({ phone }) => {
  const normalizedPhone = normalizePhone(phone);
  const user = await User.findOne({ phone: normalizedPhone }).select(
    '+phoneVerification.codeHash +phoneVerification.expiresAt +phoneVerification.requestedAt +phoneVerification.verifiedAt'
  );
  if (!user || user.phoneVerified) return;

  const code = generatePhoneVerificationCode();
  user.phoneVerification = buildPhoneVerificationState(code);
  await user.save();
  await smsService.sendPhoneVerificationCode({ phone: user.phone, code });
};

const requestPasswordReset = async ({ phone }) => {
  const normalizedPhone = normalizePhone(phone);
  const user = await User.findOne({ phone: normalizedPhone }).select('+resetPassword.codeHash +resetPassword.expiresAt +resetPassword.requestedAt');
  if (!user) return;

  const code = generateResetCode();
  const now = new Date();
  user.resetPassword = {
    codeHash: hashResetCode(code),
    expiresAt: new Date(now.getTime() + config.sms.resetCodeTtlMinutes * 60 * 1000),
    requestedAt: now,
  };
  await user.save();

  try {
    await smsService.sendPasswordResetCode({ phone: user.phone, code });
  } catch (err) {
    logger.error('Password reset SMS failed', user.phone, err.message);
    throw err;
  }
};

const resetPassword = async ({ phone, code, newPassword }) => {
  const normalizedPhone = normalizePhone(phone);
  const user = await User.findOne({ phone: normalizedPhone }).select('+password +resetPassword.codeHash +resetPassword.expiresAt');
  if (!user) throw ApiError.badRequest('Invalid reset code or phone number');

  const codeHash = user.resetPassword?.codeHash;
  const expiresAt = user.resetPassword?.expiresAt;
  if (!codeHash || !expiresAt || expiresAt.getTime() < Date.now()) {
    throw ApiError.badRequest('Reset code is invalid or expired');
  }

  if (hashResetCode(code) !== codeHash) {
    throw ApiError.badRequest('Invalid reset code or phone number');
  }

  user.password = newPassword;
  user.resetPassword = {};
  await user.save();
};

const getById = async (id) => {
  let user = await User.findById(id).populate('referredBy', 'phone name referralCode');
  if (!user) throw ApiError.notFound('User not found');
  user = await ensureReferralCode(user);
  return {
    ...user.toJSON(),
    referral: await buildReferralProfile(user),
  };
};

const deposit = async (id, amount, walletType) => {
  const existingUser = await User.findById(id).select('activeWallet').lean();
  if (!existingUser) throw ApiError.notFound('User not found');

  const targetWallet = normalizeWalletType(walletType || existingUser.activeWallet);
  const user = await User.findByIdAndUpdate(
    id,
    incWalletBalance(targetWallet, amount),
    { new: true }
  ).lean();
  if (!user) throw ApiError.notFound('User not found');
  return user;
};

const setActiveWallet = async (id, wallet) => {
  const user = await User.findByIdAndUpdate(
    id,
    { $set: { activeWallet: normalizeWalletType(wallet) } },
    { new: true }
  )
    .populate('referredBy', 'phone name referralCode');
  if (!user) throw ApiError.notFound('User not found');
  return {
    ...user.toJSON(),
    referral: await buildReferralProfile(user),
  };
};

const updateStaffAccess = async (actor, userId, { isStaff, adminLevel }) => {
  if (getStaffLevel(actor) !== 'super_admin') {
    throw ApiError.forbidden('Only super admins can manage staff access');
  }

  const nextAdminLevel = isStaff ? adminLevel || 'support' : null;
  if (isStaff && !nextAdminLevel) {
    throw ApiError.badRequest('adminLevel is required when staff access is enabled');
  }

  const user = await User.findByIdAndUpdate(
    userId,
    {
      $set: {
        isStaff,
        adminLevel: nextAdminLevel,
        role: isStaff ? 'admin' : 'user',
      },
    },
    { new: true }
  ).lean();

  if (!user) throw ApiError.notFound('User not found');
  return user;
};

module.exports = {
  register,
  login,
  verifyPhone,
  resendPhoneCode,
  requestPasswordReset,
  resetPassword,
  staffLogin,
  getById,
  setActiveWallet,
  updateStaffAccess,
  deposit,
  signToken,
};
