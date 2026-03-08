import {
  Suspense,
  lazy,
  startTransition,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react';

import { PUBLIC_DATA_CATALOG } from './lib/public-data-catalog';
import { getSegmentColor } from './lib/segments';

const RadarMap = lazy(() =>
  import('./components/RadarMap').then((module) => ({ default: module.RadarMap })),
);
const RadarScope = lazy(() =>
  import('./components/RadarScope').then((module) => ({ default: module.RadarScope })),
);

const WATCH_TERMS_KEY = 'whatsupp.watch-terms.v1';
const FILTER_PRESETS_KEY = 'whatsupp.filter-presets.v1';
const RECENT_FLIGHTS_KEY = 'whatsupp.recent-flights.v1';
const PUBLIC_LAYERS_KEY = 'whatsupp.public-layers.v1';
const TRAFFIC_SORT_OPTIONS = [
  { value: 'co2', label: 'CO2' },
  { value: 'altitude', label: 'ALT' },
  { value: 'speed', label: 'SPD' },
  { value: 'contact', label: 'LIVE' },
];
const RADAR_DOCK_ITEMS = [
  { value: 'settings', label: 'Ansicht', icon: 'UI' },
  { value: 'weather', label: 'Wetter', icon: 'WX' },
  { value: 'filters', label: 'Filter' },
  { value: 'widgets', label: 'Layer', icon: 'LY' },
  { value: 'playback', label: 'Playback', icon: 'PB' },
];
const PREMIUM_FEATURE_ITEMS = [
  { id: 'filtering', label: 'Advanced filters' },
  { id: 'playback', label: 'Playback / Historie' },
  { id: 'weather', label: 'Weather am Kartenzentrum' },
  { id: 'details', label: 'Aircraft details + Typbilder' },
  { id: 'recent', label: 'Letzte angeklickte Fluege' },
  { id: 'fleet', label: 'Fleet / Betreiber-Ansicht' },
  { id: 'views', label: '2D / 3D Karte' },
  { id: 'export', label: 'Track Export CSV / KML' },
];
const PUBLIC_LAYER_DEFINITIONS = [
  {
    id: 'ports',
    label: 'Haefen',
    description: 'Hafenpunkte und Faehrterminals aus OpenStreetMap/Overpass.',
    source: 'OSM / Overpass',
    kind: 'feature',
    defaultEnabled: true,
  },
  {
    id: 'shippingRoutes',
    label: 'Faehrlinien',
    description: 'Oeffentlich gepflegte Faehrrelationen als maritime Linien.',
    source: 'OSM / Overpass',
    kind: 'feature',
    defaultEnabled: false,
  },
  {
    id: 'seamarks',
    label: 'Seezeichen',
    description: 'OpenSeaMap-Overlay fuer Seezeichen und nautische Marker.',
    source: 'OpenSeaMap',
    kind: 'raster',
    defaultEnabled: false,
  },
  {
    id: 'earthquakes',
    label: 'Erdbeben 24h',
    description: 'Globale USGS-Ereignisse der letzten 24 Stunden.',
    source: 'USGS',
    kind: 'feature',
    defaultEnabled: true,
  },
  {
    id: 'powerGrid',
    label: 'Stromnetz',
    description: 'Leitungen und Umspannwerke aus offenen OSM-Infrastrukturdaten.',
    source: 'OSM / Overpass',
    kind: 'feature',
    defaultEnabled: false,
  },
  {
    id: 'powerPlants',
    label: 'Kraftwerke',
    description: 'Kraftwerksstandorte aus offenen OSM-Anlagenobjekten.',
    source: 'OSM / Overpass',
    kind: 'feature',
    defaultEnabled: false,
  },
  {
    id: 'gasPipelines',
    label: 'Gasleitungen',
    description: 'Gas- und LNG-Pipeline-Geometrien aus offenen OSM-Daten.',
    source: 'OSM / Overpass',
    kind: 'feature',
    defaultEnabled: false,
  },
  {
    id: 'gasSites',
    label: 'Gas-Standorte',
    description: 'Gas-Anlagen, Speicher und Stationen aus offenen OSM-Daten.',
    source: 'OSM / Overpass',
    kind: 'feature',
    defaultEnabled: false,
  },
];
const DEFAULT_PUBLIC_LAYERS = Object.fromEntries(
  PUBLIC_LAYER_DEFINITIONS.map((item) => [item.id, item.defaultEnabled]),
);
const PUBLIC_CATEGORY_LABELS = {
  earthquake: 'Erdbeben',
  ferry_terminal: 'Faehrterminals',
  gas_pipeline: 'Gasleitungen',
  gas_site: 'Gas-Standorte',
  port: 'Haefen',
  power_line: 'Stromleitungen',
  power_plant: 'Kraftwerke',
  shipping_route: 'Faehrlinien',
  substation: 'Umspannwerke',
};

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

function formatVerticalRate(valueMps) {
  if (typeof valueMps !== 'number') {
    return 'n/a';
  }

  return `${formatInteger(Math.round(valueMps * 196.85))} ft/min`;
}

function formatRefreshInterval(valueMs) {
  if (!Number.isFinite(valueMs) || valueMs <= 0) {
    return 'manual';
  }

  if (valueMs < 60_000) {
    return `${Math.round(valueMs / 1000)}s`;
  }

  const minutes = Math.round(valueMs / 60_000);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  return `${Math.round(minutes / 60)}h`;
}

function formatCoordinate(value, positiveLabel, negativeLabel) {
  if (typeof value !== 'number') {
    return 'n/a';
  }

  const suffix = value >= 0 ? positiveLabel : negativeLabel;
  return `${Math.abs(value).toFixed(2)} ${suffix}`;
}

function formatRelativeAgeSeconds(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return 'n/a';
  }

  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }

  if (seconds < 3600) {
    return `${Math.round(seconds / 60)}m`;
  }

  return `${Math.round(seconds / 3600)}h`;
}

function formatLastSeen(lastContact) {
  if (typeof lastContact !== 'number') {
    return 'n/a';
  }

  return formatRelativeAgeSeconds(Math.max(0, Date.now() / 1000 - lastContact));
}

function formatTemperature(value) {
  if (!Number.isFinite(value)) {
    return 'n/a';
  }

  return `${Math.round(value)}°C`;
}

function weatherCodeLabel(code) {
  const mapping = {
    0: 'Klar',
    1: 'Meist klar',
    2: 'Teilweise bewolkt',
    3: 'Bedeckt',
    45: 'Nebel',
    48: 'Raureif-Nebel',
    51: 'Leichter Niesel',
    53: 'Niesel',
    55: 'Starker Niesel',
    61: 'Leichter Regen',
    63: 'Regen',
    65: 'Starker Regen',
    71: 'Leichter Schnee',
    73: 'Schnee',
    75: 'Starker Schnee',
    80: 'Regenschauer',
    81: 'Kräftige Schauer',
    82: 'Extreme Schauer',
    95: 'Gewitter',
  };

  return mapping[code] ?? 'Wetterlage unbekannt';
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

function emptyFeatureCollection() {
  return {
    type: 'FeatureCollection',
    features: [],
  };
}

function normalizePublicLayers(value) {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_PUBLIC_LAYERS };
  }

  return PUBLIC_LAYER_DEFINITIONS.reduce((accumulator, definition) => {
    accumulator[definition.id] = Boolean(value[definition.id] ?? definition.defaultEnabled);
    return accumulator;
  }, {});
}

function getPublicCountLabel(category) {
  return PUBLIC_CATEGORY_LABELS[category] ?? category;
}

function toggleValue(values, value) {
  return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];
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
    entry.originCountry,
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

function slugify(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'export';
}

function triggerTextDownload(filename, mimeType, content) {
  if (typeof window === 'undefined') {
    return;
  }

  const blob = new Blob([content], { type: mimeType });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}

