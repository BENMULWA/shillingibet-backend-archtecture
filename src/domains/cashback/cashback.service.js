'use strict';

const User = require('../user/user.model');
const CashbackAward = require('./cashbackAward.model');

// Read-only for now: awards are listed here, the daily cashback job is not part of this API yet.
const listAwards = async ({ page, limit, phone }) => {
  const filter = {};
  if (phone) {
    let digits = String(phone).replace(/\D/g, '');
    if (digits.startsWith('0')) digits = `254${digits.slice(1)}`;
    else if (/^[17]/.test(digits)) digits = `254${digits}`;
    const users = await User.find({ phone: { $regex: `^${digits}` } }).select('_id').lean();
    filter.user = { $in: users.map((user) => user._id) };
  }
  const [items, total] = await Promise.all([
    CashbackAward.find(filter)
      .populate('user', 'phone name')
      .sort({ windowEnd: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    CashbackAward.countDocuments(filter),
  ]);
  return { items, total, page, limit, pages: Math.ceil(total / limit) };
};

module.exports = { listAwards };
