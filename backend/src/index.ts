import { createApp } from './app.js';
import { config } from './config.js';
import { startScheduler } from './scheduler.js';

const app = createApp();
app.listen(config.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`church-hub API listening on :${config.PORT} (${config.NODE_ENV})`);
  // Background worker: scheduled campaign sends + auto-automations (multi-replica
  // safe via a Postgres advisory lock).
  startScheduler();
});
