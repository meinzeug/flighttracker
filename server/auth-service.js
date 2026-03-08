import crypto from 'node:crypto';
import fs from 'node:fs';

import {
  AUTH_CONFIG_PATH,
  RUNTIME_DIR,
  SESSION_COOKIE_NAME,
  SESSION_SECRET_PATH,
  SESSION_TTL_MS,
} from './config.js';

let cachedAuthConfig = null;
let cachedSessionSecret = null;

function ensureRuntimeDir() {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
}

function createPasswordHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('base64url');
  return { salt, hash };
}

function readAuthConfig() {
  ensureRuntimeDir();

  if (cachedAuthConfig) {
    return cachedAuthConfig;
  }

  if (!fs.existsSync(AUTH_CONFIG_PATH)) {
    return null;
  }

  cachedAuthConfig = JSON.parse(fs.readFileSync(AUTH_CONFIG_PATH, 'utf8'));
  return cachedAuthConfig;
}

function writeAuthConfig(config) {
  ensureRuntimeDir();
  cachedAuthConfig = config;
  fs.writeFileSync(AUTH_CONFIG_PATH, JSON.stringify(config, null, 2));
}

function readSessionSecret() {
  ensureRuntimeDir();

  if (cachedSessionSecret) {
    return cachedSessionSecret;
  }

  if (!fs.existsSync(SESSION_SECRET_PATH)) {
    fs.writeFileSync(SESSION_SECRET_PATH, crypto.randomBytes(48).toString('base64url'));
  }

  cachedSessionSecret = fs.readFileSync(SESSION_SECRET_PATH, 'utf8').trim();
  return cachedSessionSecret;
}

function sign(value) {
  return crypto.createHmac('sha256', readSessionSecret()).update(value).digest('base64url');
}

function parseCookies(headerValue) {
  const cookies = {};
  if (!headerValue) {
    return cookies;
  }

  for (const part of headerValue.split(';')) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    cookies[key] = decodeURIComponent(value);
  }

  return cookies;
}

function safeEquals(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function authIsBootstrapped() {
  return Boolean(readAuthConfig());
}

export function bootstrapAdmin({ username, password }) {
  if (authIsBootstrapped()) {
    throw new Error('Admin-Zugang ist bereits eingerichtet.');
  }

  const normalizedUsername = String(username ?? '').trim();
  const normalizedPassword = String(password ?? '');

  if (normalizedUsername.length < 3) {
    throw new Error('Benutzername muss mindestens 3 Zeichen lang sein.');
  }

  if (normalizedPassword.length < 8) {
    throw new Error('Passwort muss mindestens 8 Zeichen lang sein.');
  }

  const passwordHash = createPasswordHash(normalizedPassword);
  writeAuthConfig({
    username: normalizedUsername,
    passwordHash: passwordHash.hash,
    passwordSalt: passwordHash.salt,
    createdAt: new Date().toISOString(),
  });

  return { username: normalizedUsername };
}

export function verifyCredentials({ username, password }) {
  const config = readAuthConfig();
  if (!config) {
    return null;
  }

  const normalizedUsername = String(username ?? '').trim();
  const normalizedPassword = String(password ?? '');

  if (normalizedUsername !== config.username) {
    return null;
  }

  const passwordHash = createPasswordHash(normalizedPassword, config.passwordSalt);
  if (!safeEquals(passwordHash.hash, config.passwordHash)) {
    return null;
  }

  return { username: config.username };
}

export function issueSessionCookie(username) {
  const payload = {
    username,
    exp: Date.now() + SESSION_TTL_MS,
  };

  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = sign(encodedPayload);
  const token = `${encodedPayload}.${signature}`;
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);

  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Strict`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict`;
}

export function readSessionFromRequest(request) {
  const cookies = parseCookies(request.headers.cookie ?? '');
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) {
    return null;
  }

  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) {
    return null;
  }

  if (!safeEquals(sign(encodedPayload), signature)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    if (!payload?.username || !payload?.exp || payload.exp < Date.now()) {
      return null;
    }

    return {
      username: payload.username,
      expiresAt: payload.exp,
    };
  } catch {
    return null;
  }
}

export function buildSessionResponse(request) {
  const session = readSessionFromRequest(request);
  return {
    authenticated: Boolean(session),
    bootstrapRequired: !authIsBootstrapped(),
    user: session ? { username: session.username } : null,
  };
}
