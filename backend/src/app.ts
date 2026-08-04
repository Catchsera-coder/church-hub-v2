import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { errorHandler } from './http/errors.js';
import { authRouter } from './modules/auth/routes.js';
import { peopleRouter } from './modules/people/routes.js';
import { familiesRouter } from './modules/families/routes.js';
import { ministriesRouter } from './modules/ministries/routes.js';
import { attendanceRouter } from './modules/attendance/routes.js';
import { fundsRouter } from './modules/funds/routes.js';
import { contributionsRouter } from './modules/giving/contributions.routes.js';
import { batchesRouter } from './modules/giving/batches.routes.js';
import { dashboardRouter } from './modules/dashboard/routes.js';
import { settingsRouter } from './modules/settings/routes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // Health check for the platform probe.
  app.get('/up', (_req, res) => res.json({ status: 'ok' }));

  // Tighter limit on auth to blunt credential stuffing.
  app.use('/api/auth', rateLimit({ windowMs: 60_000, max: 20 }));

  app.use('/api/auth', authRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/people', peopleRouter);
  app.use('/api/families', familiesRouter);
  app.use('/api/ministries', ministriesRouter);
  app.use('/api/attendance', attendanceRouter);
  app.use('/api/funds', fundsRouter);
  app.use('/api/contributions', contributionsRouter);
  app.use('/api/batches', batchesRouter);
  // Remaining routers (sermons, events, messages, team, activity read) mount
  // here following the same pattern as people/routes.ts.

  app.use(errorHandler);
  return app;
}
