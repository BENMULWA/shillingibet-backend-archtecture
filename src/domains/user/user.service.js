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
const authEvents = require('../admin/authEvent.service');
const { incWalletBalance, normalizeWalletType } = require('../../utils/db');

// `mfa` marks tokens issued after the SMS code check; staff routes reject tokens without it.
const signToken = (user, { mfa = false } = {}) =>
  jwt.sign(
    {
      sub: user._id.toString(),
      role: user.role,
      isStaff: Boolean(user.isStaff),
      adminLevel: user.adminLevel || null,
      ...(mfa ? { mfa: true } : {}),
    },
    config.jwt.secret,
    {
    expiresIn: config.jwt.expiresIn,
    }
  );

const hashResetCode = (code) =>
  crypto.createHash('sha256').update(`${code}:${config.jwt.secret}`).digest('hex');

const generateResetCode = () => `${Math.floor(100000 + Math.random() * 900000)}`;
const generateStaffLoginCode = () => `${crypto.randomInt(100000, 1000000)}`;
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
  if (!user || user.deletedAt || !(await user.comparePassword(password))) {
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

const staffLogin = async ({ phone, password }, context = {}) => {
  const user = await User.findOne({ phone: normalizePhone(phone) })
    .select('+password +staffLoginChallenge.challengeId +staffLoginChallenge.codeHash +staffLoginChallenge.expiresAt +staffLoginChallenge.requestedAt +staffLoginChallenge.consumedAt +staffLoginChallenge.attemptsRemaining');
  if (!user || !(await user.comparePassword(password))) {
    await authEvents.record({
      type: 'staff_login_password_failed',
      outcome: 'failed',
      user,
      phone,
      context,
      detail: user ? null : 'Unknown phone number',
    });
    throw ApiError.unauthorized('Invalid phone or password');
  }
  const legacyStaffLevel = ['support', 'super_admin'].includes(user.role)
    ? user.role
    : user.role === 'admin' && !user.adminLevel ? 'super_admin' : null;
  if (!isStaffUser(user) && !legacyStaffLevel) {
    await authEvents.record({ type: 'staff_login_not_staff', outcome: 'denied', user, context });
    throw ApiError.forbidden('Staff access is not enabled for this account');
  }
  if (user.status !== 'active') throw ApiError.forbidden('Account is suspended');
  if (user.phoneVerified !== true) throw ApiError.forbidden('Phone number not verified');

  // Legacy staff records stored the access level directly in `role`. The current
  // schema keeps the broad role as `admin` and the precise level in `adminLevel`.
  user.isStaff = true;
  if (!user.adminLevel && legacyStaffLevel) user.adminLevel = legacyStaffLevel;
  if (user.role !== 'admin') user.role = 'admin';

  const code = generateStaffLoginCode();
  const now = new Date();
  const challengeId = crypto.randomUUID();
  user.staffLoginChallenge = {
    challengeId,
    codeHash: hashResetCode(code),
    requestedAt: now,
    expiresAt: new Date(now.getTime() + config.sms.staffLoginCodeTtlMinutes * 60 * 1000),
    consumedAt: null,
    attemptsRemaining: 5,
  };
  await user.save();
  await smsService.sendStaffLoginCode({ phone: user.phone, code });
  await authEvents.record({ type: 'staff_login_code_sent', outcome: 'success', user, context });

  return {
    verificationRequired: true,
    challengeId,
    maskedPhone: `******${user.phone.slice(-4)}`,
    expiresInSeconds: config.sms.staffLoginCodeTtlMinutes * 60,
    attemptsRemaining: 5,
  };
};

const verifyStaffLogin = async ({ challengeId, code }, context = {}) => {
  const now = new Date();
  const codeHash = hashResetCode(code);
  const user = await User.findOneAndUpdate(
    {
      isStaff: true,
      status: 'active',
      phoneVerified: true,
      'staffLoginChallenge.challengeId': challengeId,
      'staffLoginChallenge.codeHash': codeHash,
      'staffLoginChallenge.expiresAt': { $gt: now },
      'staffLoginChallenge.consumedAt': null,
      'staffLoginChallenge.attemptsRemaining': { $gt: 0 },
    },
    { $set: { 'staffLoginChallenge.consumedAt': now } },
    { new: true }
  );

  if (!user) {
    await User.updateOne(
      {
        'staffLoginChallenge.challengeId': challengeId,
        'staffLoginChallenge.expiresAt': { $gt: now },
        'staffLoginChallenge.consumedAt': null,
        'staffLoginChallenge.attemptsRemaining': { $gt: 0 },
      },
      { $inc: { 'staffLoginChallenge.attemptsRemaining': -1 } }
    );
    const challengeOwner = await User.findOne({ 'staffLoginChallenge.challengeId': challengeId }).select('phone').lean();
    await authEvents.record({
      type: 'staff_login_code_failed',
      outcome: 'failed',
      user: challengeOwner,
      context,
      detail: challengeOwner ? 'Invalid, expired or already used code' : 'Unknown challenge',
    });
    throw ApiError.unauthorized('Verification code is invalid, expired, or already used');
  }

  await authEvents.record({ type: 'staff_login_success', outcome: 'success', user, context });
  return { user: user.toJSON(), token: signToken(user, { mfa: true }) };
};

const resendStaffLoginCode = async ({ challengeId }) => {
  const user = await User.findOne({
    isStaff: true,
    status: 'active',
    'staffLoginChallenge.challengeId': challengeId,
    'staffLoginChallenge.consumedAt': null,
  }).select('+staffLoginChallenge.challengeId +staffLoginChallenge.codeHash +staffLoginChallenge.expiresAt +staffLoginChallenge.requestedAt +staffLoginChallenge.consumedAt +staffLoginChallenge.attemptsRemaining');
  if (!user) throw ApiError.badRequest('Sign-in challenge is no longer available');

  const code = generateStaffLoginCode();
  const now = new Date();
  user.staffLoginChallenge.codeHash = hashResetCode(code);
  user.staffLoginChallenge.requestedAt = now;
  user.staffLoginChallenge.expiresAt = new Date(
    now.getTime() + config.sms.staffLoginCodeTtlMinutes * 60 * 1000
  );
  user.staffLoginChallenge.attemptsRemaining = 5;
  await user.save();
  await smsService.sendStaffLoginCode({ phone: user.phone, code });
  return { expiresInSeconds: config.sms.staffLoginCodeTtlMinutes * 60, attemptsRemaining: 5 };
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
  verifyStaffLogin,
  resendStaffLoginCode,
  getById,
  setActiveWallet,
  updateStaffAccess,
  deposit,
  signToken,
};
