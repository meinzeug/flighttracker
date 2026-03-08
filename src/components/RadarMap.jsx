import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { IconLayer } from '@deck.gl/layers';
import { MapboxOverlay } from '@deck.gl/mapbox';

import { RADAR_MAP_STYLE } from '../lib/map-style';
import { getSegmentColor, getSegmentRgb } from '../lib/segments';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function createPlaneIcon(color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <path fill="${color}" d="M36 4c-2 0-4 1.7-4 3.8v15.5L18.5 28c-1.2.4-2.1 1.5-2.4 2.8L14 38l18 2v10l-5 4v4l5-1 5 1v-4l-5-4V40l18-2-2.1-7.2c-.4-1.3-1.3-2.4-2.5-2.8L32 23.3V7.8C32 5.7 34 4 36 4z"/>
  </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

const iconCache = new Map();

function getPlaneIconUrl(segment) {
  if (!iconCache.has(segment)) {
    iconCache.set(segment, createPlaneIcon(getSegmentColor(segment)));
  }

  return iconCache.get(segment);
}

export function RadarMap({ aircraft, onCenterChange }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const deckRef = useRef(null);
  const [tooltip, setTooltip] = useState(null);

  useEffect(() => {
    if (!containerRef.current) {
      return undefined;
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: RADAR_MAP_STYLE,
      center: [8.5, 22],
      zoom: 1.55,
      minZoom: 1,
      maxZoom: 7,
      pitch: 0,
      attributionControl: false,
    });

    mapRef.current = map;

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    const overlay = new MapboxOverlay({ interleaved: false });
    deckRef.current = overlay;
    map.addControl(overlay);

    const emitCenter = () => {
      const center = map.getCenter();
      onCenterChange?.({ lat: center.lat, lon: center.lng });
    };

    map.on('load', emitCenter);
    map.on('moveend', emitCenter);

    return () => {
      overlay.finalize();
      map.remove();
      mapRef.current = null;
      deckRef.current = null;
    };
  }, [onCenterChange]);

  useEffect(() => {
    if (!deckRef.current) {
      return;
    }

    const points = aircraft
      .filter((entry) => typeof entry.longitude === 'number' && typeof entry.latitude === 'number')
      .map((entry) => ({
        ...entry,
        iconUrl: getPlaneIconUrl(entry.operationSegment),
        color: getSegmentRgb(entry.operationSegment),
      }));

    const layer = new IconLayer({
      id: 'aircraft-icons',
      data: points,
      pickable: true,
      billboard: true,
      getPosition: (entry) => [entry.longitude, entry.latitude],
      getIcon: (entry) => ({
        url: entry.iconUrl,
        width: 64,
        height: 64,
        anchorY: 32,
        anchorX: 32,
      }),
      getAngle: (entry) => entry.trackDeg ?? 0,
      getColor: (entry) => entry.color,
      getSize: (entry) => clamp(18 + Math.log10((entry.co2KgPerHour ?? 20) + 10) * 8, 18, 42),
      sizeUnits: 'pixels',
      alphaCutoff: 0.1,
      onHover: ({ object, x, y }) => {
        if (!object) {
          setTooltip(null);
          return;
        }

        setTooltip({
          x,
          y,
          entry: object,
        });
      },
      onClick: ({ object }) => {
        if (!object || !mapRef.current) {
          return;
        }

        mapRef.current.easeTo({
          center: [object.longitude, object.latitude],
          zoom: Math.max(mapRef.current.getZoom(), 5),
          duration: 700,
        });
      },
      updateTriggers: {
        getSize: points.map((entry) => entry.co2KgPerHour).join('|'),
        getAngle: points.map((entry) => entry.trackDeg).join('|'),
      },
    });

    deckRef.current.setProps({ layers: [layer] });
  }, [aircraft]);

  return (
    <div className="radar-map-shell">
      <div ref={containerRef} className="radar-map" />
      <div className="radar-overlay">
        <div className="radar-overlay__rings" />
        <div className="radar-overlay__sweep" />
      </div>
      {tooltip ? (
        <div
          className="map-tooltip"
          style={{
            left: tooltip.x + 14,
            top: tooltip.y + 14,
          }}
        >
          <strong>{tooltip.entry.callsign ?? tooltip.entry.registration ?? tooltip.entry.icao24}</strong>
          <span>{tooltip.entry.operationSegment}</span>
          <span>{tooltip.entry.typecode ?? tooltip.entry.typeFamily}</span>
          <span>{tooltip.entry.co2KgPerHour.toLocaleString('de-DE')} kg CO2/h</span>
        </div>
      ) : null}
    </div>
  );
}
