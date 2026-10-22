'use strict';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

/** Structured JSON-lines logger (SAD 4.4). */
function createLogger(level = 'info', stream = process.stdout) {
  const min = LEVELS[level] === undefined ? LEVELS.info : LEVELS[level];
  const write = (lvl, msg, fields) => {
    if (LEVELS[lvl] < min) return;
    stream.write(`${JSON.stringify({ timestamp: new Date().toISOString(), level: lvl, msg, ...fields })}\n`);
  };
  return {
    debug: (msg, fields) => write('debug', msg, fields),
    info: (msg, fields) => write('info', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    error: (msg, fields) => write('error', msg, fields)
  };
}

module.exports = { createLogger };
