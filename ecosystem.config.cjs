const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const openSkyCredentialsPath = path.join(os.homedir(), 'Downloads', 'credentials.json');

function loadOpenSkyCredentials() {
  const credentials = {
    clientId: process.env.OPENSKY_CLIENT_ID ?? '',
    clientSecret: process.env.OPENSKY_CLIENT_SECRET ?? '',
  };

  if ((credentials.clientId && credentials.clientSecret) || !fs.existsSync(openSkyCredentialsPath)) {
    return credentials;
  }

  try {
    const payload = JSON.parse(fs.readFileSync(openSkyCredentialsPath, 'utf8'));
    return {
      clientId: credentials.clientId || String(payload.clientId ?? '').trim(),
      clientSecret: credentials.clientSecret || String(payload.clientSecret ?? '').trim(),
    };
  } catch (error) {
    console.warn(`Failed to read OpenSky credentials from ${openSkyCredentialsPath}:`, error.message);
    return credentials;
  }
}

const openSkyCredentials = loadOpenSkyCredentials();

module.exports = {
  apps: [
    {
      name: 'whatsupp-api',
      cwd: __dirname,
      script: './server/index.js',
      interpreter: 'node',
      env: {
        NODE_ENV: 'development',
        SERVER_HOST: '0.0.0.0',
        SERVER_PORT: '23670',
        OPENSKY_AUTH_URL: 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token',
        OPENSKY_CLIENT_ID: openSkyCredentials.clientId,
        OPENSKY_CLIENT_SECRET: openSkyCredentials.clientSecret,
      },
      time: true,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
    },
    {
      name: 'whatsupp-web',
      cwd: __dirname,
      script: './node_modules/vite/bin/vite.js',
      interpreter: 'node',
      args: '--host 0.0.0.0 --port 23666 --strictPort',
      env: {
        NODE_ENV: 'development',
        API_PROXY_TARGET: 'http://127.0.0.1:23670',
      },
      time: true,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
    },
  ],
};
