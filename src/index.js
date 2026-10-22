'use strict';

const { createApp } = require('./app');

/** Process entry point: starts the server and wires graceful shutdown. */
async function main() {
  const app = createApp();
  await app.start();

  let stopping = false;
  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    app.logger.info('Shutdown signal received', { signal });
    try {
      await app.stop();
      process.exit(0);
    } catch (err) {
      app.logger.error('Error during shutdown', { error: err.message });
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  const crash = (kind) => (err) => {
    app.logger.error(kind, { error: err && err.message, stack: err && err.stack });
    app.store.flushSync();
    process.exit(1);
  };
  process.on('uncaughtException', crash('Uncaught exception'));
  process.on('unhandledRejection', crash('Unhandled promise rejection'));
}

main().catch((err) => {
  process.stderr.write(`Failed to start: ${err.message}\n`);
  process.exit(1);
});
