import {
  OPENSKY_AUTH_URL,
  OPENSKY_CLIENT_ID,
  OPENSKY_CLIENT_SECRET,
  OPENSKY_TOKEN,
} from './config.js';

const OPENSKY_USER_AGENT = 'whatsupp-dashboard/1.0 (+https://github.com/meinzeug/whatsupp)';
const TOKEN_REFRESH_SKEW_MS = 60_000;

const tokenCache = {
  accessToken: OPENSKY_TOKEN || null,
  expiresAt: OPENSKY_TOKEN ? Number.POSITIVE_INFINITY : 0,
  inFlight: null,
};

function hasOAuthClientCredentials() {
  return Boolean(OPENSKY_CLIENT_ID && OPENSKY_CLIENT_SECRET);
}

function toPositiveNumber(value, fallbackValue) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackValue;
}

async function requestAccessToken() {
  if (!hasOAuthClientCredentials()) {
    return null;
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: OPENSKY_CLIENT_ID,
    client_secret: OPENSKY_CLIENT_SECRET,
  });

  const response = await fetch(OPENSKY_AUTH_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': OPENSKY_USER_AGENT,
    },
    body,
  });

  if (!response.ok) {
    const statusText = response.statusText?.trim();
    throw new Error(`OpenSky token request failed with ${response.status}${statusText ? ` ${statusText}` : ''}`);
  }

  const payload = await response.json();
  if (!payload?.access_token) {
    throw new Error('OpenSky token response did not include an access token.');
  }

  tokenCache.accessToken = payload.access_token;
  tokenCache.expiresAt = Date.now() + toPositiveNumber(payload.expires_in, 1800) * 1000;
  return tokenCache.accessToken;
}

export function buildOpenSkyHeaders(accessToken = null) {
  const headers = {
    Accept: 'application/json',
    'User-Agent': OPENSKY_USER_AGENT,
  };

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  return headers;
}

export function canRefreshOpenSkyAccessToken() {
  return !OPENSKY_TOKEN && hasOAuthClientCredentials();
}

export function hasConfiguredOpenSkyAccess() {
  return Boolean(OPENSKY_TOKEN || hasOAuthClientCredentials());
}

export function invalidateOpenSkyAccessToken() {
  if (OPENSKY_TOKEN) {
    return;
  }

  tokenCache.accessToken = null;
  tokenCache.expiresAt = 0;
}

export async function getOpenSkyAccessToken() {
  if (OPENSKY_TOKEN) {
    return OPENSKY_TOKEN;
  }

  if (!hasOAuthClientCredentials()) {
    return null;
  }

  if (tokenCache.accessToken && Date.now() < tokenCache.expiresAt - TOKEN_REFRESH_SKEW_MS) {
    return tokenCache.accessToken;
  }

  if (!tokenCache.inFlight) {
    tokenCache.inFlight = requestAccessToken().finally(() => {
      tokenCache.inFlight = null;
    });
  }

  return tokenCache.inFlight;
}
