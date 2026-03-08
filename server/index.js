import express from 'express';
import path from 'node:path';

import { ROOT_DIR, SERVER_PORT } from './config.js';
import {
  bootstrapAdmin,
  buildSessionResponse,
  clearSessionCookie,
  issueSessionCookie,
  readSessionFromRequest,
  verifyCredentials,
} from './auth-service.js';
import { buildDashboardSnapshot } from './dashboard-service.js';
import { warmupMetadata } from './metadata-service.js';
import {
  captureSupportOrder,
  createSupportOrder,
  getPayPalPublicConfig,
} from './paypal-service.js';

const app = express();
app.use(express.json());

app.use((request, response, next) => {
  request.session = readSessionFromRequest(request);
  next();
});

function requireSession(request, response, next) {
  if (!request.session) {
    response.status(401).json({
      error: 'Nicht angemeldet.',
      ...buildSessionResponse(request),
    });
    return;
  }

  next();
}

app.get('/api/health', (_request, response) => {
  response.json({ ok: true, service: 'flighttracker-server' });
});

app.get('/api/auth/session', (request, response) => {
  response.json(buildSessionResponse(request));
});

app.post('/api/auth/bootstrap', (request, response) => {
  try {
    const account = bootstrapAdmin(request.body ?? {});
    response.setHeader('Set-Cookie', issueSessionCookie(account.username));
    response.status(201).json({
      authenticated: true,
      bootstrapRequired: false,
      user: { username: account.username },
    });
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : 'Bootstrap fehlgeschlagen.',
      ...buildSessionResponse(request),
    });
  }
});

app.post('/api/auth/login', (request, response) => {
  const account = verifyCredentials(request.body ?? {});
  if (!account) {
    response.status(401).json({
      error: 'Benutzername oder Passwort ist ungueltig.',
      ...buildSessionResponse(request),
    });
    return;
  }

  response.setHeader('Set-Cookie', issueSessionCookie(account.username));
  response.json({
    authenticated: true,
    bootstrapRequired: false,
    user: { username: account.username },
  });
});

app.post('/api/auth/logout', (_request, response) => {
  response.setHeader('Set-Cookie', clearSessionCookie());
  response.status(204).end();
});

app.get('/api/payments/config', requireSession, (_request, response) => {
  response.json(getPayPalPublicConfig());
});

app.post('/api/payments/order', requireSession, async (request, response) => {
  try {
    const order = await createSupportOrder({ username: request.session.username });
    response.status(201).json(order);
  } catch (error) {
    response.status(502).json({
      error: error instanceof Error ? error.message : 'PayPal order failed',
    });
  }
});

app.post('/api/payments/order/:orderId/capture', requireSession, async (request, response) => {
  try {
    const capture = await captureSupportOrder(request.params.orderId);
    response.json(capture);
  } catch (error) {
    response.status(502).json({
      error: error instanceof Error ? error.message : 'PayPal capture failed',
    });
  }
});

app.get('/api/live', requireSession, async (request, response) => {
  try {
    const snapshot = await buildDashboardSnapshot({ at: request.query.at ?? null });
    response.json(snapshot);
  } catch (error) {
    response.status(502).json({
      error: error instanceof Error ? error.message : 'Unknown live data failure',
    });
  }
});

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(ROOT_DIR, 'dist')));
}

app.listen(SERVER_PORT, () => {
  warmupMetadata();
  console.log(`flighttracker server listening on http://localhost:${SERVER_PORT}`);
});
