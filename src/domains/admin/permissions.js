'use strict';

// Everything a staff role can be allowed to do in the back office.
// Routes check these keys; roles (stored in StaffRole) are lists of them.
// The dashboard reads this catalog to draw the role editor, so labels are user-facing.
const PERMISSIONS = [
  { key: 'dashboard.view', group: 'Overview', label: 'View dashboard and analytics' },

  { key: 'players.view', group: 'Players', label: 'View players' },
  { key: 'players.edit', group: 'Players', label: 'Change player controls (suspend, limits, deposits) and zero balances' },
  { key: 'players.credit', group: 'Players', label: 'Manually credit player wallets' },
  { key: 'players.delete', group: 'Players', label: 'Delete player accounts' },
  { key: 'players.export', group: 'Players', label: 'Export players' },

  { key: 'bets.view', group: 'Bets', label: 'View bets' },
  { key: 'bets.export', group: 'Bets', label: 'Export bets' },
  { key: 'bets.reconcile', group: 'Bets', label: 'Reconcile virtual bets' },

  { key: 'transactions.view', group: 'Money', label: 'View transactions' },
  { key: 'transactions.export', group: 'Money', label: 'Export transactions' },
  { key: 'transactions.reconcile', group: 'Money', label: 'Recheck withdrawals with the payment provider' },
  { key: 'transactions.resolve', group: 'Money', label: 'Manually resolve stuck withdrawals' },
  { key: 'treasury.view', group: 'Money', label: 'View withdrawal treasury' },
  { key: 'treasury.allocate', group: 'Money', label: 'Fund the withdrawal treasury' },
  { key: 'finance.view', group: 'Money', label: 'View the finance report (revenue, tax, fees) and export it' },

  { key: 'cashback.view', group: 'Promotions', label: 'View cashbacks' },
  { key: 'freebets.view', group: 'Promotions', label: 'View free bet campaigns' },
  { key: 'freebets.manage', group: 'Promotions', label: 'Create, award and revoke free bets' },
  { key: 'sms.send', group: 'Promotions', label: 'Send bulk SMS' },
  { key: 'announcements.manage', group: 'Promotions', label: 'Publish announcements' },

  { key: 'events.manage', group: 'Games', label: 'Create, settle and cancel events; virtual shortcode tools' },

  { key: 'fraud.view', group: 'Risk & Compliance', label: 'View fraud alerts' },
  { key: 'fraud.resolve', group: 'Risk & Compliance', label: 'Resolve fraud alerts' },
  { key: 'audit.view', group: 'Risk & Compliance', label: 'View audit logs and staff sign-ins' },

  { key: 'chat.agent', group: 'Support', label: 'Answer live chat' },
  { key: 'chat.supervise', group: 'Support', label: 'Supervise support agents and read any chat' },
];

const PERMISSION_KEYS = PERMISSIONS.map((permission) => permission.key);

// Super admins always hold every permission and are the only ones who can
// manage staff accounts and roles. That is deliberately not a grantable
// permission: whoever held it could hand themselves everything else.
const SUPER_ADMIN = 'super_admin';

const DEFAULT_ROLES = [
  {
    key: SUPER_ADMIN,
    name: 'Super Admin',
    description: 'Full access, including staff accounts and roles.',
    permissions: PERMISSION_KEYS,
  },
  {
    key: 'admin',
    name: 'Admin',
    description: 'Runs day-to-day operations.',
    permissions: [
      'dashboard.view',
      'players.view', 'players.edit', 'players.credit', 'players.delete', 'players.export',
      'bets.view', 'bets.export', 'bets.reconcile',
      'transactions.view', 'transactions.export', 'transactions.reconcile', 'treasury.view', 'finance.view',
      'cashback.view', 'sms.send', 'announcements.manage',
      'events.manage',
      'fraud.view', 'fraud.resolve', 'audit.view',
      'chat.agent',
    ],
  },
  {
    key: 'support',
    name: 'Support',
    description: 'Answers players and looks up their accounts.',
    permissions: ['players.view', 'bets.view', 'transactions.view', 'chat.agent'],
  },
  {
    key: 'finance',
    name: 'Finance',
    description: 'Payments, withdrawals and the treasury.',
    permissions: [
      'dashboard.view',
      'players.view',
      'bets.view',
      'transactions.view', 'transactions.export', 'transactions.reconcile',
      'treasury.view', 'treasury.allocate', 'finance.view',
      'cashback.view',
      'audit.view',
    ],
  },
  {
    key: 'risk',
    name: 'Risk & Compliance',
    description: 'Fraud alerts, player restrictions and audit trail.',
    permissions: [
      'dashboard.view',
      'players.view', 'players.edit', 'players.export',
      'bets.view',
      'transactions.view',
      'fraud.view', 'fraud.resolve', 'audit.view',
    ],
  },
  {
    key: 'marketing',
    name: 'Marketing',
    description: 'Promotions, free bets, SMS and announcements.',
    permissions: [
      'dashboard.view',
      'players.view',
      'cashback.view', 'freebets.view', 'freebets.manage', 'sms.send', 'announcements.manage',
    ],
  },
];

const DEFAULT_ROLE_KEYS = DEFAULT_ROLES.map((role) => role.key);

const isKnownPermission = (key) => PERMISSION_KEYS.includes(key);

module.exports = {
  PERMISSIONS,
  PERMISSION_KEYS,
  DEFAULT_ROLES,
  DEFAULT_ROLE_KEYS,
  SUPER_ADMIN,
  isKnownPermission,
};
