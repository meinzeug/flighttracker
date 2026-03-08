import {
  PAYPAL_CLIENT_ID,
  PAYPAL_CLIENT_SECRET,
  PAYPAL_CURRENCY,
  PAYPAL_ENV,
  PAYPAL_SUPPORT_AMOUNT,
} from './config.js';

const PAYPAL_API_BASE =
  PAYPAL_ENV === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';

let cachedAccessToken = null;
let cachedAccessTokenExpiresAt = 0;

function paypalEnabled() {
  return Boolean(PAYPAL_CLIENT_ID && PAYPAL_CLIENT_SECRET);
}

async function fetchPayPalAccessToken() {
  if (!paypalEnabled()) {
    throw new Error('PayPal ist nicht konfiguriert.');
  }

  if (cachedAccessToken && cachedAccessTokenExpiresAt > Date.now() + 60_000) {
    return cachedAccessToken;
  }

  const basicAuth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');
  const response = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`PayPal OAuth fehlgeschlagen: ${details}`);
  }

  const payload = await response.json();
  cachedAccessToken = payload.access_token;
  cachedAccessTokenExpiresAt = Date.now() + Number(payload.expires_in ?? 0) * 1000;
  return cachedAccessToken;
}

async function paypalRequest(path, options = {}) {
  const accessToken = await fetchPayPalAccessToken();
  const response = await fetch(`${PAYPAL_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.message ?? 'PayPal Anfrage fehlgeschlagen.');
  }

  return payload;
}

export function getPayPalPublicConfig() {
  return {
    enabled: paypalEnabled(),
    clientId: paypalEnabled() ? PAYPAL_CLIENT_ID : null,
    currency: PAYPAL_CURRENCY,
    amount: PAYPAL_SUPPORT_AMOUNT,
    env: PAYPAL_ENV,
  };
}

export async function createSupportOrder({ username }) {
  const payload = await paypalRequest('/v2/checkout/orders', {
    method: 'POST',
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [
        {
          description: 'WhatsUpp Command Pass',
          amount: {
            currency_code: PAYPAL_CURRENCY,
            value: PAYPAL_SUPPORT_AMOUNT,
          },
          custom_id: `whatsupp-${username}`,
        },
      ],
      application_context: {
        brand_name: 'WhatsUpp',
        landing_page: 'LOGIN',
        user_action: 'PAY_NOW',
      },
    }),
  });

  return payload;
}

export async function captureSupportOrder(orderId) {
  return paypalRequest(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}
