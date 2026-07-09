'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const { sendSuccess } = require('../../utils/response');
const userService = require('./user.service');

const register = asyncHandler(async (req, res) => {
  const result = await userService.register(req.body);
  sendSuccess(res, { statusCode: 201, message: 'Registered', data: result });
});

const login = asyncHandler(async (req, res) => {
  const result = await userService.login(req.body);
  sendSuccess(res, { message: 'Logged in', data: result });
});

const verifyPhone = asyncHandler(async (req, res) => {
  const result = await userService.verifyPhone(req.body);
  sendSuccess(res, { message: 'Phone number verified', data: result });
});

const resendPhoneCode = asyncHandler(async (req, res) => {
  await userService.resendPhoneCode(req.body);
  sendSuccess(res, { message: 'Verification code sent by SMS' });
});

const requestPasswordReset = asyncHandler(async (req, res) => {
  await userService.requestPasswordReset(req.body);
  sendSuccess(res, { message: 'If the account exists, a reset code has been sent by SMS' });
});

const resetPassword = asyncHandler(async (req, res) => {
  await userService.resetPassword(req.body);
  sendSuccess(res, { message: 'Password reset successful' });
});

const staffLogin = asyncHandler(async (req, res) => {
  const result = await userService.staffLogin(req.body);
  sendSuccess(res, { message: 'Staff logged in', data: result });
});

const me = asyncHandler(async (req, res) => {
  const user = await userService.getById(req.user._id);
  sendSuccess(res, { data: user });
});

const setActiveWallet = asyncHandler(async (req, res) => {
  const user = await userService.setActiveWallet(req.user._id, req.body.wallet);
  sendSuccess(res, { message: 'Active wallet updated', data: user });
});

const updateStaffAccess = asyncHandler(async (req, res) => {
  const user = await userService.updateStaffAccess(req.user, req.params.id, req.body);
  sendSuccess(res, { message: 'Staff access updated', data: user });
});

const credit = asyncHandler(async (req, res) => {
  const user = await userService.deposit(req.body.userId, req.body.amount, req.body.walletType);
  sendSuccess(res, { message: 'Account credited', data: user });
});

module.exports = { register, login, verifyPhone, resendPhoneCode, requestPasswordReset, resetPassword, staffLogin, me, setActiveWallet, updateStaffAccess, credit };
