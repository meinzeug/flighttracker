import express from 'express';
import path from 'node:path';

import { ROOT_DIR, SERVER_PORT } from './config.js';
import { buildDashboardSnapshot } from './dashboard-service.js';
import { warmupMetadata } from './metadata-service.js';

const app = express();

app.get('/api/health', (_request, response) => {
  response.json({ ok: true, service: 'flighttracker-server' });
});

app.get('/api/live', async (_request, response) => {
  try {
    const snapshot = await buildDashboardSnapshot();
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
