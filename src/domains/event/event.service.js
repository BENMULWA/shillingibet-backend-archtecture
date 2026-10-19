'use strict';

const ApiError = require('../../utils/ApiError');
const Event = require('./event.model');

const create = (data) => Event.create(data);

const list = async ({ sport, status, page, limit }) => {
  const filter = {};
  if (sport) filter.sport = sport;
  if (status) filter.status = status;

  const [items, total] = await Promise.all([
    Event.find(filter)
      .sort({ startTime: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Event.countDocuments(filter),
  ]);

  return { items, total, page, limit, pages: Math.ceil(total / limit) };
};

const getById = async (id) => {
  const event = await Event.findById(id).lean();
  if (!event) throw ApiError.notFound('Event not found');
  return event;
};

const settle = async (id, result) => {
  const event = await Event.findById(id);
  if (!event) throw ApiError.notFound('Event not found');
  if (event.status === 'finished') {
    if (event.result !== result) {
      throw ApiError.conflict('Event already settled with a different result');
    }
    // A previous request may have failed after finishing the event but before
    // every open bet was paid. Returning the event lets settlement safely
    // resume; individual bet updates are guarded by status: 'open'.
    return event.toJSON();
  }

  const valid = event.selections.some((s) => s.key === result);
  if (!valid) throw ApiError.badRequest(`Unknown selection key: ${result}`);

  event.status = 'finished';
  event.result = result;
  await event.save();
  return event.toJSON();
};

module.exports = { create, list, getById, settle };
