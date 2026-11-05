'use strict';

const onlineAgents = new Map();

const setOnline = (userId, data) => onlineAgents.set(String(userId), data);
const setStatus = (userId, status) => {
  const agent = onlineAgents.get(String(userId));
  if (agent) agent.status = status;
};
const remove = (userId) => onlineAgents.delete(String(userId));
const get = (userId) => onlineAgents.get(String(userId)) || null;
const count = () => onlineAgents.size;
const list = () => Array.from(onlineAgents.values());

module.exports = { setOnline, setStatus, remove, get, count, list };
