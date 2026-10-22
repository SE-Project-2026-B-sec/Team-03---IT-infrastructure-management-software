'use strict';

const MAX_TRACKED_KEYS = 10000;

/**
 * Locks a key (for example "ip|username") after too many failures inside a
 * sliding window (PRJ-SR-005).
 */
class FailureLimiter {
  constructor({ maxFailures, windowMs, lockoutMs, now = Date.now }) {
    this.maxFailures = maxFailures;
    this.windowMs = windowMs;
    this.lockoutMs = lockoutMs;
    this.now = now;
    this.entries = new Map();
  }

  /** Remaining lockout in milliseconds, or 0 when the key is not locked. */
  lockedFor(key) {
    const entry = this.entries.get(key);
    if (!entry || !entry.lockedUntil) return 0;
    const remaining = entry.lockedUntil - this.now();
    if (remaining <= 0) {
      this.entries.delete(key);
      return 0;
    }
    return remaining;
  }

  recordFailure(key) {
    const now = this.now();
    const entry = this.entries.get(key) || { failures: [], lockedUntil: 0 };
    entry.failures = entry.failures.filter((t) => now - t < this.windowMs);
    entry.failures.push(now);
    if (entry.failures.length >= this.maxFailures) {
      entry.lockedUntil = now + this.lockoutMs;
      entry.failures = [];
    }
    this.entries.set(key, entry);
    this.prune(now);
    return entry.lockedUntil > now;
  }

  reset(key) {
    this.entries.delete(key);
  }

  prune(now) {
    if (this.entries.size <= MAX_TRACKED_KEYS) return;
    for (const [key, entry] of this.entries) {
      const stale = entry.lockedUntil < now && entry.failures.every((t) => now - t >= this.windowMs);
      if (stale) this.entries.delete(key);
    }
  }
}

/** Fixed-window request counter used as a general per-client API limit. */
class RequestLimiter {
  constructor({ limit, windowMs, now = Date.now }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
    this.windows = new Map();
  }

  hit(key) {
    const now = this.now();
    let w = this.windows.get(key);
    if (!w || now >= w.resetAt) {
      w = { count: 0, resetAt: now + this.windowMs };
      this.windows.set(key, w);
      if (this.windows.size > MAX_TRACKED_KEYS) {
        for (const [k, v] of this.windows) if (now >= v.resetAt) this.windows.delete(k);
      }
    }
    w.count += 1;
    return {
      allowed: w.count <= this.limit,
      remaining: Math.max(0, this.limit - w.count),
      retryAfterSeconds: Math.ceil((w.resetAt - now) / 1000)
    };
  }
}

module.exports = { FailureLimiter, RequestLimiter };
