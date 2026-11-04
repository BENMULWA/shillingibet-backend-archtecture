'use strict';

const AdminAudit = require('../domains/admin/adminAudit.model');
const { getStaffLevel } = require('./auth');
const logger = require('../utils/logger');

const SECRET_KEY = /(password|passcode|token|secret|authorization|cookie|api[-_]?key|pin|otp|code)/i;
const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];
// Reads are audited too (who looked at / exported player data), except the audit
// viewer itself and high-frequency dashboard polling, which would only add noise.
const UNAUDITED_READS = /\/(audit|notifications|analytics)(\/|$)/;
const EXPORT_PATH = /\/exports\//;
const OBJECT_ID = /\b[a-f\d]{24}\b/gi;

const sanitize = (value, depth = 0) => {
  if (depth > 4) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitize(item, depth + 1));
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' && value.length > 1000 ? `${value.slice(0, 1000)}…` : value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, SECRET_KEY.test(key) ? '[REDACTED]' : sanitize(item, depth + 1)])
  );
};

// Stable action name: object ids are dropped so the dashboard can group by action.
// Handlers may override it (and add targetUser / reason / changes) through res.locals.audit.
const actionFromRequest = (req) => {
  const path = req.originalUrl.split('?')[0].replace(OBJECT_ID, ':id');
  const slug = path.replace(/^\/+|\/+$/g, '').replace(/[^a-zA-Z0-9]+/g, '_') || 'admin';
  return `${req.method.toLowerCase()}_${slug}`.slice(0, 160);
};

const adminAudit = (req, res, next) => {
  const isWrite = WRITE_METHODS.includes(req.method);
  const path = req.originalUrl.split('?')[0];
  if (!isWrite && (req.method !== 'GET' || UNAUDITED_READS.test(path))) return next();

  const category = isWrite ? 'write' : EXPORT_PATH.test(path) ? 'export' : 'read';
  const snapshot = {
    actor: req.user._id,
    actorPhone: req.user.phone,
    actorRole: getStaffLevel(req.user) || req.user.role,
    action: actionFromRequest(req),
    category,
    method: req.method,
    path,
    ipAddress: req.ip || null,
    userAgent: req.get('user-agent') || null,
    details: sanitize({ params: req.params, query: req.query, body: isWrite ? req.body : undefined }),
  };

  let persisted = false;
  const persist = () => {
    if (persisted) return;
    persisted = true;
    const extra = res.locals.audit || {};
    AdminAudit.create({
      ...snapshot,
      action: extra.action ? String(extra.action).slice(0, 160) : snapshot.action,
      targetUser: extra.targetUser || null,
      reason: extra.reason ? String(extra.reason).slice(0, 500) : null,
      changes: extra.changes ? sanitize(extra.changes) : null,
      statusCode: res.statusCode,
      // 'close' without 'finish' means the client dropped before the response completed.
      outcome: res.statusCode < 400 && res.writableFinished ? 'success' : 'failed',
    }).catch((error) => logger.error('Failed to persist admin audit record', error));
  };

  res.once('finish', persist);
  res.once('close', persist);
  next();
};

module.exports = adminAudit;
module.exports.sanitize = sanitize;
module.exports.actionFromRequest = actionFromRequest;
