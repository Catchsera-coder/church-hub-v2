import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from './app.js';

describe('app', () => {
  const app = createApp();

  it('GET /up returns ok', async () => {
    const res = await request(app).get('/up');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('protected route requires auth', async () => {
    const res = await request(app).get('/api/people');
    expect(res.status).toBe(401);
  });

  it('message templates route requires auth', async () => {
    const res = await request(app).get('/api/message-templates');
    expect(res.status).toBe(401);
  });

  it('login rejects bad input with a validation error', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'not-an-email' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('validation');
  });
});
