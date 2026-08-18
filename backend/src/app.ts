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
import { sermonsRouter } from './modules/sermons/routes.js';
import { eventsRouter } from './modules/events/routes.js';
import { messagesRouter } from './modules/messages/routes.js';
import { messageTemplatesRouter } from './modules/messages/templates.routes.js';
import { teamRouter } from './modules/team/routes.js';
import { activityRouter } from './modules/activity/routes.js';
import { dashboardRouter } from './modules/dashboard/routes.js';
import { settingsRouter } from './modules/settings/routes.js';
import { publicCheckinRouter } from './modules/checkin/public.routes.js';
import { checkinFormsRouter } from './modules/checkin/forms.routes.js';
import { exportRouter } from './modules/export/routes.js';
import { automationsRouter } from './modules/automations/routes.js';
import { vendorsRouter } from './modules/vendors/routes.js';
import { importRouter } from './modules/import/routes.js';
import { publicConsentRouter } from './modules/consent/public.routes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins, credentials: true }));
  // Import uploads (base64 Excel/CSV) can exceed the default; parse them larger
  // before the global limit applies to everything else.
  app.use('/api/import', express.json({ limit: '15mb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // Health check for the platform probe.
  app.get('/up', (_req, res) => res.json({ status: 'ok' }));

  // Tighter limit on auth to blunt credential stuffing.
  app.use('/api/auth', rateLimit({ windowMs: 60_000, max: 20 }));
  // Public self-check-in is unauthenticated — rate-limit to blunt directory scraping.
  app.use('/api/public/checkin', rateLimit({ windowMs: 60_000, max: 40 }));
  app.use('/api/public/checkin', publicCheckinRouter);
  app.use('/api/public/unsubscribe', rateLimit({ windowMs: 60_000, max: 30 }));
  app.use('/api/public/unsubscribe', publicConsentRouter);

  app.use('/api/auth', authRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/people', peopleRouter);
  app.use('/api/families', familiesRouter);
  app.use('/api/ministries', ministriesRouter);
  app.use('/api/attendance', attendanceRouter);
  app.use('/api/checkin-forms', checkinFormsRouter);
  app.use('/api/export', exportRouter);
  app.use('/api/automations', automationsRouter);
  app.use('/api/vendors', vendorsRouter);
  app.use('/api/import', importRouter);
  app.use('/api/funds', fundsRouter);
  app.use('/api/contributions', contributionsRouter);
  app.use('/api/batches', batchesRouter);
  app.use('/api/sermons', sermonsRouter);
  app.use('/api/events', eventsRouter);
  app.use('/api/messages', messagesRouter);
  app.use('/api/message-templates', messageTemplatesRouter);
  app.use('/api/team', teamRouter);
  app.use('/api/activity', activityRouter);

  app.use(errorHandler);
  return app;
}
