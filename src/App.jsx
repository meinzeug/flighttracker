import { startTransition, useDeferredValue, useEffect, useEffectEvent, useState } from 'react';

import { RadarMap } from './components/RadarMap';
import { RadarScope } from './components/RadarScope';
import { getSegmentColor } from './lib/segments';

function formatCompactNumber(value, suffix = '') {
  return new Intl.NumberFormat('de-DE', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value) + suffix;
}

function formatInteger(value, suffix = '') {
  return new Intl.NumberFormat('de-DE').format(value) + suffix;
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

export default function App() {
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [segmentFilters, setSegmentFilters] = useState([]);
  const [emitterFilters, setEmitterFilters] = useState([]);
  const [engineFilters, setEngineFilters] = useState([]);
  const [radarCenter, setRadarCenter] = useState({ lat: 22, lon: 8.5 });

  const deferredSearch = useDeferredValue(search);

  const refreshSnapshot = useEffectEvent(async ({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
    }

    try {
      const response = await fetch('/api/live');
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
    const timer = window.setInterval(() => refreshSnapshot({ silent: true }), 45000);
    return () => window.clearInterval(timer);
  }, [refreshSnapshot]);

  const query = deferredSearch.trim().toLowerCase();
  const allAircraft = snapshot?.aircraft ?? [];
  const filteredAircraft = allAircraft.filter((entry) => {
    const segmentMatch = !segmentFilters.length || segmentFilters.includes(entry.operationSegment);
    const emitterMatch = !emitterFilters.length || emitterFilters.includes(entry.emitterCategory);
    const engineMatch = !engineFilters.length || engineFilters.includes(entry.engineType);
    const searchMatch =
      !query ||
      [
        entry.callsign,
        entry.registration,
        entry.icao24,
        entry.model,
        entry.typecode,
        entry.operator,
        entry.owner,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query);

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

  return (
    <main className="app-shell">
      <section className="hero">
        <div className="hero__copy">
          <span className="eyebrow">Live OpenSky Pollution Radar</span>
          <h1>Flugzeuge im Himmel. Kerosin im Takt. CO2 live hochgerechnet.</h1>
          <p>
            Dieses Dashboard schaetzt in Echtzeit, wie die aktuell sichtbare globale Flugflotte
            gerade Kerosin verbrennt. Filtere nach Passenger, Cargo, Military und weiteren Gruppen,
            springe auf die Radar-Karte und beobachte die momentane Belastung.
          </p>
        </div>
        <div className="hero__status">
          <span className={`live-pill ${snapshot?.stale ? 'is-stale' : 'is-live'}`}>
            {snapshot?.stale ? 'Stale Snapshot' : 'Live Snapshot'}
          </span>
          <span>{snapshot ? `Stand ${new Date(snapshot.observedAt).toLocaleString('de-DE')}` : 'Lade Live-Daten ...'}</span>
          <span>{snapshot?.warning ?? 'OpenSky + OpenSky Aircraft DB'}</span>
        </div>
      </section>

      <section className="metrics-grid">
        <MetricCard
          eyebrow="Aktive Flugzeuge"
          value={snapshot ? formatInteger(filteredAircraft.length) : '...'}
          caption="momentan in der Luft und im aktuellen Filter"
          tone="lime"
        />
        <MetricCard
          eyebrow="Kerosin / Stunde"
          value={snapshot ? `${formatCompactNumber(filteredTotals.fuelLitersPerHour)} L` : '...'}
          caption="Hochrechnung auf dem aktuellen Flugbild"
          tone="amber"
        />
        <MetricCard
          eyebrow="CO2 / Stunde"
          value={snapshot ? `${formatCompactNumber(filteredTotals.co2KgPerHour)} kg` : '...'}
          caption="direkte Verbrennungs-Emissionen"
          tone="red"
        />
        <MetricCard
          eyebrow="Typauflösung"
          value={snapshot ? `${Math.round((snapshot.metadata.coverageRatio ?? 0) * 100)} %` : '...'}
          caption="Anteil mit Modell oder Typcode statt Fallback"
          tone="blue"
        />
      </section>

      <section className="filters-panel panel">
        <div className="panel__header">
          <h2>Filter</h2>
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
            <h2>Globales Radar</h2>
            <span>{formatInteger(filteredAircraft.length)} Ziele im Filter</span>
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
        <section className="panel">
          <div className="panel__header">
            <h3>Methodik</h3>
          </div>
          <div className="method-list">
            <div>
              <strong>Live-Flotte</strong>
              <p>{snapshot?.totals.airborneAircraft ? `${formatInteger(snapshot.totals.airborneAircraft)} Flugzeuge` : '...'} aus OpenSky `states/all?extended=1`.</p>
            </div>
            <div>
              <strong>Typanalyse</strong>
              <p>{snapshot?.assumptions.fuelModel ?? 'Wird geladen ...'}</p>
            </div>
            <div>
              <strong>CO2-Faktor</strong>
              <p>{snapshot?.assumptions.co2Model ?? 'Wird geladen ...'}</p>
            </div>
            <div>
              <strong>Metadatenstatus</strong>
              <p>
                {snapshot
                  ? `${formatInteger(snapshot.metadata.aircraftLookupCacheSize)} gelookupte ICAO24, Datenbank ${snapshot.metadata.aircraftDbReady ? 'bereit' : 'waermt auf'}`
                  : '...'}
              </p>
            </div>
          </div>
        </section>
      </section>

      {loading ? <div className="floating-state">Live-Daten werden geladen ...</div> : null}
      {error ? <div className="floating-state floating-state--error">{error}</div> : null}
    </main>
  );
}
