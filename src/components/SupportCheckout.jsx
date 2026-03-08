import { useEffect, useRef, useState } from 'react';

function loadPayPalSdk({ clientId, currency }) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-paypal-sdk="true"]');
    if (existing && window.paypal) {
      resolve(window.paypal);
      return;
    }

    if (existing) {
      existing.addEventListener('load', () => resolve(window.paypal), { once: true });
      existing.addEventListener('error', () => reject(new Error('PayPal SDK konnte nicht geladen werden.')), {
        once: true,
      });
      return;
    }

    const script = document.createElement('script');
    script.src =
      `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}` +
      `&currency=${encodeURIComponent(currency)}` +
      '&intent=capture&components=buttons';
    script.async = true;
    script.dataset.paypalSdk = 'true';
    script.addEventListener('load', () => resolve(window.paypal), { once: true });
    script.addEventListener('error', () => reject(new Error('PayPal SDK konnte nicht geladen werden.')), {
      once: true,
    });
    document.head.appendChild(script);
  });
}

export function SupportCheckout({ config }) {
  const containerRef = useRef(null);
  const [status, setStatus] = useState(config?.enabled ? 'sdk-loading' : 'disabled');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!config?.enabled || !containerRef.current) {
      setStatus('disabled');
      return undefined;
    }

    let cancelled = false;
    let buttons = null;

    async function mountButtons() {
      try {
        setStatus('sdk-loading');
        const paypal = await loadPayPalSdk(config);
        if (cancelled || !paypal || !containerRef.current) {
          return;
        }

        containerRef.current.innerHTML = '';
        buttons = paypal.Buttons({
          style: {
            color: 'gold',
            shape: 'pill',
            height: 44,
            label: 'paypal',
            layout: 'vertical',
          },
          createOrder: async () => {
            const response = await fetch('/api/payments/order', {
              method: 'POST',
              credentials: 'include',
            });
            const payload = await response.json();
            if (!response.ok) {
              throw new Error(payload.error ?? 'PayPal Order konnte nicht erstellt werden.');
            }

            return payload.id;
          },
          onApprove: async (data) => {
            const response = await fetch(`/api/payments/order/${encodeURIComponent(data.orderID)}/capture`, {
              method: 'POST',
              credentials: 'include',
            });
            const payload = await response.json();
            if (!response.ok) {
              throw new Error(payload.error ?? 'PayPal Zahlung konnte nicht bestaetigt werden.');
            }

            const capture = payload.purchase_units?.[0]?.payments?.captures?.[0];
            setStatus('success');
            setMessage(
              capture?.id
                ? `Zahlung bestaetigt. Capture-ID ${capture.id}`
                : 'Zahlung bestaetigt.',
            );
          },
          onError: (error) => {
            setStatus('error');
            setMessage(error instanceof Error ? error.message : 'PayPal Checkout fehlgeschlagen.');
          },
        });

        if (!buttons.isEligible()) {
          setStatus('disabled');
          setMessage('PayPal Buttons sind auf diesem Geraet aktuell nicht verfuegbar.');
          return;
        }

        await buttons.render(containerRef.current);
        if (!cancelled) {
          setStatus('ready');
          setMessage('');
        }
      } catch (error) {
        if (!cancelled) {
          setStatus('error');
          setMessage(error instanceof Error ? error.message : 'PayPal SDK konnte nicht gestartet werden.');
        }
      }
    }

    mountButtons();

    return () => {
      cancelled = true;
      if (buttons?.close) {
        buttons.close();
      }
    };
  }, [config]);

  return (
    <div className="support-checkout">
      <div className="support-checkout__meta">
        <strong>Command Pass</strong>
        <span>
          {config?.amount ?? '--'} {config?.currency ?? 'EUR'} einmalig via PayPal
        </span>
      </div>
      <div ref={containerRef} className="support-checkout__buttons" />
      {status === 'sdk-loading' ? <p className="support-checkout__message">PayPal wird geladen ...</p> : null}
      {status === 'disabled' && !config?.enabled ? (
        <p className="support-checkout__message">
          PayPal ist noch nicht konfiguriert. Lege `PAYPAL_CLIENT_ID` und `PAYPAL_CLIENT_SECRET` am Server an.
        </p>
      ) : null}
      {message ? <p className={`support-checkout__message support-checkout__message--${status}`}>{message}</p> : null}
    </div>
  );
}
