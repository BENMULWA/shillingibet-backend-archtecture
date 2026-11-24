'use strict';

// Accept payment-provider callbacks only from the provider's own servers.
//
// MAMLAKA_CALLBACK_IPS=1.2.3.4,5.6.7.0/24   (comma-separated IPv4 addresses or CIDR ranges)
// Empty = accept from anywhere (the signature / secret checks still apply).
//
// The caller's address is req.ip. With app.set('trust proxy', 1) that is the address nginx
// saw, so the app must only be reachable through nginx; otherwise a caller could fake it.

const logger = require('../utils/logger');
const ApiError = require('../utils/ApiError');

const normalizeIp = (ip) => String(ip || '').trim().replace(/^::ffff:/i, '');

const ipv4ToInt = (ip) => {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) return null;
    n = n * 256 + Number(part);
  }
  return n;
};

// Does `ip` match one rule: an exact address, or an IPv4 CIDR range such as 10.0.0.0/24?
const ipMatches = (ip, rule) => {
  const address = normalizeIp(ip);
  const [base, bitsText] = String(rule).trim().split('/');
  if (bitsText == null) return address === normalizeIp(base);
  const bits = Number(bitsText);
  const a = ipv4ToInt(address);
  const b = ipv4ToInt(normalizeIp(base));
  if (a == null || b == null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  if (bits === 0) return true;
  const block = 2 ** (32 - bits);
  return Math.floor(a / block) === Math.floor(b / block);
};

const isAllowed = (ip, rules) => !rules.length || rules.some((rule) => ipMatches(ip, rule));

// getRules is called per request so tests and config reloads see the current list.
const callbackIpAllowlist = (getRules, provider) => (req, _res, next) => {
  const rules = getRules() || [];
  if (isAllowed(req.ip, rules)) return next();
  const ip = normalizeIp(req.ip);
  logger.warn(`Refused ${provider} callback from ${ip}`, { path: req.originalUrl.split('?')[0], socket: req.socket?.remoteAddress });
  // Lazy require: the watchdog pulls in database models this middleware shouldn't load up front.
  require('../domains/admin/gatewayWatch.service').reportRejectedCallback({ ip, provider, path: req.originalUrl.split('?')[0] });
  return next(ApiError.forbidden('Callback source not allowed'));
};

module.exports = { callbackIpAllowlist, ipMatches, isAllowed, normalizeIp };
