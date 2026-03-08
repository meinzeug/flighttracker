import {
  startTransition,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react';

import { RadarMap } from './components/RadarMap';
import { RadarScope } from './components/RadarScope';
import { getSegmentColor } from './lib/segments';

const SAVED_VIEWS_KEY = 'flighttracker.saved-views.v1';
const WATCH_TERMS_KEY = 'flighttracker.watch-terms.v1';

function formatCompactNumber(value, suffix = '') {
  return new Intl.NumberFormat('de-DE', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value) + suffix;
}

function formatInteger(value, suffix = '') {
  return new Intl.NumberFormat('de-DE').format(value) + suffix;
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
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

function groupByAircraft(items, keySelector, labelSelector, limit = 12) {
  const buckets = new Map();

  for (const item of items) {
    const key = keySelector(item);
    if (!key) {
      continue;
    }

    const existing = buckets.get(key) ?? {
      key,
      label: labelSelector(item, key),
      count: 0,
      fuelLitersPerHour: 0,
      co2KgPerHour: 0,
    };

    existing.count += 1;
    existing.fuelLitersPerHour += item.fuelLitersPerHour;
    existing.co2KgPerHour += item.co2KgPerHour;
    buckets.set(key, existing);
  }

  return [...buckets.values()]
    .sort((a, b) => b.co2KgPerHour - a.co2KgPerHour || b.count - a.count)
    .slice(0, limit);
}

function normalizeWatchTerm(value) {
  return value.trim().toLowerCase();
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
      <span className="filter-group__title">{title}</span>
      <div className="filter-chip-list">
        {values.map((value) => {
          const active = selected.includes(value);
          return (
            <button
              type="button"
              key={value}
              className={`filter-chip ${active ? 'is-active' : ''}`}
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

function MetricCard({ eyebrow, value, caption, tone = 'default' }) {
  return (
    <article className={`metric-card metric-card--${tone}`}>
      <span className="metric-card__eyebrow">{eyebrow}</span>
      <strong className="metric-card__value">{value}</strong>
      <span className="metric-card__caption">{caption}</span>
    </article>
  );
}

function BreakdownTable({ title, rows, valueLabel }) {
  return (
    <section className="panel">
      <div className="panel__header">
        <h3>{title}</h3>
      </div>
      <div className="table-grid">
        {rows.map((row) => (
          <div key={row.key} className="table-row">
            <div>
              <strong>{row.label}</strong>
              <span>{formatInteger(row.count)} Flieger</span>
            </div>
            <div className="table-row__metric">
              <strong>{formatCompactNumber(row.co2KgPerHour, ' kg')}</strong>
              <span>{valueLabel}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function TrafficTable({ rows, onQuickWatch }) {
  return (
    <section className="panel">
      <div className="panel__header">
        <h3>Flight Deck</h3>
        <span>Top Emissionen im aktuellen View</span>
      </div>
      <div className="traffic-table">
        <div className="traffic-table__head">
          <span>Flight</span>
          <span>Typ</span>
          <span>Segment</span>
          <span>CO2 / h</span>
          <span>Alert</span>
        </div>
        {rows.map((entry) => (
          <div key={entry.icao24} className="traffic-table__row">
            <span>{entry.callsign ?? entry.registration ?? entry.icao24}</span>
            <span>{entry.typecode ?? entry.typeFamily}</span>
            <span>{entry.operationSegment}</span>
            <span>{formatCompactNumber(entry.co2KgPerHour, ' kg')}</span>
            <button
              type="button"
              className="mini-button"
              onClick={() => onQuickWatch(entry.callsign ?? entry.registration ?? entry.icao24)}
            >
              Watch
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function App() {
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [segmentFilters, setSegmentFilters] = useState([]);
  const [emitterFilters, setEmitterFilters] = useState([]);
  const [engineFilters, setEngineFilters] = useState([]);
  const [radarCenter, setRadarCenter] = useState({ lat: 22, lon: 8.5 });
  const [selectedFrame, setSelectedFrame] = useState(null);
  const [savedViews, setSavedViews] = useState(() => loadLocalState(SAVED_VIEWS_KEY, []));
  const [presetName, setPresetName] = useState('');
  const [watchTerms, setWatchTerms] = useState(() => loadLocalState(WATCH_TERMS_KEY, []));
  const [watchInput, setWatchInput] = useState('');
  const [alertEvents, setAlertEvents] = useState([]);
  const seenWatchTermsRef = useRef(new Set());

  const deferredSearch = useDeferredValue(search);

  const refreshSnapshot = useEffectEvent(async ({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
    }

    try {
      const response = await fetch(
        selectedFrame ? `/api/live?at=${encodeURIComponent(selectedFrame)}` : '/api/live',
      );
      if (!response.ok) {
        throw new Error(`API antwortet mit ${response.status}`);
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

  useEffect(() => {
    refreshSnapshot();
  }, [refreshSnapshot, selectedFrame]);

  useEffect(() => {
    if (selectedFrame) {
      return undefined;
    }

    const timer = window.setInterval(() => refreshSnapshot({ silent: true }), 45000);
    return () => window.clearInterval(timer);
  }, [refreshSnapshot, selectedFrame]);

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
        hits: hits.slice(0, 3).map((entry) => entry.callsign ?? entry.registration ?? entry.icao24),
      }));

    if (newEvents.length) {
      setAlertEvents((current) => [...newEvents, ...current].slice(0, 10));

      if (typeof window !== 'undefined' && 'Notification' in window && window.Notification.permission === 'granted') {
        for (const event of newEvents) {
          const body = event.hits.length
            ? `Treffer: ${event.hits.join(', ')}`
            : 'Neue Treffer im Live-Feed';
          new window.Notification(`FlightTracker Alert: ${event.term}`, { body });
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
      accumulator.fuelLitersPerHour += entry.fuelLitersPerHour;
      accumulator.co2KgPerHour += entry.co2KgPerHour;
      return accumulator;
    },
    { fuelLitersPerHour: 0, co2KgPerHour: 0 },
  );

  const bySegment = groupByAircraft(filteredAircraft, (entry) => entry.operationSegment, (entry) => entry.operationSegment);
  const byType = groupByAircraft(
    filteredAircraft,
    (entry) => entry.typecode ?? entry.model ?? entry.typeFamily,
    (entry, key) => (entry.typecode && entry.model ? `${entry.typecode} · ${entry.model}` : key),
    14,
  );
  const trafficRows = [...filteredAircraft]
    .sort((a, b) => b.co2KgPerHour - a.co2KgPerHour)
    .slice(0, 14);

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
    const nextView = {
      id: makeId('view'),
      name,
      search,
      segmentFilters,
      emitterFilters,
      engineFilters,
      savedAt: new Date().toISOString(),
    };

    setSavedViews((current) => [nextView, ...current].slice(0, 10));
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

  return (
    <main className="app-shell">
      <section className="hero">
        <div className="hero__copy">
          <span className="eyebrow">Open Flight Intelligence</span>
          <h1>Eigenstaendige freie Alternative statt Premium-Schranke.</h1>
          <p>
            Wir bauen hier keine kopierte Markenoberflaeche, sondern ein freies Flight-Operations-
            Dashboard mit Live-Radar, Playback, Watchlist-Alerts, gespeicherten Views und Emissions-
            Analyse auf Basis legal erreichbarer Datenquellen.
          </p>
        </div>
        <div className="hero__status">
          <span className={`live-pill ${snapshot?.stale ? 'is-stale' : 'is-live'}`}>
            {snapshot?.mode === 'playback' ? 'Playback Frame' : snapshot?.stale ? 'Stale Snapshot' : 'Live Snapshot'}
          </span>
          <span>{snapshot ? `Stand ${new Date(snapshot.observedAt).toLocaleString('de-DE')}` : 'Lade Live-Daten ...'}</span>
          <span>{snapshot?.warning ?? 'OpenSky + Aircraft DB + Playback Cache'}</span>
        </div>
      </section>

      <section className="metrics-grid">
        <MetricCard
          eyebrow="Aktive Flugzeuge"
          value={snapshot ? formatInteger(filteredAircraft.length) : '...'}
          caption="momentan im aktuellen View"
          tone="lime"
        />
        <MetricCard
          eyebrow="Kerosin / Stunde"
          value={snapshot ? `${formatCompactNumber(filteredTotals.fuelLitersPerHour)} L` : '...'}
          caption="auf Basis des aktuellen Snapshots"
          tone="amber"
        />
        <MetricCard
          eyebrow="CO2 / Stunde"
          value={snapshot ? `${formatCompactNumber(filteredTotals.co2KgPerHour)} kg` : '...'}
          caption="direkte Verbrennungs-Emissionen"
          tone="red"
        />
        <MetricCard
          eyebrow="Typauflosung"
          value={snapshot ? `${Math.round((snapshot.metadata.coverageRatio ?? 0) * 100)} %` : '...'}
          caption="mit Modell oder Typcode"
          tone="blue"
        />
      </section>

      <section className="premium-grid">
        <article className="panel">
          <div className="panel__header">
            <h2>Playback</h2>
            <button type="button" className="action-button" onClick={() => setSelectedFrame(null)}>
              Zurueck zu Live
            </button>
          </div>
          <p className="panel-copy">
            Die letzten globalen Snapshots werden serverseitig gepuffert. Damit bekommst du bereits
            eine freie Playback-Funktion ohne Premium-Gating.
          </p>
          <div className="timeline-meta">
            <span>{playbackFrames.length ? `${playbackFrames.length} Frames im Verlauf` : 'Noch keine Frames gesammelt'}</span>
            <strong>{snapshot ? formatTime(snapshot.observedAt) : '--:--:--'}</strong>
          </div>
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
        </article>

        <article className="panel">
          <div className="panel__header">
            <h2>Saved Views</h2>
            <span>{savedViews.length}/10 gespeichert</span>
          </div>
          <div className="inline-form">
            <input
              type="text"
              value={presetName}
              onChange={(event) => setPresetName(event.target.value)}
              placeholder="Name fuer aktuellen Filterzustand"
            />
            <button type="button" className="action-button" onClick={saveCurrentView}>
              View sichern
            </button>
          </div>
          <div className="saved-list">
            {savedViews.map((view) => (
              <div key={view.id} className="saved-list__item">
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
                  Entfernen
                </button>
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panel__header">
            <h2>Watchlist Alerts</h2>
            <button type="button" className="action-button" onClick={requestNotifications}>
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
              Hinzufuegen
            </button>
          </div>
          <div className="watch-list">
            {watchTerms.map((term) => (
              <button
                type="button"
                key={term}
                className="filter-chip is-active"
                style={{ '--chip-color': '#ffa94d' }}
                onClick={() => setWatchTerms((current) => current.filter((entry) => entry !== term))}
              >
                {term}
              </button>
            ))}
          </div>
          <div className="alert-feed">
            {alertEvents.map((event) => (
              <div key={event.id} className="alert-feed__item">
                <strong>{event.term}</strong>
                <span>{event.hits.join(', ')}</span>
                <small>{new Date(event.observedAt).toLocaleString('de-DE')}</small>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="filters-panel panel">
        <div className="panel__header">
          <h2>Advanced Filters</h2>
          <div className="search-box">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Callsign, Typ, Betreiber, Registrierung ..."
            />
          </div>
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

      <section className="radar-layout">
        <article className="panel panel--map">
          <div className="panel__header">
            <h2>Global Radar</h2>
            <span>{formatInteger(filteredAircraft.length)} Ziele im View</span>
          </div>
          <RadarMap aircraft={filteredAircraft} onCenterChange={setRadarCenter} />
        </article>
        <article className="panel panel--scope">
          <div className="panel__header">
            <h2>Scope um Kartenmittelpunkt</h2>
            <span>animierter Sweep, 4.000 km Reichweite</span>
          </div>
          <RadarScope aircraft={filteredAircraft} center={radarCenter} />
        </article>
      </section>

      <section className="analytics-grid">
        <BreakdownTable title="Emissionen nach Segment" rows={bySegment} valueLabel="kg CO2 / h" />
        <BreakdownTable title="Top Flugzeugtypen" rows={byType} valueLabel="kg CO2 / h" />
        <TrafficTable rows={trafficRows} onQuickWatch={addWatchTerm} />
      </section>

      <section className="panel panel--wide">
        <div className="panel__header">
          <h2>Feature-Lage</h2>
          <span>heute umgesetzt vs. naechste Ausbaustufen</span>
        </div>
        <div className="feature-list">
          <div>
            <strong>Jetzt drin</strong>
            <p>Live-Radar, Playback, Saved Views, Watchlist-Alerts, Advanced Filters, Flight Deck und Emissionsmodell.</p>
          </div>
          <div>
            <strong>Als Naechstes</strong>
            <p>Mehr historische Tiefe, Wetter-Layer, Airport-Boards, sektorisierte Boards und staerkere Such-/Sortierfunktionen.</p>
          </div>
          <div>
            <strong>Grenze</strong>
            <p>Ein exakter Flightradar24-Klon mit proprietaeren Daten, UI und Premium-Paywall-Umgehung ist weder der Plan noch sinnvoll.</p>
          </div>
        </div>
      </section>

      {loading ? <div className="floating-state">Live-Daten werden geladen ...</div> : null}
      {error ? <div className="floating-state floating-state--error">{error}</div> : null}
    </main>
  );
}