function haversineDistanceKm(from, to) {
  const lat1 = (from.latitude * Math.PI) / 180;
  const lat2 = (to.latitude * Math.PI) / 180;
  const deltaLat = ((to.latitude - from.latitude) * Math.PI) / 180;
  const deltaLon = ((to.longitude - from.longitude) * Math.PI) / 180;
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getAircraftAltitude(entry) {
  return entry.geoAltitudeM ?? entry.baroAltitudeM ?? -1;
}

function getTrackMetrics(track) {
  if (!track.length) {
    return {
      distanceKm: 0,
      spanMinutes: 0,
      latestPoint: null,
      oldestPoint: null,
    };
  }

  let distanceKm = 0;
  for (let index = 1; index < track.length; index += 1) {
    distanceKm += haversineDistanceKm(track[index - 1], track[index]);
  }

  const oldestPoint = track[0];
  const latestPoint = track[track.length - 1];
  const spanMinutes = Math.max(
    0,
    Math.round((Date.parse(latestPoint.observedAt) - Date.parse(oldestPoint.observedAt)) / 60000),
  );

  return {
    distanceKm,
    spanMinutes,
    latestPoint,
    oldestPoint,
  };
}

function compareTrafficRows(left, right, sortMode) {
  if (sortMode === 'altitude') {
    return (
      getAircraftAltitude(right) - getAircraftAltitude(left) ||
      (right.velocityMps ?? 0) - (left.velocityMps ?? 0)
    );
  }

  if (sortMode === 'speed') {
    return (
      (right.velocityMps ?? 0) - (left.velocityMps ?? 0) ||
      getAircraftAltitude(right) - getAircraftAltitude(left)
    );
  }

  if (sortMode === 'contact') {
    return (
      (right.lastContact ?? 0) - (left.lastContact ?? 0) ||
      (right.co2KgPerHour ?? 0) - (left.co2KgPerHour ?? 0)
    );
  }

  return (
    (right.co2KgPerHour ?? 0) - (left.co2KgPerHour ?? 0) ||
    (right.lastContact ?? 0) - (left.lastContact ?? 0)
  );
}

function describeVerticalTrend(valueMps) {
  if (typeof valueMps !== 'number' || Math.abs(valueMps) < 0.5) {
    return 'Level';
  }

  return valueMps > 0 ? 'Steigt' : 'Sinkt';
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

function AccessScreen({ authBusy, authError, bootstrapRequired, loginForm, onSubmit, onUpdate }) {
  return (
    <main className="access-shell">
      <section className="access-card">
        <span className="eyebrow">Open World Picture</span>
        <h1>Globale Live-Lage auf einer Karte.</h1>
        <p>
          Diese App zeigt oeffentlich beobachtbare Luftverkehrsdaten als fortlaufendes Weltbild.
          Keine Geheimdienstmythen, sondern eine belegbare Live-Ansicht auf Basis offener Daten.
        </p>
        <form className="access-form" onSubmit={onSubmit}>
          <label>
            <span>Benutzername</span>
            <input
              type="text"
              autoComplete="username"
              value={loginForm.username}
              onChange={(event) => onUpdate('username', event.target.value)}
              placeholder="dennis.wicht@web.de"
            />
          </label>
          <label>
            <span>Passwort</span>
            <input
              type="password"
              autoComplete={bootstrapRequired ? 'new-password' : 'current-password'}
              value={loginForm.password}
              onChange={(event) => onUpdate('password', event.target.value)}
              placeholder="mindestens 8 Zeichen"
            />
          </label>
          <button type="submit" className="action-button action-button--primary" disabled={authBusy}>
            {authBusy ? 'Bitte warten ...' : bootstrapRequired ? 'Admin anlegen' : 'Anmelden'}
          </button>
        </form>
        {authError ? <div className="inline-state inline-state--error">{authError}</div> : null}
        <div className="access-footnotes">
          <div>
            <strong>Immer live</strong>
            <span>automatischer Refresh der globalen Luftlage in kurzen Intervallen</span>
          </div>
          <div>
            <strong>Eine Weltkarte</strong>
            <span>die Hauptansicht bleibt global und nicht nur regional</span>
          </div>
          <div>
            <strong>Oeffentliche Fakten</strong>
            <span>sichtbar wird, was sich aus den offenen Live-Daten wirklich ableiten laesst</span>
          </div>
        </div>
      </section>
    </main>
  );
}

function SummaryTile({ label, value, detail, tone = 'neutral' }) {
  return (
    <article className={`summary-tile summary-tile--${tone}`}>
      <span className="summary-tile__label">{label}</span>
      <strong className="summary-tile__value">{value}</strong>
      <span className="summary-tile__detail">{detail}</span>
    </article>
  );
}

function SegmentedControl({ options, value, onChange }) {
  return (
    <div className="segmented-control" role="tablist" aria-label="Traffic sortieren">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          className={`segmented-control__button ${option.value === value ? 'is-active' : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
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

function BreakdownPanel({ title, rows }) {
  return (
    <section className="panel panel--list">
      <div className="panel__header">
        <div>
          <h3>{title}</h3>
          <span>{formatInteger(rows.length)} Gruppen</span>
        </div>
      </div>
      <div className="list-grid">
        {rows.length ? (
          rows.map((row) => (
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
          ))
        ) : (
          <div className="list-row list-row--empty">Keine Daten im aktuellen Filter.</div>
        )}
      </div>
    </section>
  );
}

function SelectedFlightCard({ aircraft }) {
  if (!aircraft) {
    return (
      <section className="panel panel--selected">
        <div className="panel__header">
          <div>
            <h3>Selected Flight</h3>
            <span>keine Auswahl</span>
          </div>
        </div>
        <p className="panel-copy">
          Waehle ein Ziel aus der Traffic-Liste oder tippe direkt auf der Karte auf ein Flugzeug.
        </p>
      </section>
    );
  }

  return (
    <section className="panel panel--selected">
      <div className="selected-head">
        <div className="selected-head__copy">
          <span className="selected-kicker">{aircraft.operationSegment ?? 'Live Target'}</span>
          <h3>{primaryLabel(aircraft)}</h3>
          <p>{secondaryLabel(aircraft) || aircraft.originCountry || 'Unbekannt'}</p>
        </div>
        <div className="selected-head__codes">
          <span className="status-tag">{aircraft.typecode ?? aircraft.typeFamily ?? 'n/a'}</span>
          <span className="status-tag">{aircraft.icao24?.toUpperCase() ?? '----'}</span>
        </div>
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
          <span className="detail-label">Vertikal</span>
          <strong>{formatVerticalRate(aircraft.verticalRateMps)}</strong>
        </div>
        <div>
          <span className="detail-label">Typ</span>
          <strong>{aircraft.typecode ?? aircraft.typeFamily ?? 'n/a'}</strong>
        </div>
        <div>
          <span className="detail-label">Fuel / h</span>
          <strong>{formatCompactNumber(aircraft.fuelLitersPerHour, ' L')}</strong>
        </div>
        <div>
          <span className="detail-label">CO2 / h</span>
          <strong>{formatCompactNumber(aircraft.co2KgPerHour, ' kg')}</strong>
        </div>
        <div>
          <span className="detail-label">Last Seen</span>
          <strong>{formatLastSeen(aircraft.lastContact)}</strong>
        </div>
      </div>
      <div className="selected-meta-grid">
        <div>
          <span className="detail-label">Position</span>
          <strong>
            {formatCoordinate(aircraft.latitude, 'N', 'S')} / {formatCoordinate(aircraft.longitude, 'E', 'W')}
          </strong>
        </div>
        <div>
          <span className="detail-label">Operator</span>
          <strong>{aircraft.operator ?? aircraft.owner ?? 'n/a'}</strong>
        </div>
        <div>
          <span className="detail-label">Emitter</span>
          <strong>{aircraft.emitterCategory ?? 'n/a'}</strong>
        </div>
        <div>
          <span className="detail-label">Antrieb</span>
          <strong>{aircraft.engineType ?? 'n/a'}</strong>
        </div>
        <div>
          <span className="detail-label">Trend</span>
          <strong>{describeVerticalTrend(aircraft.verticalRateMps)}</strong>
        </div>
      </div>
    </section>
  );
}

function RouteMonitorPanel({
  aircraft,
  track,
  loading,
  followSelected,
  onToggleFollow,
  onClearSelection,
}) {
  if (!aircraft) {
    return (
      <section className="panel panel--route-monitor">
        <div className="panel__header">
          <div>
            <h3>Route Monitor</h3>
            <span>keine Auswahl</span>
          </div>
        </div>
        <p className="panel-copy">
          Mit einer Auswahl siehst du hier den lokalen Flugverlauf, letzte Positionspunkte und den
          Fokusmodus fuer die Karte.
        </p>
      </section>
    );
  }

  const metrics = getTrackMetrics(track);
  const timeline = [...track].slice(-8).reverse();

  return (
    <section className="panel panel--route-monitor">
      <div className="panel__header panel__header--route">
        <div>
          <h3>Route Monitor</h3>
          <span>Verlauf fuer {primaryLabel(aircraft)}</span>
        </div>
        <div className="button-row">
          <button
            type="button"
            className={`mini-button ${followSelected ? 'is-active' : ''}`}
            onClick={() => onToggleFollow((current) => !current)}
          >
            {followSelected ? 'Follow aktiv' : 'Follow'}
          </button>
          <button type="button" className="mini-button" onClick={onClearSelection}>
            Auswahl loeschen
          </button>
        </div>
      </div>

      <div className="summary-grid summary-grid--route">
        <SummaryTile
          label="Track Points"
          value={formatInteger(track.length)}
          detail={track.length > 1 ? 'lokaler Verlauf' : 'noch im Aufbau'}
          tone="blue"
        />
        <SummaryTile
          label="Route Window"
          value={metrics.spanMinutes ? `${metrics.spanMinutes}m` : '<1m'}
          detail="sichtbares Zeitfenster"
          tone="neutral"
        />
        <SummaryTile
          label="Path Distance"
          value={`${formatCompactNumber(metrics.distanceKm)} km`}
          detail="innerhalb der Historie"
          tone="amber"
        />
        <SummaryTile
          label="Last Contact"
          value={formatLastSeen(aircraft.lastContact)}
          detail="seit letztem Kontakt"
          tone="neutral"
        />
      </div>

      <div className="route-monitor__status">
        <span className={`status-pill ${followSelected ? 'status-pill--active' : ''}`}>
          {followSelected ? 'Karte folgt dem Ziel' : 'Karte bleibt frei navigierbar'}
        </span>
        <span className="panel-copy">
          {loading
            ? 'Track-Verlauf wird geladen ...'
            : track.length > 1
              ? `Letzter Punkt ${formatTime(metrics.latestPoint?.observedAt)}`
              : 'Track-Verlauf baut sich mit weiteren Live-Frames auf.'}
        </span>
      </div>

      <div className="route-monitor__timeline">
        {timeline.length ? (
          timeline.map((point, index) => (
            <article key={`${point.observedAt}-${index}`} className="route-point">
              <div className="route-point__head">
                <strong>{formatTime(point.observedAt)}</strong>
                <span>{index === 0 ? 'neuester Punkt' : `-${index}`}</span>
              </div>
              <div className="route-point__stats">
                <span>{formatAltitude(point.geoAltitudeM ?? point.baroAltitudeM)}</span>
                <span>{formatSpeed(point.velocityMps)}</span>
                <span>{formatHeading(point.trackDeg)}</span>
              </div>
              <div className="route-point__coords">
                {formatCoordinate(point.latitude, 'N', 'S')} / {formatCoordinate(point.longitude, 'E', 'W')}
              </div>
            </article>
          ))
        ) : (
          <div className="route-point route-point--empty">Noch keine Track-Punkte verfuegbar.</div>
        )}
      </div>
    </section>
  );
}

function FlightDeckPanel({
  rows,
  sortMode,
  onSortChange,
  selectedAircraftIcao24,
  onSelectAircraft,
  onQuickWatch,
}) {
  return (
    <section className="panel panel--traffic">
      <div className="panel__header">
        <div>
          <h3>Traffic</h3>
          <span>sichtbare Ziele im Radarfenster</span>
        </div>
        <div className="flight-deck__header-actions">
          <SegmentedControl options={TRAFFIC_SORT_OPTIONS} value={sortMode} onChange={onSortChange} />
          <span className="status-tag">{formatInteger(rows.length)}</span>
        </div>
      </div>
      <div className="flight-deck flight-deck--traffic">
        {rows.map((entry, index) => {
          const active = entry.icao24 === selectedAircraftIcao24;
          return (
            <div key={entry.icao24} className={`flight-row ${active ? 'is-active' : ''}`}>
              <button
                type="button"
                className="flight-row__select"
                onClick={() => onSelectAircraft(entry.icao24)}
              >
                <div className="flight-row__line">
                  <span className="flight-row__index">{String(index + 1).padStart(2, '0')}</span>
                  <div className="flight-row__title">
                    <strong>{primaryLabel(entry)}</strong>
                    <span>{secondaryLabel(entry) || entry.operationSegment || entry.originCountry}</span>
                  </div>
                </div>
                <div className="flight-row__meta">
                  <div className="flight-row__stats">
                    <span className="flight-stat">{formatAltitude(entry.geoAltitudeM ?? entry.baroAltitudeM)}</span>
                    <span className="flight-stat">{formatSpeed(entry.velocityMps)}</span>
                    <span className="flight-stat">{formatLastSeen(entry.lastContact)}</span>
                  </div>
                  <div className="flight-row__metrics">
                    <span>{describeVerticalTrend(entry.verticalRateMps)}</span>
                    <strong>{formatCompactNumber(entry.co2KgPerHour, ' kg')}</strong>
                  </div>
                </div>
              </button>
              <span className="flight-row__action">
                <button type="button" className="mini-button" onClick={() => onQuickWatch(primaryLabel(entry))}>
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

function RadarTrafficOverlay({
  rows,
  sortMode,
  onSortChange,
  selectedAircraftIcao24,
  onSelectAircraft,
}) {
  return (
    <section className="radar-card radar-card--traffic-list">
      <div className="radar-card__header">
        <div>
          <h2>Flugverkehr</h2>
          <span>sichtbare Ziele im Ausschnitt</span>
        </div>
        <button type="button" className="radar-chip radar-chip--button" onClick={() => onSortChange(sortMode)}>
          {sortMode.toUpperCase()}
        </button>
      </div>
      <div className="radar-flight-scroll">
        {rows.slice(0, 14).map((entry, index) => {
          const active = entry.icao24 === selectedAircraftIcao24;
          return (
            <button
              key={entry.icao24}
              type="button"
              className={`radar-flight-card ${active ? 'is-active' : ''}`}
              onClick={() => onSelectAircraft(entry.icao24)}
            >
              <div className="radar-flight-card__head">
                <span className="radar-flight-card__rank">{index + 1}.</span>
                <strong>{primaryLabel(entry)}</strong>
                <span className="radar-flight-card__badge">{entry.typecode ?? entry.typeFamily ?? 'N/A'}</span>
              </div>
              <div className="radar-flight-card__body">
                <span>{entry.operator ?? entry.originCountry ?? 'n/a'}</span>
                <strong>{formatCompactNumber(entry.co2KgPerHour, '')}</strong>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function RadarCommandBar({
  searchInputRef,
  search,
  onSearchChange,
  visibleCount,
  activeFilterCount,
  refreshLabel,
  snapshot,
  selectedAircraft,
  selectedFrameAt,
  session,
  onRefresh,
  onGoLive,
  onToggleMenu,
  isMenuOpen,
}) {
  return (
    <section className="radar-overlay radar-overlay--command">
      <div className="radar-command-bar radar-card">
        <div className="radar-command-bar__brand">
          <div className="radar-logo-lockup">
            <span className="radar-logo-mark" />
            <div className="radar-logo-copy">
              <strong>whats</strong>
              <em>upp</em>
            </div>
          </div>
        </div>
        <label className="radar-search-field radar-search-field--header">
          <input
            ref={searchInputRef}
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Find flights, airports and more"
          />
        </label>
        <div className="radar-command-bar__quick">
          <span className={`radar-live-tag ${selectedFrameAt ? 'radar-live-tag--muted' : ''}`}>
            {selectedFrameAt ? 'Replay' : 'Live'}
          </span>
          <span className="radar-chip">{formatInteger(visibleCount)} sichtbar</span>
          <span className="radar-chip">{`Refresh ${refreshLabel}`}</span>
          <span className="radar-chip">
            {activeFilterCount ? `${activeFilterCount} Filter aktiv` : 'Keine Filter'}
          </span>
          {selectedAircraft ? <span className="radar-chip">{primaryLabel(selectedAircraft)}</span> : null}
          <button type="button" className="radar-chip radar-chip--button" onClick={onRefresh}>
            Aktualisieren
          </button>
          {selectedFrameAt ? (
            <button type="button" className="radar-chip radar-chip--button" onClick={onGoLive}>
              Zurueck zu Live
            </button>
          ) : null}
          <button type="button" className="radar-account-pill">
            {session.username}
          </button>
          <button
            type="button"
            className={`radar-burger ${isMenuOpen ? 'is-active' : ''}`}
            onClick={onToggleMenu}
            aria-label="Menue"
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </div>
      <div className="radar-command-bar__meta">
        <span className="radar-chip">{snapshot?.stale ? 'Verzoegerte Daten' : 'Echtzeitdaten'}</span>
        <span className="radar-chip">
          {selectedAircraft ? `Auswahl ${primaryLabel(selectedAircraft)}` : 'Klicke ein Flugzeug auf der Karte'}
        </span>
      </div>
    </section>
  );
}

function RadarDisruptionOverlay({ warning, alertEvents, bySegment }) {
  return (
    <section className="radar-card radar-card--disruptions">
      <div className="radar-card__header">
        <div>
          <h3>Airport disruptions</h3>
        </div>
        <span className="radar-live-tag">LIVE</span>
      </div>
      <div className="radar-disruption-body">
        {warning ? <p>{warning}</p> : null}
        {!warning && alertEvents.length ? (
          alertEvents.slice(0, 3).map((event) => (
            <div key={event.id} className="radar-disruption-row">
              <strong>{event.term}</strong>
              <span>{event.hits.join(', ')}</span>
            </div>
          ))
        ) : null}
        {!warning && !alertEvents.length ? (
          <>
            <p>Keine grossen Stoerungsmarker in den aktuellen offenen Live-Daten.</p>
            <div className="radar-disruption-list">
              {bySegment.slice(0, 3).map((segment) => (
                <div key={segment.key} className="radar-disruption-row">
                  <strong>{segment.label}</strong>
                  <span>{formatInteger(segment.count)} Ziele</span>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>
      <button type="button" className="radar-footer-link">
        Disruption map
      </button>
    </section>
  );
}

function RadarBookmarksOverlay({ watchTerms, watchInput, onWatchInputChange, onAddWatch, onRemoveWatch }) {
  return (
    <section className="radar-card radar-card--bookmarks">
      <div className="radar-card__header">
        <div>
          <h3>Bookmarks</h3>
        </div>
      </div>
      <div className="radar-bookmark-input">
        <input
          type="text"
          value={watchInput}
          onChange={(event) => onWatchInputChange(event.target.value)}
          placeholder="Callsign oder ICAO24"
        />
        <button type="button" className="radar-chip radar-chip--button" onClick={() => onAddWatch(watchInput)}>
          Add
        </button>
      </div>
      <div className="radar-bookmark-list">
        {watchTerms.length ? (
          watchTerms.slice(0, 6).map((term) => (
            <button key={term} type="button" className="radar-bookmark" onClick={() => onRemoveWatch(term)}>
              {term}
            </button>
          ))
        ) : (
          <span className="radar-muted">Keine Bookmarks gesetzt.</span>
        )}
      </div>
    </section>
  );
}

function RadarSelectedOverlay({
  aircraft,
  track,
  loading,
  followSelected,
  aircraftMedia,
  aircraftMediaLoading,
  onToggleFollow,
  onClearSelection,
}) {
  const metrics = getTrackMetrics(track);

  return (
    <section className="radar-card radar-card--selected-overlay">
      <div className="radar-card__header">
        <div>
          <h3>Ausgewaehlter Flug</h3>
          <span>{aircraft ? 'Live-Ziel' : 'keine Auswahl'}</span>
        </div>
        {aircraft ? <span className="radar-flight-card__badge">{aircraft.typecode ?? 'N/A'}</span> : null}
      </div>
      {aircraft ? (
        <>
          <div className="radar-selected-media">
            {aircraftMedia?.imageUrl ? (
              <img
                src={aircraftMedia.imageUrl}
                alt={aircraftMedia.title ?? `${aircraft.manufacturerName ?? ''} ${aircraft.model ?? aircraft.typecode ?? ''}`.trim()}
                loading="lazy"
              />
            ) : (
              <div className="radar-selected-media__placeholder">
                {aircraftMediaLoading ? 'Typbild wird geladen ...' : 'Kein Typbild verfuegbar'}
              </div>
            )}
            <div className="radar-selected-media__copy">
              <strong>
                {aircraftMedia?.title ??
                  [aircraft.manufacturerName, aircraft.model ?? aircraft.typecode ?? aircraft.typeFamily]
                    .filter(Boolean)
                    .join(' ')}
              </strong>
              <span>
                {aircraftMedia?.description ??
                  secondaryLabel(aircraft) ??
                  aircraft.operationSegment ??
                  'Offene Luftverkehrsdaten'}
              </span>
              {aircraftMedia?.articleUrl ? (
                <a href={aircraftMedia.articleUrl} target="_blank" rel="noreferrer">
                  Quelle oeffnen
                </a>
              ) : null}
            </div>
          </div>
          <div className="radar-selected-title">
            <strong>{primaryLabel(aircraft)}</strong>
            <span>{aircraft.operator ?? aircraft.originCountry ?? 'n/a'}</span>
          </div>
          <div className="radar-selected-grid">
            <div>
              <span>ALT</span>
              <strong>{formatAltitude(aircraft.geoAltitudeM ?? aircraft.baroAltitudeM)}</strong>
            </div>
            <div>
              <span>SPD</span>
              <strong>{formatSpeed(aircraft.velocityMps)}</strong>
            </div>
            <div>
              <span>LIVE</span>
              <strong>{formatLastSeen(aircraft.lastContact)}</strong>
            </div>
            <div>
              <span>TRK</span>
              <strong>{track.length}</strong>
            </div>
          </div>
          <div className="radar-selected-actions">
            <button
              type="button"
              className={`radar-chip radar-chip--button ${followSelected ? 'is-active' : ''}`}
              onClick={() => onToggleFollow((current) => !current)}
            >
              {followSelected ? 'Karte folgt' : 'Karte folgen'}
            </button>
            <button type="button" className="radar-chip radar-chip--button" onClick={onClearSelection}>
              Auswahl loeschen
            </button>
          </div>
          <div className="radar-selected-footer">
            <span>{loading ? 'Track wird geladen ...' : `${metrics.spanMinutes || 0} min Verlauf`}</span>
            <span>{formatCompactNumber(metrics.distanceKm, ' km')}</span>
          </div>
        </>
      ) : (
        <p className="radar-muted">
          Waehle ein Flugzeug in der linken Liste oder direkt auf der Karte.
        </p>
      )}
    </section>
  );
}

function RadarFilterGroup({ title, options, selectedValues, onToggle }) {
  if (!options.length) {
    return null;
  }

  return (
    <div className="radar-filter-group">
      <strong>{title}</strong>
      <div className="radar-filter-chips">
        {options.map((option) => {
          const active = selectedValues.includes(option.key);
          return (
            <button
              key={option.key}
              type="button"
              className={`radar-filter-chip ${active ? 'is-active' : ''}`}
              onClick={() => onToggle(option.key)}
            >
              <span>{option.label}</span>
              <small>{formatInteger(option.count)}</small>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RadarBurgerMenu({
  open,
  session,
  premiumItems,
  dataCatalog,
  publicLayerDefinitions,
  publicLayers,
  publicCountRows,
  publicDataLoading,
  publicDataError,
  onTogglePublicLayer,
  filterPresets,
  presetName,
  onPresetNameChange,
  onSavePreset,
  onApplyPreset,
  onDeletePreset,
  recentFlights,
  onSelectRecentFlight,
  fleetRows,
  selectedAircraft,
  onExportTrackCsv,
  onExportTrackKml,
  viewMode,
  onSetViewMode,
  showTrafficPane,
  onToggleTrafficPane,
  showRightPane,
  onToggleRightPane,
  showLabels,
  onToggleLabels,
  onClose,
}) {
  return (
    <aside className={`radar-menu ${open ? 'is-open' : ''}`}>
      <div className="radar-menu__header">
        <div>
          <h3>Premium-Menue</h3>
          <span>{session.username}</span>
        </div>
        <button type="button" className="radar-chip radar-chip--button" onClick={onClose}>
          Schliessen
        </button>
      </div>

      <section className="radar-menu__section">
        <h4>Ansicht</h4>
        <div className="radar-menu__toggle-grid">
          <button
            type="button"
            className={`radar-menu__toggle ${viewMode === '2d' ? 'is-active' : ''}`}
            onClick={() => onSetViewMode('2d')}
          >
            2D Karte
          </button>
          <button
            type="button"
            className={`radar-menu__toggle ${viewMode === '3d' ? 'is-active' : ''}`}
            onClick={() => onSetViewMode('3d')}
          >
            3D Karte
          </button>
          <button
            type="button"
            className={`radar-menu__toggle ${showTrafficPane ? 'is-active' : ''}`}
            onClick={onToggleTrafficPane}
          >
            Flugliste
          </button>
          <button
            type="button"
            className={`radar-menu__toggle ${showRightPane ? 'is-active' : ''}`}
            onClick={onToggleRightPane}
          >
            Detailspalte
          </button>
          <button
            type="button"
            className={`radar-menu__toggle ${showLabels ? 'is-active' : ''}`}
            onClick={onToggleLabels}
          >
            Labels
          </button>
        </div>
      </section>

      <section className="radar-menu__section">
        <h4>Kartenlayer & offene Daten</h4>
        <div className="radar-menu__layer-list">
          {publicLayerDefinitions.map((layer) => (
            <button
              key={layer.id}
              type="button"
              className={`radar-menu__layer-row ${publicLayers[layer.id] ? 'is-active' : ''}`}
              onClick={() => onTogglePublicLayer(layer.id)}
            >
              <div>
                <strong>{layer.label}</strong>
                <span>{layer.description}</span>
              </div>
              <em>{layer.source}</em>
            </button>
          ))}
        </div>
        <div className="radar-menu__list">
          {publicDataLoading ? <span className="radar-muted">Open-Data-Layer werden geladen ...</span> : null}
          {!publicDataLoading && publicDataError ? (
            <span className="radar-muted">{publicDataError}</span>
          ) : null}
          {!publicDataLoading && !publicDataError && publicCountRows.length ? (
            publicCountRows.slice(0, 6).map((row) => (
              <div key={row.category} className="radar-menu__feature-row">
                <span>{row.label}</span>
                <strong>{formatInteger(row.count)}</strong>
              </div>
            ))
          ) : null}
        </div>
      </section>

      <section className="radar-menu__section">
        <h4>Premium-Funktionen</h4>
        <div className="radar-menu__feature-list">
          {premiumItems.map((item) => (
            <div key={item.id} className="radar-menu__feature-row">
              <span>{item.label}</span>
              <strong>aktiv</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="radar-menu__section">
        <h4>Open Data Catalog</h4>
        <div className="radar-menu__catalog">
          {dataCatalog.map((group) => (
            <div key={group.category} className="radar-menu__catalog-group">
              <strong>{group.category}</strong>
              <div className="radar-menu__list">
                {group.items.map((item) => (
                  <div key={item.id} className="radar-menu__catalog-item">
                    <div className="radar-menu__feature-row">
                      <span>{item.label}</span>
                      <strong>{item.status}</strong>
                    </div>
                    <small>{item.mode}</small>
                    <p>{item.note}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="radar-menu__section">
        <h4>Gespeicherte Filter</h4>
        <div className="radar-menu__save-row">
          <input
            type="text"
            value={presetName}
            onChange={(event) => onPresetNameChange(event.target.value)}
            placeholder="Preset-Name"
          />
          <button type="button" className="radar-chip radar-chip--button" onClick={onSavePreset}>
            Speichern
          </button>
        </div>
        <div className="radar-menu__list">
          {filterPresets.length ? (
            filterPresets.map((preset) => (
              <div key={preset.id} className="radar-menu__list-row">
                <button type="button" onClick={() => onApplyPreset(preset)}>
                  {preset.name}
                </button>
                <button type="button" onClick={() => onDeletePreset(preset.id)}>
                  x
                </button>
              </div>
            ))
          ) : (
            <span className="radar-muted">Noch keine gespeicherten Filter.</span>
          )}
        </div>
      </section>

      <section className="radar-menu__section">
        <h4>Letzte Fluege</h4>
        <div className="radar-menu__list">
          {recentFlights.length ? (
            recentFlights.map((flight) => (
              <button
                key={flight.icao24}
                type="button"
                className="radar-menu__recent"
                onClick={() => onSelectRecentFlight(flight.icao24)}
              >
                <strong>{flight.label}</strong>
                <span>{flight.subtitle}</span>
              </button>
            ))
          ) : (
            <span className="radar-muted">Noch keine letzten Fluege.</span>
          )}
        </div>
      </section>

      <section className="radar-menu__section">
        <h4>Fleet</h4>
        <div className="radar-menu__list">
          {fleetRows.length ? (
            fleetRows.map((row) => (
              <div key={row.key} className="radar-menu__feature-row">
                <span>{row.label}</span>
                <strong>{formatInteger(row.count)}</strong>
              </div>
            ))
          ) : (
            <span className="radar-muted">Keine Fleet-Daten.</span>
          )}
        </div>
      </section>

      <section className="radar-menu__section">
        <h4>Export</h4>
        {selectedAircraft ? (
          <div className="radar-menu__toggle-grid">
            <button type="button" className="radar-menu__toggle is-active" onClick={onExportTrackCsv}>
              Track CSV
            </button>
            <button type="button" className="radar-menu__toggle is-active" onClick={onExportTrackKml}>
              Track KML
            </button>
          </div>
        ) : (
          <span className="radar-muted">Waehle einen Flug fuer Export.</span>
        )}
      </section>
    </aside>
  );
}

function RadarDock({ activeDock, onChange }) {
  return (
    <nav className="radar-dock" aria-label="Radar dock">
      {RADAR_DOCK_ITEMS.map((item) => (
        <button
          key={item.value}
          type="button"
          className={`radar-dock__button ${activeDock === item.value ? 'is-active' : ''}`}
          onClick={() => onChange(item.value)}
        >
          <span className="radar-dock__icon">{item.icon ?? '::'}</span>
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

function RadarDockPanel({
  activeDock,
  snapshot,
  byType,
  selectedAircraft,
  selectedTrack,
  radarCenter,
  playbackFrames,
  activeFilterCount,
  refreshLabel,
  filteredAircraft,
  topSegment,
  watchlistMatches,
  segmentFilters,
  emitterFilters,
  engineFilters,
  segmentOptions,
  emitterOptions,
  engineOptions,
  weather,
  weatherLoading,
  viewMode,
  onSetViewMode,
  showTrafficPane,
  onToggleTrafficPane,
  showRightPane,
  onToggleRightPane,
  showLabels,
  onToggleLabels,
  publicLayerDefinitions,
  publicLayers,
  publicCountRows,
  publicDataLoading,
  publicDataError,
  publicFeatureCount,
  onTogglePublicLayer,
  recentFlights,
  fleetRows,
  selectedFrameAt,
  onSelectPlaybackFrame,
  onGoLive,
  onToggleSegment,
  onToggleEmitter,
  onToggleEngine,
  onClearFilters,
  onClearSelection,
}) {
  if (activeDock === 'settings') {
    return (
      <section className="radar-card radar-card--info">
        <div className="radar-card__header">
          <div>
            <h3>Settings</h3>
            <span>Map and layout</span>
          </div>
        </div>
        <div className="radar-setting-grid">
          <button
            type="button"
            className={`radar-setting-toggle ${viewMode === '2d' ? 'is-active' : ''}`}
            onClick={() => onSetViewMode('2d')}
          >
            2D map
          </button>
          <button
            type="button"
            className={`radar-setting-toggle ${viewMode === '3d' ? 'is-active' : ''}`}
            onClick={() => onSetViewMode('3d')}
          >
            3D map
          </button>
          <button
            type="button"
            className={`radar-setting-toggle ${showTrafficPane ? 'is-active' : ''}`}
            onClick={onToggleTrafficPane}
          >
            Left pane
          </button>
          <button
            type="button"
            className={`radar-setting-toggle ${showRightPane ? 'is-active' : ''}`}
            onClick={onToggleRightPane}
          >
            Right pane
          </button>
          <button
            type="button"
            className={`radar-setting-toggle ${showLabels ? 'is-active' : ''}`}
            onClick={onToggleLabels}
          >
            Aircraft labels
          </button>
        </div>
        <div className="radar-info-list">
          <div><strong>Refresh</strong><span>{refreshLabel}</span></div>
          <div><strong>Status</strong><span>{snapshot?.stale ? 'Verzoegert' : 'Live'}</span></div>
        </div>
      </section>
    );
  }

  if (activeDock === 'weather') {
    return (
      <section className="radar-card radar-card--info">
        <div className="radar-card__header">
          <div>
            <h3>Weather</h3>
            <span>{weatherLoading ? 'wird geladen' : 'am Kartenzentrum'}</span>
          </div>
        </div>
        <div className="radar-info-list">
          <div><strong>Ort</strong><span>{radarCenter.lat.toFixed(2)} / {radarCenter.lon.toFixed(2)}</span></div>
          <div><strong>Lage</strong><span>{weather ? weatherCodeLabel(weather.weather_code) : 'n/a'}</span></div>
          <div><strong>Temperatur</strong><span>{formatTemperature(weather?.temperature_2m)}</span></div>
          <div><strong>Gefuehlt</strong><span>{formatTemperature(weather?.apparent_temperature)}</span></div>
          <div><strong>Wind</strong><span>{weather ? `${formatInteger(weather.wind_speed_10m, ' km/h')} / ${formatHeading(weather.wind_direction_10m)}` : 'n/a'}</span></div>
          <div><strong>Wolken</strong><span>{weather ? `${formatInteger(weather.cloud_cover, ' %')}` : 'n/a'}</span></div>
        </div>
      </section>
    );
  }

  if (activeDock === 'filters') {
    return (
      <section className="radar-card radar-card--info">
        <div className="radar-card__header">
          <div>
            <h3>Filter</h3>
            <span>{activeFilterCount} aktiv</span>
          </div>
        </div>
        <div className="radar-info-list">
          <div><strong>Sichtbar</strong><span>{formatInteger(filteredAircraft.length)}</span></div>
          <div><strong>Segmente</strong><span>{segmentFilters.length || 'alle'}</span></div>
          <div><strong>Emitter</strong><span>{emitterFilters.length || 'alle'}</span></div>
          <div><strong>Engine</strong><span>{engineFilters.length || 'alle'}</span></div>
        </div>
        <RadarFilterGroup
          title="Flugart"
          options={segmentOptions}
          selectedValues={segmentFilters}
          onToggle={onToggleSegment}
        />
        <RadarFilterGroup
          title="Luftfahrzeugklasse"
          options={emitterOptions}
          selectedValues={emitterFilters}
          onToggle={onToggleEmitter}
        />
        <RadarFilterGroup
          title="Antrieb"
          options={engineOptions}
          selectedValues={engineFilters}
          onToggle={onToggleEngine}
        />
        <div className="radar-session-actions">
          <button
            type="button"
            className="radar-chip radar-chip--button"
            onClick={onClearFilters}
            disabled={!activeFilterCount}
          >
            Alle Filter loeschen
          </button>
        </div>
      </section>
    );
  }

  if (activeDock === 'widgets') {
    return (
      <section className="radar-card radar-card--scope-overlay">
        <div className="radar-card__header">
          <div>
            <h3>Kartenlayer</h3>
            <span>Radar, Infrastruktur und Ereignisse</span>
          </div>
        </div>
        <Suspense fallback={<div className="radar-scope radar-scope--fallback">Scope wird geladen ...</div>}>
          <RadarScope
            aircraft={filteredAircraft}
            center={radarCenter}
            selectedAircraftIcao24={selectedAircraft?.icao24 ?? null}
          />
        </Suspense>
        <div className="radar-info-list">
          <div><strong>Sichtbar</strong><span>{formatInteger(filteredAircraft.length)}</span></div>
          <div><strong>Hauptsegment</strong><span>{topSegment}</span></div>
          <div><strong>Top-Typ</strong><span>{byType[0]?.label ?? 'n/a'}</span></div>
          <div><strong>Open Data</strong><span>{formatInteger(publicFeatureCount)}</span></div>
        </div>
        <div className="radar-setting-grid">
          {publicLayerDefinitions.map((layer) => (
            <button
              key={layer.id}
              type="button"
              className={`radar-setting-toggle ${publicLayers[layer.id] ? 'is-active' : ''}`}
              onClick={() => onTogglePublicLayer(layer.id)}
            >
              {layer.label}
            </button>
          ))}
        </div>
        {publicDataLoading ? <span className="radar-muted">Open-Data-Layer werden geladen ...</span> : null}
        {!publicDataLoading && publicDataError ? <span className="radar-muted">{publicDataError}</span> : null}
        <div className="radar-menu__list">
          {(publicCountRows.length ? publicCountRows : fleetRows).slice(0, 5).map((row) => (
            <div key={row.category ?? row.key} className="radar-menu__feature-row">
              <span>{row.label}</span>
              <strong>{formatInteger(row.count)}</strong>
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (activeDock === 'playback') {
    const selectedIndex = playbackFrames.findIndex((frame) => frame.observedAt === snapshot?.observedAt);
    const sliderValue = selectedIndex >= 0 ? selectedIndex : Math.max(playbackFrames.length - 1, 0);

    return (
      <section className="radar-card radar-card--info">
        <div className="radar-card__header">
          <div>
            <h3>Playback</h3>
            <span>{selectedFrameAt ? 'Historischer Frame' : 'Live-Modus'}</span>
          </div>
        </div>
        <div className="radar-info-list">
          <div><strong>Frames</strong><span>{formatInteger(playbackFrames.length)}</span></div>
          <div><strong>Stand</strong><span>{formatTime(snapshot?.observedAt)}</span></div>
          <div><strong>Track</strong><span>{selectedAircraft ? formatInteger(selectedTrack.length) : 'keine Auswahl'}</span></div>
        </div>
        <div className="radar-playback">
          <input
            type="range"
            min="0"
            max={Math.max(playbackFrames.length - 1, 0)}
            value={sliderValue}
            onChange={(event) => onSelectPlaybackFrame(Number.parseInt(event.target.value, 10))}
            disabled={!playbackFrames.length}
          />
          <div className="radar-playback__actions">
            <button type="button" className="radar-chip radar-chip--button" onClick={onGoLive}>
              Live
            </button>
            {selectedAircraft ? (
              <button type="button" className="radar-chip radar-chip--button" onClick={onClearSelection}>
                Auswahl loeschen
              </button>
            ) : null}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="radar-card radar-card--info">
      <div className="radar-card__header">
        <div>
          <h3>Widgets</h3>
          <span>globale Lage</span>
        </div>
      </div>
      <div className="radar-info-list">
        <div><strong>Sichtbar</strong><span>{formatInteger(filteredAircraft.length)}</span></div>
        <div><strong>Hauptsegment</strong><span>{topSegment}</span></div>
        <div><strong>Top-Typ</strong><span>{byType[0]?.label ?? 'n/a'}</span></div>
        <div><strong>Merkliste</strong><span>{formatInteger(watchlistMatches)}</span></div>
        <div><strong>Status</strong><span>{snapshot?.stale ? 'Verzoegert' : 'Aktiv'}</span></div>
        <div><strong>Kartenzentrum</strong><span>{radarCenter.lat.toFixed(1)} / {radarCenter.lon.toFixed(1)}</span></div>
      </div>
    </section>
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
  const [pageVisible, setPageVisible] = useState(() =>
    typeof document === 'undefined' ? true : document.visibilityState === 'visible',
  );
  const [search, setSearch] = useState('');
  const [segmentFilters, setSegmentFilters] = useState([]);
  const [emitterFilters, setEmitterFilters] = useState([]);
  const [engineFilters, setEngineFilters] = useState([]);
  const [trafficSort, setTrafficSort] = useState('co2');
  const [activeDock, setActiveDock] = useState('widgets');
  const [menuOpen, setMenuOpen] = useState(false);
  const [viewMode, setViewMode] = useState('2d');
  const [showTrafficPane, setShowTrafficPane] = useState(true);
  const [showRightPane, setShowRightPane] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [radarCenter, setRadarCenter] = useState({ lat: 18, lon: 11.5 });
  const [selectedAircraftIcao24, setSelectedAircraftIcao24] = useState(null);
  const [selectedTrack, setSelectedTrack] = useState([]);
  const [trackLoading, setTrackLoading] = useState(false);
  const [followSelected, setFollowSelected] = useState(false);
  const [selectedFrameAt, setSelectedFrameAt] = useState(null);
  const [selectedMedia, setSelectedMedia] = useState(null);
  const [selectedMediaLoading, setSelectedMediaLoading] = useState(false);
  const [watchTerms, setWatchTerms] = useState(() => loadLocalState(WATCH_TERMS_KEY, []));
  const [filterPresets, setFilterPresets] = useState(() => loadLocalState(FILTER_PRESETS_KEY, []));
  const [recentFlights, setRecentFlights] = useState(() => loadLocalState(RECENT_FLIGHTS_KEY, []));
  const [publicLayers, setPublicLayers] = useState(() =>
    normalizePublicLayers(loadLocalState(PUBLIC_LAYERS_KEY, DEFAULT_PUBLIC_LAYERS)),
  );
  const [publicFeatures, setPublicFeatures] = useState(() => emptyFeatureCollection());
  const [publicFeatureMeta, setPublicFeatureMeta] = useState(null);
  const [publicDataLoading, setPublicDataLoading] = useState(false);
  const [publicDataError, setPublicDataError] = useState(null);
  const [mapViewport, setMapViewport] = useState(null);
  const [presetName, setPresetName] = useState('');
  const [watchInput, setWatchInput] = useState('');
  const [alertEvents, setAlertEvents] = useState([]);
  const [weather, setWeather] = useState(null);
  const [weatherLoading, setWeatherLoading] = useState(false);

  const seenWatchTermsRef = useRef(new Set());
  const searchInputRef = useRef(null);
  const rightPaneRef = useRef(null);
  const deferredSearch = useDeferredValue(search);
  const refreshIntervalMs = snapshot?.refreshIntervalMs ?? 15_000;
  const refreshLabel = formatRefreshInterval(refreshIntervalMs);
  const activePublicLayers = useMemo(
    () => PUBLIC_LAYER_DEFINITIONS.filter((item) => publicLayers[item.id]),
    [publicLayers],
  );
  const activePublicFeatureLayerIds = useMemo(
    () => activePublicLayers.filter((item) => item.kind === 'feature').map((item) => item.id),
    [activePublicLayers],
  );
  const publicLayerCounts = publicFeatureMeta?.counts ?? {};
  const publicCountRows = useMemo(
    () =>
      Object.entries(publicLayerCounts)
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .map(([category, count]) => ({
          category,
          label: getPublicCountLabel(category),
          count,
        })),
    [publicLayerCounts],
  );

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

  const refreshSnapshot = useEffectEvent(async ({ silent = false, at = null } = {}) => {
    if (!session) {
      return;
    }

    if (!silent) {
      setLoading(true);
    }

    try {
      const url = new URL('/api/live', window.location.origin);
      if (at) {
        url.searchParams.set('at', at);
      }

      const response = await fetch(url, { credentials: 'include' });
      if (response.status === 401) {
        setSession(null);
        setSnapshot(null);
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
      setError(requestError instanceof Error ? requestError.message : 'Live-Daten konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  });

  useEffect(() => {
    refreshSession();
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      setPageVisible(document.visibilityState === 'visible');
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  useEffect(() => {
    if (!session) {
      setSnapshot(null);
      setSelectedTrack([]);
      return;
    }

    refreshSnapshot({ at: selectedFrameAt });
  }, [selectedFrameAt, session]);

  useEffect(() => {
    if (!session || !pageVisible || selectedFrameAt) {
      return undefined;
    }

    const timer = window.setInterval(() => refreshSnapshot({ silent: true }), refreshIntervalMs);
    return () => window.clearInterval(timer);
  }, [pageVisible, refreshIntervalMs, selectedFrameAt, session]);

  useEffect(() => {
    if (!session || !pageVisible || selectedFrameAt) {
      return;
    }

    refreshSnapshot({ silent: true });
  }, [pageVisible, selectedFrameAt, session]);

  useEffect(() => {
    persistLocalState(WATCH_TERMS_KEY, watchTerms);
  }, [watchTerms]);

  useEffect(() => {
    persistLocalState(FILTER_PRESETS_KEY, filterPresets);
  }, [filterPresets]);

  useEffect(() => {
    persistLocalState(RECENT_FLIGHTS_KEY, recentFlights);
  }, [recentFlights]);

  useEffect(() => {
    persistLocalState(PUBLIC_LAYERS_KEY, publicLayers);
  }, [publicLayers]);

  useEffect(() => {
    if (!session || !selectedAircraftIcao24) {
      setSelectedTrack([]);
      setTrackLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    setTrackLoading(true);

    fetch(`/api/live/track/${selectedAircraftIcao24}?limit=18`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) {
          setSession(null);
          setSnapshot(null);
          return null;
        }

        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error ?? `Track API antwortet mit ${response.status}`);
        }

        return response.json();
      })
      .then((payload) => {
        if (!payload) {
          return;
        }

        setSelectedTrack(Array.isArray(payload.points) ? payload.points : []);
      })
      .catch((requestError) => {
        if (requestError?.name === 'AbortError') {
          return;
        }

        console.error(requestError);
        setSelectedTrack([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setTrackLoading(false);
        }
      });

    return () => controller.abort();
  }, [selectedAircraftIcao24, session, snapshot?.observedAt]);

  useEffect(() => {
    if (activeDock !== 'weather' && !menuOpen) {
      return undefined;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setWeatherLoading(true);

      try {
        const url = new URL('https://api.open-meteo.com/v1/forecast');
        url.searchParams.set('latitude', radarCenter.lat.toFixed(4));
        url.searchParams.set('longitude', radarCenter.lon.toFixed(4));
        url.searchParams.set(
          'current',
          'temperature_2m,apparent_temperature,precipitation,cloud_cover,wind_speed_10m,wind_direction_10m,weather_code',
        );
        url.searchParams.set('timezone', 'auto');

        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`Weather API antwortet mit ${response.status}`);
        }

        const payload = await response.json();
        if (!controller.signal.aborted) {
          setWeather(payload.current ?? null);
        }
      } catch (requestError) {
        if (!controller.signal.aborted) {
          console.warn('weather lookup failed', requestError);
          setWeather(null);
        }
      } finally {
        if (!controller.signal.aborted) {
          setWeatherLoading(false);
        }
      }
    }, 360);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [activeDock, menuOpen, radarCenter.lat, radarCenter.lon]);

  useEffect(() => {
    if (!session) {
      setPublicFeatures(emptyFeatureCollection());
      setPublicFeatureMeta(null);
      setPublicDataLoading(false);
      setPublicDataError(null);
      return undefined;
    }

    if (!mapViewport || !activePublicFeatureLayerIds.length) {
      setPublicFeatures(emptyFeatureCollection());
      setPublicFeatureMeta(null);
      setPublicDataLoading(false);
      setPublicDataError(null);
      return undefined;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setPublicDataLoading(true);

      try {
        const url = new URL('/api/public/features', window.location.origin);
        url.searchParams.set('layers', activePublicFeatureLayerIds.join(','));
        url.searchParams.set('west', String(mapViewport.west));
        url.searchParams.set('south', String(mapViewport.south));
        url.searchParams.set('east', String(mapViewport.east));
        url.searchParams.set('north', String(mapViewport.north));
        url.searchParams.set('zoom', String(mapViewport.zoom));

        const response = await fetch(url, {
          credentials: 'include',
          signal: controller.signal,
        });

        if (response.status === 401) {
          setSession(null);
          setSnapshot(null);
          return;
        }

        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error ?? `Open-Data-API antwortet mit ${response.status}`);
        }

        const payload = await response.json();
        if (!controller.signal.aborted) {
          setPublicFeatures({
            type: 'FeatureCollection',
            features: Array.isArray(payload.features) ? payload.features : [],
          });
          setPublicFeatureMeta(payload.meta ?? null);
          setPublicDataError(
            Array.isArray(payload.warnings) && payload.warnings.length ? payload.warnings[0] : null,
          );
        }
      } catch (requestError) {
        if (!controller.signal.aborted) {
          setPublicDataError(
            requestError instanceof Error
              ? requestError.message
              : 'Open-Data-Layer konnten nicht geladen werden.',
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setPublicDataLoading(false);
        }
      }
    }, 240);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [
    activePublicFeatureLayerIds,
    mapViewport,
    session,
  ]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      const target = event.target;
      const isTextInput =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

      if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey && !isTextInput) {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      if (event.key !== 'Escape') {
        return;
      }

      if (document.activeElement === searchInputRef.current && search) {
        setSearch('');
        return;
      }

      if (selectedAircraftIcao24) {
        clearSelection();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [search, selectedAircraftIcao24]);

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
    }

    seenWatchTermsRef.current = nextSeen;
  }, [snapshot, watchTerms]);

  const allAircraft = snapshot?.aircraft ?? [];
  const query = deferredSearch.trim().toLowerCase();
  const filteredAircraft = useMemo(
    () =>
      allAircraft.filter((entry) => {
        const segmentMatch = !segmentFilters.length || segmentFilters.includes(entry.operationSegment);
        const emitterMatch = !emitterFilters.length || emitterFilters.includes(entry.emitterCategory);
        const engineMatch = !engineFilters.length || engineFilters.includes(entry.engineType);
        const searchMatch = !query || aircraftSearchBlob(entry).includes(query);
        return segmentMatch && emitterMatch && engineMatch && searchMatch;
      }),
    [allAircraft, emitterFilters, engineFilters, query, segmentFilters],
  );

  const filteredTotals = useMemo(
    () =>
      filteredAircraft.reduce(
        (accumulator, entry) => {
          accumulator.fuelLitersPerHour += entry.fuelLitersPerHour ?? 0;
          accumulator.co2KgPerHour += entry.co2KgPerHour ?? 0;
          return accumulator;
        },
        { fuelLitersPerHour: 0, co2KgPerHour: 0 },
      ),
    [filteredAircraft],
  );

  const trafficRows = useMemo(
    () => [...filteredAircraft].sort((left, right) => compareTrafficRows(left, right, trafficSort)).slice(0, 24),
    [filteredAircraft, trafficSort],
  );

  useEffect(() => {
    if (selectedAircraftIcao24 && !filteredAircraft.some((entry) => entry.icao24 === selectedAircraftIcao24)) {
      clearSelection();
    }
  }, [filteredAircraft, selectedAircraftIcao24]);

  const selectedAircraft = useMemo(
    () => filteredAircraft.find((entry) => entry.icao24 === selectedAircraftIcao24) ?? null,
    [filteredAircraft, selectedAircraftIcao24],
  );

  const bySegment = useMemo(
    () => groupByAircraft(filteredAircraft, (entry) => entry.operationSegment, (entry) => entry.operationSegment),
    [filteredAircraft],
  );

  const segmentOptions = useMemo(
    () =>
      groupByAircraft(
        allAircraft,
        (entry) => entry.operationSegment ?? 'Unbekannt',
        (entry, key) => entry.operationSegment ?? key,
        6,
      ),
    [allAircraft],
  );

  const emitterOptions = useMemo(
    () =>
      groupByAircraft(
        allAircraft,
        (entry) => entry.emitterCategory ?? 'Unbekannt',
        (entry, key) => entry.emitterCategory ?? key,
        6,
      ),
    [allAircraft],
  );

  const engineOptions = useMemo(
    () =>
      groupByAircraft(
        allAircraft,
        (entry) => entry.engineType ?? 'Unbekannt',
        (entry, key) => entry.engineType ?? key,
        6,
      ),
    [allAircraft],
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

  const activeFilterCount = segmentFilters.length + emitterFilters.length + engineFilters.length;
  const topSegment = bySegment[0]?.label ?? 'n/a';
  const topType = byType[0]?.label ?? 'n/a';
  const playbackFrames = snapshot?.playback?.frames ?? [];
  const watchlistMatches = useMemo(
    () =>
      filteredAircraft.filter((entry) => watchTerms.some((term) => matchesWatchTerm(entry, term))).length,
    [filteredAircraft, watchTerms],
  );
  const fleetRows = useMemo(
    () =>
      groupByAircraft(
        filteredAircraft,
        (entry) => entry.operator ?? entry.owner ?? entry.originCountry,
        (entry, key) => entry.operator ?? entry.owner ?? key,
        8,
      ),
    [filteredAircraft],
  );

  useEffect(() => {
    if (!selectedAircraft) {
      return;
    }

    const entry = {
      icao24: selectedAircraft.icao24,
      label: primaryLabel(selectedAircraft),
      subtitle: selectedAircraft.operator ?? selectedAircraft.originCountry ?? selectedAircraft.typecode ?? 'n/a',
    };

    setRecentFlights((current) => [entry, ...current.filter((item) => item.icao24 !== entry.icao24)].slice(0, 12));
  }, [selectedAircraft]);

  useEffect(() => {
    if (!session || !selectedAircraft) {
      setSelectedMedia(null);
      setSelectedMediaLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    const params = new URLSearchParams();
    const mediaFields = {
      typecode: selectedAircraft.typecode,
      typeFamily: selectedAircraft.typeFamily,
      manufacturerName: selectedAircraft.manufacturerName,
      model: selectedAircraft.model,
      operator: selectedAircraft.operator,
      owner: selectedAircraft.owner,
    };

    for (const [key, value] of Object.entries(mediaFields)) {
      if (value) {
        params.set(key, value);
      }
    }

    setSelectedMediaLoading(true);
    fetch(`/api/aircraft/media?${params.toString()}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error ?? `Media API antwortet mit ${response.status}`);
        }

        return response.json();
      })
      .then((payload) => {
        if (!controller.signal.aborted) {
          setSelectedMedia(payload.media ?? null);
        }
      })
      .catch((requestError) => {
        if (!controller.signal.aborted) {
          console.warn('aircraft media lookup failed', requestError);
          setSelectedMedia(null);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setSelectedMediaLoading(false);
        }
      });

    return () => controller.abort();
  }, [
    selectedAircraft?.icao24,
    selectedAircraft?.typecode,
    selectedAircraft?.typeFamily,
    selectedAircraft?.manufacturerName,
    selectedAircraft?.model,
    selectedAircraft?.operator,
    selectedAircraft?.owner,
    session,
  ]);

  useEffect(() => {
    if (!selectedAircraftIcao24) {
      return;
    }

    setShowRightPane(true);
    window.requestAnimationFrame(() => {
      rightPaneRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }, [selectedAircraftIcao24]);

  function addWatchTerm(value) {
    const normalized = normalizeWatchTerm(value);
    if (!normalized) {
      return;
    }

    setWatchTerms((current) => (current.includes(normalized) ? current : [normalized, ...current].slice(0, 12)));
    setWatchInput('');
  }

  function clearActiveFilters() {
    setSegmentFilters([]);
    setEmitterFilters([]);
    setEngineFilters([]);
  }

  function togglePublicLayer(layerId) {
    setPublicLayers((current) => ({
      ...current,
      [layerId]: !current[layerId],
    }));
    setActiveDock('widgets');
  }

  function saveCurrentPreset() {
    const normalizedName = presetName.trim();
    if (!normalizedName) {
      return;
    }

    const nextPreset = {
      id: makeId('preset'),
      name: normalizedName,
      search,
      trafficSort,
      segmentFilters,
      emitterFilters,
      engineFilters,
    };

    setFilterPresets((current) => [nextPreset, ...current].slice(0, 12));
    setPresetName('');
  }

  function applyPreset(preset) {
    setSearch(preset.search ?? '');
    setTrafficSort(preset.trafficSort ?? 'co2');
    setSegmentFilters(Array.isArray(preset.segmentFilters) ? preset.segmentFilters : []);
    setEmitterFilters(Array.isArray(preset.emitterFilters) ? preset.emitterFilters : []);
    setEngineFilters(Array.isArray(preset.engineFilters) ? preset.engineFilters : []);
    setActiveDock('filters');
    setMenuOpen(false);
  }

  function deletePreset(presetId) {
    setFilterPresets((current) => current.filter((preset) => preset.id !== presetId));
  }

  function clearSelection() {
    setSelectedAircraftIcao24(null);
    setSelectedTrack([]);
    setFollowSelected(false);
    setSelectedMedia(null);
    setSelectedMediaLoading(false);
  }

  function cycleTrafficSort() {
    const currentIndex = TRAFFIC_SORT_OPTIONS.findIndex((option) => option.value === trafficSort);
    const nextOption = TRAFFIC_SORT_OPTIONS[(currentIndex + 1) % TRAFFIC_SORT_OPTIONS.length];
    setTrafficSort(nextOption.value);
  }

  function handleSelectPlaybackFrame(index) {
    const frame = playbackFrames[index] ?? null;
    if (!frame) {
      return;
    }

    setSelectedFrameAt(frame.observedAt);
  }

  function goLive() {
    setSelectedFrameAt(null);
    refreshSnapshot({ at: null });
  }

  function selectRecentFlight(icao24) {
    setSelectedAircraftIcao24(icao24);
    setMenuOpen(false);
  }

  function exportTrackCsv() {
    if (!selectedAircraft || !selectedTrack.length) {
      return;
    }

    const lines = [
      'observedAt,latitude,longitude,geoAltitudeM,baroAltitudeM,velocityMps,trackDeg',
      ...selectedTrack.map(
        (point) =>
          [
            point.observedAt,
            point.latitude ?? '',
            point.longitude ?? '',
            point.geoAltitudeM ?? '',
            point.baroAltitudeM ?? '',
            point.velocityMps ?? '',
            point.trackDeg ?? '',
          ].join(','),
      ),
    ];

    triggerTextDownload(`${slugify(primaryLabel(selectedAircraft))}-track.csv`, 'text/csv;charset=utf-8', lines.join('\n'));
  }

  function exportTrackKml() {
    if (!selectedAircraft || !selectedTrack.length) {
      return;
    }

    const coordinates = selectedTrack
      .filter((point) => typeof point.longitude === 'number' && typeof point.latitude === 'number')
      .map((point) => `${point.longitude},${point.latitude},${Math.round(point.geoAltitudeM ?? point.baroAltitudeM ?? 0)}`)
      .join(' ');

    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${primaryLabel(selectedAircraft)}</name>
    <Placemark>
      <name>${primaryLabel(selectedAircraft)}</name>
      <LineString>
        <tessellate>1</tessellate>
        <coordinates>${coordinates}</coordinates>
      </LineString>
    </Placemark>
  </Document>
</kml>`;

    triggerTextDownload(`${slugify(primaryLabel(selectedAircraft))}-track.kml`, 'application/vnd.google-earth.kml+xml', kml);
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
    clearSelection();
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
    <main className="app-shell app-shell--radar-console">
      <div className="radar-console">
        <Suspense fallback={<div className="radar-fallback radar-fallback--viewport">Radaransicht wird geladen ...</div>}>
          <RadarMap
            aircraft={filteredAircraft}
            onCenterChange={setRadarCenter}
            onViewportChange={setMapViewport}
            selectedAircraftIcao24={selectedAircraftIcao24}
            selectedTrack={selectedTrack}
            publicFeatures={publicFeatures}
            publicLayers={publicLayers}
            followSelected={followSelected}
            viewMode={viewMode}
            showLabels={showLabels}
            onSelectAircraft={setSelectedAircraftIcao24}
          />
        </Suspense>

        <RadarCommandBar
          searchInputRef={searchInputRef}
          search={search}
          onSearchChange={setSearch}
          visibleCount={filteredAircraft.length}
          activeFilterCount={activeFilterCount}
          refreshLabel={refreshLabel}
          snapshot={snapshot}
          selectedAircraft={selectedAircraft}
          selectedFrameAt={selectedFrameAt}
          session={session}
          onRefresh={() => refreshSnapshot()}
          onGoLive={goLive}
          onToggleMenu={() => setMenuOpen((current) => !current)}
          isMenuOpen={menuOpen}
        />

        <RadarBurgerMenu
          open={menuOpen}
          session={session}
          premiumItems={PREMIUM_FEATURE_ITEMS}
          dataCatalog={PUBLIC_DATA_CATALOG}
          publicLayerDefinitions={PUBLIC_LAYER_DEFINITIONS}
          publicLayers={publicLayers}
          publicCountRows={publicCountRows}
          publicDataLoading={publicDataLoading}
          publicDataError={publicDataError}
          onTogglePublicLayer={togglePublicLayer}
          filterPresets={filterPresets}
          presetName={presetName}
          onPresetNameChange={setPresetName}
          onSavePreset={saveCurrentPreset}
          onApplyPreset={applyPreset}
          onDeletePreset={deletePreset}
          recentFlights={recentFlights}
          onSelectRecentFlight={selectRecentFlight}
          fleetRows={fleetRows}
          selectedAircraft={selectedAircraft}
          onExportTrackCsv={exportTrackCsv}
          onExportTrackKml={exportTrackKml}
          viewMode={viewMode}
          onSetViewMode={setViewMode}
          showTrafficPane={showTrafficPane}
          onToggleTrafficPane={() => setShowTrafficPane((current) => !current)}
          showRightPane={showRightPane}
          onToggleRightPane={() => setShowRightPane((current) => !current)}
          showLabels={showLabels}
          onToggleLabels={() => setShowLabels((current) => !current)}
          onClose={() => setMenuOpen(false)}
        />

        <div className="radar-overlay radar-overlay--topright">
          <button
            type="button"
            className="radar-view-switch"
            onClick={() => setViewMode((current) => (current === '2d' ? '3d' : '2d'))}
          >
            <span>ANSICHT</span>
            <strong>{viewMode === '3d' ? '3D' : 'Map'}</strong>
            <span>v</span>
          </button>
        </div>

        <div className="radar-overlay radar-overlay--tools">
          <button
            type="button"
            className={`radar-round-button ${followSelected ? 'is-active' : ''}`}
            onClick={() => setFollowSelected((current) => !current)}
            title="Karte folgt dem Flugzeug"
          >
            Folg
          </button>
          <button type="button" className="radar-round-button" onClick={() => refreshSnapshot()} title="Jetzt aktualisieren">
            Live
          </button>
          <button type="button" className="radar-round-button" onClick={clearSelection} title="Auswahl loeschen">
            Aus
          </button>
        </div>

        {snapshot?.warning ? (
          <div className="radar-overlay radar-overlay--warning">
            <div className="radar-warning-banner">{snapshot.warning}</div>
          </div>
        ) : null}

        {showTrafficPane ? (
          <aside className="radar-pane radar-pane--left">
            <RadarTrafficOverlay
              rows={trafficRows}
              sortMode={trafficSort}
              onSortChange={cycleTrafficSort}
              selectedAircraftIcao24={selectedAircraftIcao24}
              onSelectAircraft={setSelectedAircraftIcao24}
            />
            <RadarDisruptionOverlay warning={snapshot?.warning} alertEvents={alertEvents} bySegment={bySegment} />
            <RadarBookmarksOverlay
              watchTerms={watchTerms}
              watchInput={watchInput}
              onWatchInputChange={setWatchInput}
              onAddWatch={addWatchTerm}
              onRemoveWatch={(term) => setWatchTerms((current) => current.filter((entry) => entry !== term))}
            />
          </aside>
        ) : null}

        {showRightPane ? (
          <aside ref={rightPaneRef} className="radar-pane radar-pane--right">
            <RadarSelectedOverlay
              aircraft={selectedAircraft}
              track={selectedTrack}
              loading={trackLoading}
              followSelected={followSelected}
              aircraftMedia={selectedMedia}
              aircraftMediaLoading={selectedMediaLoading}
              onToggleFollow={setFollowSelected}
              onClearSelection={clearSelection}
            />
            <RadarDockPanel
              activeDock={activeDock}
              snapshot={snapshot}
              byType={byType}
              selectedAircraft={selectedAircraft}
              selectedTrack={selectedTrack}
              radarCenter={radarCenter}
              playbackFrames={playbackFrames}
              activeFilterCount={activeFilterCount}
              refreshLabel={refreshLabel}
              filteredAircraft={filteredAircraft}
              topSegment={topSegment}
              watchlistMatches={watchlistMatches}
              segmentFilters={segmentFilters}
              emitterFilters={emitterFilters}
              engineFilters={engineFilters}
              segmentOptions={segmentOptions}
              emitterOptions={emitterOptions}
              engineOptions={engineOptions}
              weather={weather}
              weatherLoading={weatherLoading}
              viewMode={viewMode}
              onSetViewMode={setViewMode}
              showTrafficPane={showTrafficPane}
              onToggleTrafficPane={() => setShowTrafficPane((current) => !current)}
              showRightPane={showRightPane}
              onToggleRightPane={() => setShowRightPane((current) => !current)}
              showLabels={showLabels}
              onToggleLabels={() => setShowLabels((current) => !current)}
              publicLayerDefinitions={PUBLIC_LAYER_DEFINITIONS}
              publicLayers={publicLayers}
              publicCountRows={publicCountRows}
              publicDataLoading={publicDataLoading}
              publicDataError={publicDataError}
              publicFeatureCount={publicFeatures.features.length}
              onTogglePublicLayer={togglePublicLayer}
              recentFlights={recentFlights}
              fleetRows={fleetRows}
              selectedFrameAt={selectedFrameAt}
              onSelectPlaybackFrame={handleSelectPlaybackFrame}
              onGoLive={goLive}
              onToggleSegment={(value) => setSegmentFilters((current) => toggleValue(current, value))}
              onToggleEmitter={(value) => setEmitterFilters((current) => toggleValue(current, value))}
              onToggleEngine={(value) => setEngineFilters((current) => toggleValue(current, value))}
              onClearFilters={clearActiveFilters}
              onClearSelection={clearSelection}
            />
            <section className="radar-card radar-card--info">
              <div className="radar-card__header">
                <div>
                  <h3>Live-Ueberblick</h3>
                  <span>weltweite Lage</span>
                </div>
              </div>
              <div className="radar-info-list">
                <div><strong>Sichtbar</strong><span>{formatInteger(filteredAircraft.length)}</span></div>
                <div><strong>CO2 / h</strong><span>{formatCompactNumber(filteredTotals.co2KgPerHour, ' kg')}</span></div>
                <div><strong>Abdeckung</strong><span>{Math.round((snapshot?.metadata?.coverageRatio ?? 0) * 100)} %</span></div>
              </div>
            </section>
            <section className="radar-card radar-card--info">
              <div className="radar-card__header">
                <div>
                  <h3>Offene Daten</h3>
                  <span>Marine, Energie und Ereignisse</span>
                </div>
              </div>
              <div className="radar-info-list">
                <div><strong>Layer aktiv</strong><span>{formatInteger(activePublicLayers.length)}</span></div>
                <div><strong>Objekte</strong><span>{formatInteger(publicFeatures.features.length)}</span></div>
                <div><strong>Status</strong><span>{publicDataLoading ? 'Laedt' : publicDataError ? 'Teilweise' : 'Aktiv'}</span></div>
              </div>
              <div className="radar-setting-grid">
                {PUBLIC_LAYER_DEFINITIONS.slice(0, 4).map((layer) => (
                  <button
                    key={layer.id}
                    type="button"
                    className={`radar-setting-toggle ${publicLayers[layer.id] ? 'is-active' : ''}`}
                    onClick={() =>
                      setPublicLayers((current) => ({
                        ...current,
                        [layer.id]: !current[layer.id],
                      }))
                    }
                  >
                    {layer.label}
                  </button>
                ))}
              </div>
            </section>
            <section className="radar-card radar-card--info">
              <div className="radar-card__header">
                <div>
                  <h3>Merkliste & Sitzung</h3>
                  <span>{session.username}</span>
                </div>
              </div>
              <div className="radar-info-list">
                <div><strong>Treffer</strong><span>{formatInteger(watchlistMatches)}</span></div>
                <div><strong>Refresh</strong><span>{refreshLabel}</span></div>
                <div><strong>Status</strong><span>{snapshot?.stale ? 'Verzoegert' : 'Live'}</span></div>
              </div>
              <div className="radar-session-actions">
                <button type="button" className="radar-chip radar-chip--button" onClick={clearActiveFilters}>
                  Filter loeschen
                </button>
                <button type="button" className="radar-chip radar-chip--button" onClick={handleLogout}>
                  Abmelden
                </button>
              </div>
            </section>
          </aside>
        ) : null}

        <RadarDock activeDock={activeDock} onChange={setActiveDock} />
      </div>

      {loading ? <div className="floating-state">Live-Daten werden geladen ...</div> : null}
      {error ? <div className="floating-state floating-state--error">{error}</div> : null}
    </main>
  );
}
