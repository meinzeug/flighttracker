import express from 'express';
import path from 'node:path';

import { resolveAircraftMedia } from './aircraft-media-service.js';
import { ROOT_DIR, SERVER_HOST, SERVER_PORT } from './config.js';
import {
  bootstrapAdmin,
  buildSessionResponse,
  clearSessionCookie,
  issueSessionCookie,
  readSessionFromRequest,
  verifyCredentials,
} from './auth-service.js';
import { buildDashboardSnapshot } from './dashboard-service.js';
import { getRecentTrack, startBackgroundTracking } from './live-service.js';
import { warmupMetadata } from './metadata-service.js';
import {
  captureSupportOrder,
  createSupportOrder,
  getPayPalPublicConfig,
} from './paypal-service.js';
import { getPublicMapFeatures } from './public-data-service.js';
import { getTrackingStats } from './tracking-store.js';

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
  response.json({ ok: true, service: 'whatsupp-server' });
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

app.get('/api/live/track/:icao24', requireSession, async (request, response) => {
  try {
    const points = await getRecentTrack(request.params.icao24, {
      limit: request.query.limit,
    });
    response.json({
      icao24: String(request.params.icao24 ?? '').toLowerCase(),
      points,
    });
  } catch (error) {
    response.status(502).json({
      error: error instanceof Error ? error.message : 'Unknown live track failure',
    });
  }
});

app.get('/api/aircraft/media', requireSession, async (request, response) => {
  try {
    const media = await resolveAircraftMedia({
      typecode: request.query.typecode,
      typeFamily: request.query.typeFamily,
      manufacturerName: request.query.manufacturerName,
      model: request.query.model,
      operator: request.query.operator,
      owner: request.query.owner,
    });

    response.json({ media });
  } catch (error) {
    response.status(502).json({
      error: error instanceof Error ? error.message : 'Aircraft media lookup failed',
    });
  }
});

app.get('/api/tracking/status', requireSession, async (_request, response) => {
  try {
    const tracking = await getTrackingStats({ objectType: 'aircraft' });
    response.json({ ok: true, tracking });
  } catch (error) {
    response.status(502).json({
      error: error instanceof Error ? error.message : 'Tracking status failed',
    });
  }
});

app.get('/api/public/features', requireSession, async (request, response) => {
  try {
    const layers = String(request.query.layers ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    const features = await getPublicMapFeatures({
      layers,
      bounds: {
        west: request.query.west,
        south: request.query.south,
        east: request.query.east,
        north: request.query.north,
        zoom: request.query.zoom,
      },
    });

    response.json(features);
  } catch (error) {
    response.status(502).json({
      error: error instanceof Error ? error.message : 'Public feature lookup failed',
    });
  }
});

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(ROOT_DIR, 'dist')));
}

app.listen(SERVER_PORT, SERVER_HOST, () => {
  warmupMetadata();
  startBackgroundTracking().catch((error) => {
    console.error('background tracking bootstrap failed', error);
  });
  console.log(`whatsupp server listening on http://${SERVER_HOST}:${SERVER_PORT}`);
});
