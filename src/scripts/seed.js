'use strict';

const { connectDatabase, disconnectDatabase } = require('../config/database');
const logger = require('../utils/logger');
const User = require('../domains/user/user.model');
const Event = require('../domains/event/event.model');
const Bet = require('../domains/bet/bet.model');

async function seed() {
  await connectDatabase();
  await Promise.all([User.deleteMany({}), Event.deleteMany({}), Bet.deleteMany({})]);

  await User.create({
    phone: '254700000001',
    name: 'Admin',
    email: 'admin@betnare.test',
    password: 'password123',
    phoneVerified: true,
    role: 'admin',
    balance: 0,
  });

  await User.create({
    phone: '254700000002',
    name: 'Punter',
    email: 'punter@betnare.test',
    password: 'password123',
    phoneVerified: true,
    balance: 1000,
  });

  const inOneDay = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await Event.create({
    sport: 'football',
    league: 'Premier League',
    homeTeam: 'Arsenal',
    awayTeam: 'Chelsea',
    startTime: inOneDay,
    selections: [
      { key: 'home', label: 'Arsenal', odds: 2.1 },
      { key: 'draw', label: 'Draw', odds: 3.4 },
      { key: 'away', label: 'Chelsea', odds: 3.0 },
    ],
  });

  logger.info('Seed complete');
  await disconnectDatabase();
  process.exit(0);
}

seed().catch((err) => {
  logger.error('Seed failed', err);
  process.exit(1);
});
