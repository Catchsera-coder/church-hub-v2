import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { errorHandler } from './http/errors.js';
import { authRouter } from './modules/auth/routes.js';
import { peopleRouter } from './modules/people/routes.js';
import { contributionsRouter } from './modules/giving/contributions.routes.js';
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
  app.use('/api/contributions', contributionsRouter);
  // Further module routers (families, ministries, attendance, funds, batches,
  // sermons, events, messages, team, activity) mount here following the same
  // pattern as people/routes.ts.

  app.use(errorHandler);
  return app;
}
