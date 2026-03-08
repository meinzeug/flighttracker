import {
  startTransition,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react';

import { RadarMap } from './components/RadarMap';
import { RadarScope } from './components/RadarScope';
import { SupportCheckout } from './components/SupportCheckout';
import { getSegmentColor } from './lib/segments';

const SAVED_VIEWS_KEY = 'flighttracker.saved-views.v2';
const WATCH_TERMS_KEY = 'flighttracker.watch-terms.v2';

function formatCompactNumber(value, suffix = '') {
  return (
    new Intl.NumberFormat('de-DE', {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(Math.max(0, value ?? 0)) + suffix
  );
}

function formatInteger(value, suffix = '') {
  return new Intl.NumberFormat('de-DE').format(Math.max(0, value ?? 0)) + suffix;
}

function formatTime(value) {
  if (!value) {
    return '--:--:--';
  }

  return new Date(value).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatAltitude(valueMeters) {
  if (typeof valueMeters !== 'number') {
    return 'n/a';
  }

  return `${formatInteger(Math.round(valueMeters * 3.28084))} ft`;
}

function formatSpeed(valueMps) {
  if (typeof valueMps !== 'number') {
    return 'n/a';
  }

  return `${formatInteger(Math.round(valueMps * 1.94384))} kt`;
}

function formatHeading(valueDeg) {
  if (typeof valueDeg !== 'number') {
    return 'n/a';
  }

  return `${Math.round(valueDeg)} deg`;
}

function formatCoordinate(value, positiveLabel, negativeLabel) {
  if (typeof value !== 'number') {
    return 'n/a';
  }

  const suffix = value >= 0 ? positiveLabel : negativeLabel;
  return `${Math.abs(value).toFixed(2)} ${suffix}`;
}

function primaryLabel(entry) {
  return entry?.callsign ?? entry?.registration ?? entry?.icao24 ?? 'Unbekannt';
}

function secondaryLabel(entry) {
  return [entry?.typecode ?? entry?.typeFamily, entry?.operator ?? entry?.owner]
    .filter(Boolean)
    .join(' · ');
}

function loadLocalState(key, fallback) {
  if (typeof window === 'undefined') {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function persistLocalState(key, value) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(key, JSON.stringify(value));
}

function toggleValue(values, value) {
  return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];
}

function groupByAircraft(items, keySelector, labelSelector, limit = 10) {
  const buckets = new Map();

  for (const item of items) {
    const key = keySelector(item);
    if (!key) {
      continue;
    }

    const current = buckets.get(key) ?? {
      key,
      label: labelSelector(item, key),
      count: 0,
      fuelLitersPerHour: 0,
      co2KgPerHour: 0,
    };

    current.count += 1;
    current.fuelLitersPerHour += item.fuelLitersPerHour ?? 0;
    current.co2KgPerHour += item.co2KgPerHour ?? 0;
    buckets.set(key, current);
  }

  return [...buckets.values()]
    .sort((left, right) => right.co2KgPerHour - left.co2KgPerHour || right.count - left.count)
    .slice(0, limit);
}

function normalizeWatchTerm(value) {
  return String(value ?? '').trim().toLowerCase();
}

function aircraftSearchBlob(entry) {
  return [
    entry.callsign,
    entry.registration,
    entry.icao24,
    entry.model,
    entry.typecode,
    entry.operator,
    entry.owner,
    entry.operationSegment,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function matchesWatchTerm(entry, term) {
  return aircraftSearchBlob(entry).includes(term);
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function FilterGroup({ title, values, selected, onToggle }) {
  return (
    <section className="filter-group">
      <div className="section-label">{title}</div>
      <div className="chip-list">
        {values.map((value) => {
          const active = selected.includes(value);
          return (
            <button
              type="button"
              key={value}
              className={`chip ${active ? 'is-active' : ''}`}
              style={active ? { '--chip-color': getSegmentColor(value) } : undefined}
              onClick={() => onToggle(value)}
            >
              {value}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function MetricCard({ eyebrow, value, caption, tone }) {
  return (
    <article className={`metric-card metric-card--${tone}`}>
      <span className="metric-card__eyebrow">{eyebrow}</span>
      <strong className="metric-card__value">{value}</strong>
      <span className="metric-card__caption">{caption}</span>
    </article>
  );
}

function BreakdownPanel({ title, rows }) {
  return (
    <section className="panel">
      <div className="panel__header">
        <h3>{title}</h3>
      </div>
      <div className="list-grid">
        {rows.map((row) => (
          <div key={row.key} className="list-row">
            <div>
              <strong>{row.label}</strong>
              <span>{formatInteger(row.count)} Ziele</span>
            </div>
            <div className="list-row__metric">
              <strong>{formatCompactNumber(row.co2KgPerHour, ' kg')}</strong>
              <span>CO2 / h</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function FlightDeckPanel({ rows, selectedAircraftIcao24, onSelectAircraft, onQuickWatch }) {
  return (
    <section className="panel">
      <div className="panel__header">
        <h3>Flight Deck</h3>
        <span>kritischste Ziele im aktuellen Filter</span>
      </div>
      <div className="flight-deck">
        {rows.map((entry) => {
          const active = entry.icao24 === selectedAircraftIcao24;
          return (
            <div key={entry.icao24} className={`flight-row ${active ? 'is-active' : ''}`}>
              <button
                type="button"
                className="flight-row__select"
                onClick={() => onSelectAircraft(entry.icao24)}
              >
                <div className="flight-row__title">
                  <strong>{primaryLabel(entry)}</strong>
                  <span>{secondaryLabel(entry) || entry.operationSegment}</span>
                </div>
                <div className="flight-row__meta">
                  <span>{entry.operationSegment}</span>
                  <strong>{formatCompactNumber(entry.co2KgPerHour, ' kg')}</strong>
                </div>
              </button>
              <span className="flight-row__action">
                <button
                  type="button"
                  className="mini-button"
                  onClick={() => onQuickWatch(primaryLabel(entry))}
                >
                  Watch
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SelectedFlightCard({ aircraft, onWatch, onReturnToLive }) {
  if (!aircraft) {
    return (
      <section className="panel panel--selected">
        <div className="panel__header">
          <h3>Zielauswahl</h3>
        </div>
        <p className="panel-copy">Tippe auf ein Flugzeug oder waehle einen Eintrag im Flight Deck.</p>
      </section>
    );
  }

  return (
    <section className="panel panel--selected">
      <div className="panel__header">
        <div>
          <h3>{primaryLabel(aircraft)}</h3>
          <span>{secondaryLabel(aircraft) || aircraft.originCountry}</span>
        </div>
        <span className="status-tag">{aircraft.operationSegment}</span>
      </div>
      <div className="selected-grid">
        <div>
          <span className="detail-label">Hoehe</span>
          <strong>{formatAltitude(aircraft.geoAltitudeM ?? aircraft.baroAltitudeM)}</strong>
        </div>
        <div>
          <span className="detail-label">Speed</span>
          <strong>{formatSpeed(aircraft.velocityMps)}</strong>
        </div>
        <div>
          <span className="detail-label">Kurs</span>
          <strong>{formatHeading(aircraft.trackDeg)}</strong>
        </div>
        <div>
          <span className="detail-label">Engine</span>
          <strong>{aircraft.engineType ?? 'n/a'}</strong>
        </div>
        <div>
          <span className="detail-label">Fuel / h</span>
          <strong>{formatCompactNumber(aircraft.fuelLitersPerHour, ' L')}</strong>
        </div>
        <div>
          <span className="detail-label">CO2 / h</span>
          <strong>{formatCompactNumber(aircraft.co2KgPerHour, ' kg')}</strong>
        </div>
      </div>
      <div className="selected-position">
        <span>
          {formatCoordinate(aircraft.latitude, 'N', 'S')} / {formatCoordinate(aircraft.longitude, 'E', 'W')}
        </span>
      </div>
      <div className="button-row">
        <button type="button" className="action-button" onClick={() => onWatch(primaryLabel(aircraft))}>
          Ziel watchen
        </button>
        <button type="button" className="ghost-button" onClick={onReturnToLive}>
          Zurueck zu Live
        </button>
      </div>
    </section>
  );
}

function AccessScreen({
  authBusy,
  authError,
  bootstrapRequired,
  loginForm,
  onSubmit,
  onUpdate,
}) {
  return (
    <main className="access-shell">
      <section className="access-card">
        <span className="eyebrow">FlightTracker Command Grid</span>
        <h1>Souveraene Luftlage. Live auf jedem Geraet.</h1>
        <p>
          Mobile-first Radarprodukt fuer lokale Deployments, sensible Lagebilder und eine unabhaengige
          Flugbeobachtung ohne fremde Plattformbindung.
        </p>
        <form className="access-form" onSubmit={onSubmit}>
          <label>
            <span>Benutzername</span>
            <input
              type="text"
              autoComplete="username"
              value={loginForm.username}
              onChange={(event) => onUpdate('username', event.target.value)}
              placeholder="operations"
            />
          </label>
          <label>
            <span>Passwort</span>
            <input
              type="password"
              autoComplete={bootstrapRequired ? 'new-password' : 'current-password'}
              value={loginForm.password}
              onChange={(event) => onUpdate('password', event.target.value)}
              placeholder="mindestens 10 Zeichen"
            />
          </label>
          <button type="submit" className="action-button action-button--primary" disabled={authBusy}>
            {authBusy
              ? 'Bitte warten ...'
              : bootstrapRequired
                ? 'Admin-Zugang einrichten'
                : 'Anmelden'}
          </button>
        </form>
        {authError ? <div className="inline-state inline-state--error">{authError}</div> : null}
        <div className="access-footnotes">
          <div>
            <strong>Mobile first</strong>
            <span>kompakt auf Telefon, taktisch auf Tablet, vollstaendig am Desktop</span>
          </div>
          <div>
            <strong>Geschuetzt</strong>
            <span>Live-API nur nach Login, Session als HttpOnly-Cookie</span>
          </div>
          <div>
            <strong>Produktlinie</strong>
            <span>Radar, Watchlists, Playback, Support-Checkout und lokale Kiosk-Deployments</span>
          </div>
        </div>
      </section>
    </main>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [bootstrapRequired, setBootstrapRequired] = useState(false);
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [segmentFilters, setSegmentFilters] = useState([]);
  const [emitterFilters, setEmitterFilters] = useState([]);
  const [engineFilters, setEngineFilters] = useState([]);
  const [radarCenter, setRadarCenter] = useState({ lat: 18, lon: 11.5 });
  const [selectedFrame, setSelectedFrame] = useState(null);
  const [savedViews, setSavedViews] = useState(() => loadLocalState(SAVED_VIEWS_KEY, []));
  const [presetName, setPresetName] = useState('');
  const [watchTerms, setWatchTerms] = useState(() => loadLocalState(WATCH_TERMS_KEY, []));
  const [watchInput, setWatchInput] = useState('');
  const [alertEvents, setAlertEvents] = useState([]);
  const [selectedAircraftIcao24, setSelectedAircraftIcao24] = useState(null);
  const [paymentConfig, setPaymentConfig] = useState(null);
  const seenWatchTermsRef = useRef(new Set());

  const deferredSearch = useDeferredValue(search);

  const refreshSession = useEffectEvent(async () => {
    try {
      const response = await fetch('/api/auth/session', { credentials: 'include' });
      const payload = await response.json();
      setBootstrapRequired(Boolean(payload.bootstrapRequired));
      setSession(payload.authenticated ? payload.user : null);
      setAuthError(null);
    } catch (requestError) {
      setAuthError(requestError instanceof Error ? requestError.message : 'Session konnte nicht geladen werden.');
      setSession(null);
    } finally {
      setAuthLoading(false);
    }
  });

  const refreshSnapshot = useEffectEvent(async ({ silent = false } = {}) => {
    if (!session) {
      return;
    }

    if (!silent) {
      setLoading(true);
    }

    try {
      const response = await fetch(
        selectedFrame ? `/api/live?at=${encodeURIComponent(selectedFrame)}` : '/api/live',
        { credentials: 'include' },
      );

      if (response.status === 401) {
        setSession(null);
        setSnapshot(null);
        setBootstrapRequired(false);
        return;
      }

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? `API antwortet mit ${response.status}`);
      }

      const payload = await response.json();
      startTransition(() => {
        setSnapshot(payload);
        setError(null);
      });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unbekannter Fehler');
    } finally {
      setLoading(false);
    }
  });

  const refreshPayments = useEffectEvent(async () => {
    if (!session) {
      setPaymentConfig(null);
      return;
    }

    try {
      const response = await fetch('/api/payments/config', { credentials: 'include' });
      if (!response.ok) {
        throw new Error('Payments konnten nicht geladen werden.');
      }

      setPaymentConfig(await response.json());
    } catch {
      setPaymentConfig(null);
    }
  });

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    if (!session) {
      setSnapshot(null);
      setPaymentConfig(null);
      return;
    }

    refreshSnapshot();
    refreshPayments();
  }, [refreshPayments, refreshSnapshot, selectedFrame, session]);

  useEffect(() => {
    if (!session || selectedFrame) {
      return undefined;
    }

    const timer = window.setInterval(() => refreshSnapshot({ silent: true }), 20_000);
    return () => window.clearInterval(timer);
  }, [refreshSnapshot, selectedFrame, session]);

  useEffect(() => {
    persistLocalState(SAVED_VIEWS_KEY, savedViews);
  }, [savedViews]);

  useEffect(() => {
    persistLocalState(WATCH_TERMS_KEY, watchTerms);
  }, [watchTerms]);

  useEffect(() => {
    if (!snapshot || snapshot.mode !== 'live') {
      return;
    }

    const matchingTerms = new Map();
    for (const term of watchTerms) {
      const hits = snapshot.aircraft.filter((entry) => matchesWatchTerm(entry, term));
      if (hits.length) {
        matchingTerms.set(term, hits);
      }
    }

    const nextSeen = new Set(matchingTerms.keys());
    const newEvents = [...matchingTerms.entries()]
      .filter(([term]) => !seenWatchTermsRef.current.has(term))
      .map(([term, hits]) => ({
        id: makeId('alert'),
        term,
        observedAt: snapshot.observedAt,
        hits: hits.slice(0, 3).map((entry) => primaryLabel(entry)),
      }));

    if (newEvents.length) {
      setAlertEvents((current) => [...newEvents, ...current].slice(0, 10));

      if (typeof window !== 'undefined' && 'Notification' in window && window.Notification.permission === 'granted') {
        for (const event of newEvents) {
          new window.Notification(`FlightTracker Alert: ${event.term}`, {
            body: event.hits.length ? `Treffer: ${event.hits.join(', ')}` : 'Neue Treffer im Live-Feed',
          });
        }
      }
    }

    seenWatchTermsRef.current = nextSeen;
  }, [snapshot, watchTerms]);

  const query = deferredSearch.trim().toLowerCase();
  const allAircraft = snapshot?.aircraft ?? [];
  const filteredAircraft = allAircraft.filter((entry) => {
    const segmentMatch = !segmentFilters.length || segmentFilters.includes(entry.operationSegment);
    const emitterMatch = !emitterFilters.length || emitterFilters.includes(entry.emitterCategory);
    const engineMatch = !engineFilters.length || engineFilters.includes(entry.engineType);
    const searchMatch = !query || aircraftSearchBlob(entry).includes(query);
    return segmentMatch && emitterMatch && engineMatch && searchMatch;
  });

  const filteredTotals = filteredAircraft.reduce(
    (accumulator, entry) => {
      accumulator.fuelLitersPerHour += entry.fuelLitersPerHour ?? 0;
      accumulator.co2KgPerHour += entry.co2KgPerHour ?? 0;
      return accumulator;
    },
    { fuelLitersPerHour: 0, co2KgPerHour: 0 },
  );

  const trafficRows = useMemo(
    () => [...filteredAircraft].sort((left, right) => right.co2KgPerHour - left.co2KgPerHour).slice(0, 18),
    [filteredAircraft],
  );

  const selectedAircraft = useMemo(
    () => filteredAircraft.find((entry) => entry.icao24 === selectedAircraftIcao24) ?? trafficRows[0] ?? null,
    [filteredAircraft, selectedAircraftIcao24, trafficRows],
  );

  useEffect(() => {
    const nextIcao24 = trafficRows[0]?.icao24 ?? null;
    if (!selectedAircraftIcao24 && nextIcao24) {
      setSelectedAircraftIcao24(nextIcao24);
      return;
    }

    if (selectedAircraftIcao24 && !filteredAircraft.some((entry) => entry.icao24 === selectedAircraftIcao24)) {
      setSelectedAircraftIcao24(nextIcao24);
    }
  }, [filteredAircraft, selectedAircraftIcao24, trafficRows]);

  const bySegment = useMemo(
    () => groupByAircraft(filteredAircraft, (entry) => entry.operationSegment, (entry) => entry.operationSegment),
    [filteredAircraft],
  );
  const byType = useMemo(
    () =>
      groupByAircraft(
        filteredAircraft,
        (entry) => entry.typecode ?? entry.model ?? entry.typeFamily,
        (entry, key) => (entry.typecode && entry.model ? `${entry.typecode} · ${entry.model}` : key),
      ),
    [filteredAircraft],
  );

  const playbackFrames = snapshot?.playback?.frames ?? [];
  const effectiveSelectedFrame = snapshot?.playback?.selectedObservedAt ?? selectedFrame;
  const playbackIndex = effectiveSelectedFrame
    ? Math.max(
        playbackFrames.findIndex((frame) => frame.observedAt === effectiveSelectedFrame),
        0,
      )
    : Math.max(playbackFrames.length - 1, 0);

  function saveCurrentView() {
    const name = presetName.trim() || `View ${savedViews.length + 1}`;
    setSavedViews((current) => [
      {
        id: makeId('view'),
        name,
        search,
        segmentFilters,
        emitterFilters,
        engineFilters,
        savedAt: new Date().toISOString(),
      },
      ...current,
    ].slice(0, 10));
    setPresetName('');
  }

  function applySavedView(view) {
    setSearch(view.search ?? '');
    setSegmentFilters(view.segmentFilters ?? []);
    setEmitterFilters(view.emitterFilters ?? []);
    setEngineFilters(view.engineFilters ?? []);
  }

  function addWatchTerm(value) {
    const normalized = normalizeWatchTerm(value);
    if (!normalized) {
      return;
    }

    setWatchTerms((current) => (current.includes(normalized) ? current : [normalized, ...current].slice(0, 12)));
    setWatchInput('');
  }

  async function requestNotifications() {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return;
    }

    if (window.Notification.permission === 'default') {
      await window.Notification.requestPermission();
    }
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    setAuthBusy(true);

    try {
      const response = await fetch(bootstrapRequired ? '/api/auth/bootstrap' : '/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(loginForm),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Anmeldung fehlgeschlagen.');
      }

      setSession(payload.user ?? null);
      setBootstrapRequired(false);
      setAuthError(null);
      setLoginForm({ username: '', password: '' });
    } catch (requestError) {
      setAuthError(requestError instanceof Error ? requestError.message : 'Anmeldung fehlgeschlagen.');
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    });

    setSession(null);
    setSnapshot(null);
    setSelectedFrame(null);
    setError(null);
  }

  if (authLoading) {
    return <div className="floating-state">Zugang wird geprueft ...</div>;
  }

  if (!session) {
    return (
      <AccessScreen
        authBusy={authBusy}
        authError={authError}
        bootstrapRequired={bootstrapRequired}
        loginForm={loginForm}
        onSubmit={handleAuthSubmit}
        onUpdate={(key, value) => setLoginForm((current) => ({ ...current, [key]: value }))}
      />
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar panel">
        <div className="topbar__copy">
          <span className="eyebrow">FlightTracker Command Grid</span>
          <h1>Souveraene Luftlage statt Plattform-Abhaengigkeit.</h1>
          <p>
            Mobile-first Radarprodukt mit Login, Live-Fluglage, Emissionsanalyse, Watchlists,
            Playback und einem klaren Produktpfad fuer lokale Kontrollraeume und Kiosk-Deployments.
          </p>
        </div>
        <div className="topbar__actions">
          <div className="status-ribbon">
            <span className={`live-pill ${snapshot?.stale ? 'is-stale' : 'is-live'}`}>
              {snapshot?.mode === 'playback' ? 'Playback' : snapshot?.stale ? 'Stale Snapshot' : 'Live Grid'}
            </span>
            <span className="status-pill">User {session.username}</span>
            <span className="status-pill">Stand {formatTime(snapshot?.observedAt)}</span>
          </div>
          <div className="search-box">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Callsign, Typ, Betreiber, Registrierung ..."
            />
          </div>
          <div className="button-row">
            <button type="button" className="ghost-button" onClick={() => refreshSnapshot()}>
              Refresh
            </button>
            <button type="button" className="ghost-button" onClick={handleLogout}>
              Logout
            </button>
          </div>
        </div>
      </header>

      <section className="metrics-grid">
        <MetricCard
          eyebrow="Aktive Ziele"
          value={snapshot ? formatInteger(filteredAircraft.length) : '...'}
          caption="im aktuellen Filter"
          tone="lime"
        />
        <MetricCard
          eyebrow="Kerosin / Stunde"
          value={snapshot ? `${formatCompactNumber(filteredTotals.fuelLitersPerHour)} L` : '...'}
          caption="momentane Verbrauchsschaetzung"
          tone="amber"
        />
        <MetricCard
          eyebrow="CO2 / Stunde"
          value={snapshot ? `${formatCompactNumber(filteredTotals.co2KgPerHour)} kg` : '...'}
          caption="direkte Verbrennungsemissionen"
          tone="red"
        />
        <MetricCard
          eyebrow="Typauflosung"
          value={snapshot ? `${Math.round((snapshot.metadata.coverageRatio ?? 0) * 100)} %` : '...'}
          caption="mit Typcode oder Modell"
          tone="blue"
        />
      </section>

      <section className="product-grid">
        <article className="panel panel--map-stage">
          <div className="panel__header">
            <div>
              <h2>Live Radar</h2>
              <span>{formatInteger(filteredAircraft.length)} Ziele sichtbar</span>
            </div>
            <div className="stage-badges">
              <span className="status-tag">Center {radarCenter.lat.toFixed(1)} / {radarCenter.lon.toFixed(1)}</span>
              <span className="status-tag">Tippen zum Tracken</span>
            </div>
          </div>
          <RadarMap
            aircraft={filteredAircraft}
            onCenterChange={setRadarCenter}
            selectedAircraftIcao24={selectedAircraftIcao24}
            onSelectAircraft={setSelectedAircraftIcao24}
          />
          <div className="map-footer">
            <div className="chip-list chip-list--legend">
              {(snapshot?.filters?.segments ?? []).slice(0, 6).map((segment) => (
                <span
                  key={segment}
                  className="legend-chip"
                  style={{ '--legend-color': getSegmentColor(segment) }}
                >
                  {segment}
                </span>
              ))}
            </div>
            <span className="map-footer__hint">Canvas-Flugdarstellung, Live-Refresh alle 20 Sekunden</span>
          </div>
        </article>

        <aside className="stack-column">
          <SelectedFlightCard
            aircraft={selectedAircraft}
            onWatch={addWatchTerm}
            onReturnToLive={() => setSelectedFrame(null)}
          />

          <section className="panel">
            <div className="panel__header">
              <h3>Scope</h3>
              <span>4.000 km um den Kartenmittelpunkt</span>
            </div>
            <RadarScope aircraft={filteredAircraft} center={radarCenter} />
          </section>

          <section className="panel">
            <div className="panel__header">
              <h3>Playback & Views</h3>
              <button type="button" className="mini-button" onClick={() => setSelectedFrame(null)}>
                Live
              </button>
            </div>
            <div className="section-label">Global Playback</div>
            <input
              type="range"
              className="timeline-range"
              min="0"
              max={Math.max(playbackFrames.length - 1, 0)}
              value={playbackIndex}
              disabled={playbackFrames.length < 2}
              onChange={(event) => {
                const frame = playbackFrames[Number(event.target.value)];
                if (frame) {
                  setSelectedFrame(frame.observedAt);
                }
              }}
            />
            <div className="playback-meta">
              <span>{playbackFrames.length ? `${playbackFrames.length} Frames gepuffert` : 'noch kein Verlauf'}</span>
              <strong>{formatTime(snapshot?.observedAt)}</strong>
            </div>
            <div className="section-label">Saved View</div>
            <div className="inline-form">
              <input
                type="text"
                value={presetName}
                onChange={(event) => setPresetName(event.target.value)}
                placeholder="Name fuer aktuellen Filterzustand"
              />
              <button type="button" className="action-button" onClick={saveCurrentView}>
                Sichern
              </button>
            </div>
            <div className="saved-list">
              {savedViews.map((view) => (
                <div key={view.id} className="saved-item">
                  <button type="button" className="mini-button" onClick={() => applySavedView(view)}>
                    Laden
                  </button>
                  <div>
                    <strong>{view.name}</strong>
                    <span>{new Date(view.savedAt).toLocaleString('de-DE')}</span>
                  </div>
                  <button
                    type="button"
                    className="mini-button mini-button--danger"
                    onClick={() => setSavedViews((current) => current.filter((entry) => entry.id !== view.id))}
                  >
                    X
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel__header">
              <h3>Watchlist</h3>
              <button type="button" className="mini-button" onClick={requestNotifications}>
                Browser Alerts
              </button>
            </div>
            <div className="inline-form">
              <input
                type="text"
                value={watchInput}
                onChange={(event) => setWatchInput(event.target.value)}
                placeholder="Callsign, Registrierung, ICAO24, Typ ..."
              />
              <button type="button" className="action-button" onClick={() => addWatchTerm(watchInput)}>
                Add
              </button>
            </div>
            <div className="chip-list">
              {watchTerms.map((term) => (
                <button
                  type="button"
                  key={term}
                  className="chip is-active"
                  style={{ '--chip-color': '#ffd166' }}
                  onClick={() => setWatchTerms((current) => current.filter((entry) => entry !== term))}
                >
                  {term}
                </button>
              ))}
            </div>
            <div className="alert-feed">
              {alertEvents.map((event) => (
                <div key={event.id} className="alert-item">
                  <strong>{event.term}</strong>
                  <span>{event.hits.join(', ')}</span>
                  <small>{new Date(event.observedAt).toLocaleString('de-DE')}</small>
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel__header">
              <h3>Support & Umsatz</h3>
              <span>PayPal Command Pass</span>
            </div>
            <p className="panel-copy">
              Monetarisierung ohne Datenverkauf: direkter Support fuer Betrieb, Datenpflege und lokale Deployments.
            </p>
            <SupportCheckout config={paymentConfig} />
          </section>

          <section className="panel">
            <div className="panel__header">
              <h3>Filter</h3>
            </div>
            {snapshot ? (
              <>
                <FilterGroup
                  title="Betriebssegment"
                  values={snapshot.filters.segments}
                  selected={segmentFilters}
                  onToggle={(value) => setSegmentFilters((current) => toggleValue(current, value))}
                />
                <FilterGroup
                  title="Emitter-Kategorie"
                  values={snapshot.filters.emitterCategories}
                  selected={emitterFilters}
                  onToggle={(value) => setEmitterFilters((current) => toggleValue(current, value))}
                />
                <FilterGroup
                  title="Antrieb"
                  values={snapshot.filters.engineTypes}
                  selected={engineFilters}
                  onToggle={(value) => setEngineFilters((current) => toggleValue(current, value))}
                />
              </>
            ) : null}
          </section>
        </aside>
      </section>

      <section className="analytics-grid">
        <BreakdownPanel title="Emissionen nach Segment" rows={bySegment} />
        <BreakdownPanel title="Top Flugzeugtypen" rows={byType} />
        <FlightDeckPanel
          rows={trafficRows}
          selectedAircraftIcao24={selectedAircraftIcao24}
          onSelectAircraft={setSelectedAircraftIcao24}
          onQuickWatch={addWatchTerm}
        />
      </section>

      {loading ? <div className="floating-state">Live-Daten werden geladen ...</div> : null}
      {error ? <div className="floating-state floating-state--error">{error}</div> : null}
    </main>
  );
}
