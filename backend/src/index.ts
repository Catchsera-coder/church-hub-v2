import { createApp } from './app.js';
import { config } from './config.js';

const app = createApp();
app.listen(config.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`church-hub API listening on :${config.PORT} (${config.NODE_ENV})`);
});
