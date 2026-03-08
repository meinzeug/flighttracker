import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';

import { RADAR_MAP_STYLE } from '../lib/map-style';
import { getSegmentColor } from '../lib/segments';

const AIRCRAFT_SOURCE_ID = 'aircraft-source';
const AIRCRAFT_GLOW_LAYER_ID = 'aircraft-glow-layer';
const AIRCRAFT_CORE_LAYER_ID = 'aircraft-core-layer';
const AIRCRAFT_COLOR_EXPRESSION = ['to-color', ['get', 'color']];
const AIRCRAFT_SIZE_EXPRESSION = ['to-number', ['get', 'size']];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function makeFeature(entry) {
  return {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [entry.longitude, entry.latitude],
    },
    properties: {
      icao24: entry.icao24 ?? '',
      callsign: entry.callsign ?? '',
      registration: entry.registration ?? '',
      operationSegment: entry.operationSegment ?? 'Unknown',
      typecode: entry.typecode ?? '',
      typeFamily: entry.typeFamily ?? '',
      co2KgPerHour: String(entry.co2KgPerHour ?? 0),
      color: getSegmentColor(entry.operationSegment),
      size: clamp(3 + Math.log10((entry.co2KgPerHour ?? 20) + 10) * 2.6, 3, 8),
    },
  };
}

function buildGeoJson(aircraft) {
  return {
    type: 'FeatureCollection',
    features: aircraft
      .filter((entry) => typeof entry.longitude === 'number' && typeof entry.latitude === 'number')
      .map(makeFeature),
  };
}

export function RadarMap({ aircraft, onCenterChange }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const mapLoadedRef = useRef(false);
  const latestFeatureCollectionRef = useRef(buildGeoJson([]));
  const [tooltip, setTooltip] = useState(null);

  const featureCollection = useMemo(() => buildGeoJson(aircraft), [aircraft]);

  useEffect(() => {
    latestFeatureCollectionRef.current = featureCollection;
  }, [featureCollection]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
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

    const emitCenter = () => {
      const center = map.getCenter();
      onCenterChange?.({ lat: center.lat, lon: center.lng });
    };

    const handleLoad = () => {
      mapLoadedRef.current = true;

      map.addSource(AIRCRAFT_SOURCE_ID, {
        type: 'geojson',
        data: latestFeatureCollectionRef.current,
      });

      map.addLayer({
        id: AIRCRAFT_GLOW_LAYER_ID,
        type: 'circle',
        source: AIRCRAFT_SOURCE_ID,
        paint: {
          'circle-color': AIRCRAFT_COLOR_EXPRESSION,
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            1,
            ['*', AIRCRAFT_SIZE_EXPRESSION, 1.6],
            7,
            ['*', AIRCRAFT_SIZE_EXPRESSION, 2.8],
          ],
          'circle-blur': 0.9,
          'circle-opacity': 0.26,
        },
      });

      map.addLayer({
        id: AIRCRAFT_CORE_LAYER_ID,
        type: 'circle',
        source: AIRCRAFT_SOURCE_ID,
        paint: {
          'circle-color': AIRCRAFT_COLOR_EXPRESSION,
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            1,
            AIRCRAFT_SIZE_EXPRESSION,
            7,
            ['*', AIRCRAFT_SIZE_EXPRESSION, 1.7],
          ],
          'circle-stroke-width': 1,
          'circle-stroke-color': 'rgba(255,255,255,0.22)',
          'circle-opacity': 0.92,
        },
      });

      map.on('mouseenter', AIRCRAFT_CORE_LAYER_ID, () => {
        map.getCanvas().style.cursor = 'pointer';
      });

      map.on('mouseleave', AIRCRAFT_CORE_LAYER_ID, () => {
        map.getCanvas().style.cursor = '';
        setTooltip(null);
      });

      map.on('mousemove', AIRCRAFT_CORE_LAYER_ID, (event) => {
        const feature = event.features?.[0];
        if (!feature || feature.geometry.type !== 'Point') {
          setTooltip(null);
          return;
        }

        const props = feature.properties ?? {};
        setTooltip({
          x: event.point.x,
          y: event.point.y,
          entry: {
            callsign: props.callsign || null,
            registration: props.registration || null,
            icao24: props.icao24 || null,
            operationSegment: props.operationSegment || null,
            typecode: props.typecode || null,
            typeFamily: props.typeFamily || null,
            co2KgPerHour: Number(props.co2KgPerHour || 0),
          },
        });
      });

      map.on('click', AIRCRAFT_CORE_LAYER_ID, (event) => {
        const feature = event.features?.[0];
        if (!feature || feature.geometry.type !== 'Point') {
          return;
        }

        const [longitude, latitude] = feature.geometry.coordinates;
        map.easeTo({
          center: [longitude, latitude],
          zoom: Math.max(map.getZoom(), 5),
          duration: 700,
        });
      });

      emitCenter();
    };

    map.on('load', handleLoad);
    map.on('moveend', emitCenter);

    return () => {
      mapLoadedRef.current = false;
      setTooltip(null);
      map.remove();
      mapRef.current = null;
    };
  }, [onCenterChange]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) {
      return;
    }

    map.getSource(AIRCRAFT_SOURCE_ID)?.setData(featureCollection);
  }, [featureCollection]);

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
