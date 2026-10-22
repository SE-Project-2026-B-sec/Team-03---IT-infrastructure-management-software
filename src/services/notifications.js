'use strict';

const crypto = require('node:crypto');

/**
 * In-app notification centre. Alerts are de-duplicated by key so a condition
 * that persists (for example an ongoing license breach) is reported once.
 * Email/Slack delivery is out of scope (see SAD 4.6).
 */
function createNotificationService({ store, config }) {
  function raise({ dedupeKey, type, severity, title, message, entityType = null, entityId = null, data = {} }) {
    if (dedupeKey && !store.claimAlertKey(dedupeKey)) return null;
    const notification = {
      id: crypto.randomUUID(),
      type,
      severity,
      title,
      message,
      entityType,
      entityId,
      data,
      dedupeKey: dedupeKey || null,
      channel: 'IN_APP',
      createdAt: new Date(config.now()).toISOString()
    };
    store.insert('notifications', notification);
    return notification;
  }

  function list({ type, limit = 100 } = {}) {
    let items = store.all('notifications');
    if (type) items = items.filter((n) => n.type === type);
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }

  return { raise, list };
}

module.exports = { createNotificationService };
