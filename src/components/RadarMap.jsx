import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';

import { RADAR_MAP_STYLE } from '../lib/map-style';

const DEFAULT_CENTER = [11.5, 18];
const DEFAULT_ZOOM = 1.65;
const TRACK_SOURCE_ID = 'track-source';
const TRACK_LINE_LAYER_ID = 'track-line';
const TRACK_POINT_LAYER_ID = 'track-point';
const PUBLIC_SOURCE_ID = 'public-source';
const PUBLIC_PORT_LAYER_ID = 'public-port';
const PUBLIC_FERRY_TERMINAL_LAYER_ID = 'public-ferry-terminal';
const PUBLIC_SHIPPING_ROUTE_LAYER_ID = 'public-shipping-route';
const PUBLIC_POWER_LINE_LAYER_ID = 'public-power-line';
const PUBLIC_SUBSTATION_LAYER_ID = 'public-substation';
const PUBLIC_POWER_PLANT_LAYER_ID = 'public-power-plant';
const PUBLIC_GAS_PIPELINE_LAYER_ID = 'public-gas-pipeline';
const PUBLIC_GAS_SITE_LAYER_ID = 'public-gas-site';
const PUBLIC_EARTHQUAKE_LAYER_ID = 'public-earthquake';
const SEAMARK_SOURCE_ID = 'seamark-source';
const SEAMARK_LAYER_ID = 'seamark-layer';
const HIT_PADDING_PX = 10;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function primaryLabel(entry) {
  return entry.callsign ?? entry.registration ?? entry.icao24;
}

function buildRenderableAircraft(aircraft) {
  return aircraft
    .filter((entry) => typeof entry.longitude === 'number' && typeof entry.latitude === 'number')
    .map((entry) => ({
      ...entry,
      label: primaryLabel(entry),
      size: clamp(3 + Math.log10((entry.co2KgPerHour ?? 20) + 12) * 1.8, 3, 8.4),
      headingDeg: entry.trackDeg ?? 0,
    }))
    .sort(
      (left, right) =>
        (right.lastContact ?? 0) - (left.lastContact ?? 0) ||
        (right.geoAltitudeM ?? right.baroAltitudeM ?? 0) - (left.geoAltitudeM ?? left.baroAltitudeM ?? 0) ||
        String(left.icao24).localeCompare(String(right.icao24)),
    );
}

function getRenderBudget(zoom) {
  if (zoom < 2.3) {
    return 320;
  }

  if (zoom < 3.6) {
    return 700;
  }

  if (zoom < 5) {
    return 1400;
  }

  if (zoom < 6.5) {
    return 2600;
  }

  return 4800;
}

function emptyFeatureCollection() {
  return {
    type: 'FeatureCollection',
    features: [],
  };
}

function ensurePublicLayers(map) {
  if (!map.getSource(PUBLIC_SOURCE_ID)) {
    map.addSource(PUBLIC_SOURCE_ID, {
      type: 'geojson',
      data: emptyFeatureCollection(),
    });
  }

  if (!map.getSource(SEAMARK_SOURCE_ID)) {
    map.addSource(SEAMARK_SOURCE_ID, {
      type: 'raster',
      tiles: ['https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: 'OpenSeaMap',
    });
  }

  if (!map.getLayer(SEAMARK_LAYER_ID)) {
    map.addLayer({
      id: SEAMARK_LAYER_ID,
      type: 'raster',
      source: SEAMARK_SOURCE_ID,
      layout: {
        visibility: 'none',
      },
      paint: {
        'raster-opacity': 0.7,
      },
    });
  }

  if (!map.getLayer(PUBLIC_SHIPPING_ROUTE_LAYER_ID)) {
    map.addLayer({
      id: PUBLIC_SHIPPING_ROUTE_LAYER_ID,
      type: 'line',
      source: PUBLIC_SOURCE_ID,
      filter: ['==', ['get', 'category'], 'shipping_route'],
      layout: {
        visibility: 'none',
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': '#4da3ff',
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1.1, 8, 3.4],
        'line-opacity': 0.75,
        'line-dasharray': [2, 1.4],
      },
    });
  }

  if (!map.getLayer(PUBLIC_POWER_LINE_LAYER_ID)) {
    map.addLayer({
      id: PUBLIC_POWER_LINE_LAYER_ID,
      type: 'line',
      source: PUBLIC_SOURCE_ID,
      filter: ['==', ['get', 'category'], 'power_line'],
      layout: {
        visibility: 'none',
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': '#f1a23a',
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1.1, 9, 3.2],
        'line-opacity': 0.65,
      },
    });
  }

  if (!map.getLayer(PUBLIC_GAS_PIPELINE_LAYER_ID)) {
    map.addLayer({
      id: PUBLIC_GAS_PIPELINE_LAYER_ID,
      type: 'line',
      source: PUBLIC_SOURCE_ID,
      filter: ['==', ['get', 'category'], 'gas_pipeline'],
      layout: {
        visibility: 'none',
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': '#45d4b0',
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1.1, 9, 3.4],
        'line-opacity': 0.8,
        'line-dasharray': [1.1, 0.9],
      },
    });
  }

  if (!map.getLayer(PUBLIC_PORT_LAYER_ID)) {
    map.addLayer({
      id: PUBLIC_PORT_LAYER_ID,
      type: 'circle',
      source: PUBLIC_SOURCE_ID,
      filter: ['==', ['get', 'category'], 'port'],
      layout: {
        visibility: 'none',
      },
      paint: {
        'circle-color': '#1f7fff',
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 3.2, 8, 6.4],
        'circle-stroke-color': '#eaf4ff',
        'circle-stroke-width': 1.1,
        'circle-opacity': 0.88,
      },
    });
  }

  if (!map.getLayer(PUBLIC_FERRY_TERMINAL_LAYER_ID)) {
    map.addLayer({
      id: PUBLIC_FERRY_TERMINAL_LAYER_ID,
      type: 'circle',
      source: PUBLIC_SOURCE_ID,
      filter: ['==', ['get', 'category'], 'ferry_terminal'],
      layout: {
        visibility: 'none',
      },
      paint: {
        'circle-color': '#87c8ff',
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 2.8, 8, 5.2],
        'circle-stroke-color': '#153657',
        'circle-stroke-width': 1,
        'circle-opacity': 0.92,
      },
    });
  }

  if (!map.getLayer(PUBLIC_SUBSTATION_LAYER_ID)) {
    map.addLayer({
      id: PUBLIC_SUBSTATION_LAYER_ID,
      type: 'circle',
      source: PUBLIC_SOURCE_ID,
      filter: ['==', ['get', 'category'], 'substation'],
      layout: {
        visibility: 'none',
      },
      paint: {
        'circle-color': '#ffca55',
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 3.4, 9, 6.2],
        'circle-stroke-color': '#5b3f08',
        'circle-stroke-width': 1.1,
      },
    });
  }

  if (!map.getLayer(PUBLIC_POWER_PLANT_LAYER_ID)) {
    map.addLayer({
      id: PUBLIC_POWER_PLANT_LAYER_ID,
      type: 'circle',
      source: PUBLIC_SOURCE_ID,
      filter: ['==', ['get', 'category'], 'power_plant'],
      layout: {
        visibility: 'none',
      },
      paint: {
        'circle-color': '#f06e3c',
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 3.2, 9, 6.2],
        'circle-stroke-color': '#4c1d09',
        'circle-stroke-width': 1.1,
      },
    });
  }

  if (!map.getLayer(PUBLIC_GAS_SITE_LAYER_ID)) {
    map.addLayer({
      id: PUBLIC_GAS_SITE_LAYER_ID,
      type: 'circle',
      source: PUBLIC_SOURCE_ID,
      filter: ['==', ['get', 'category'], 'gas_site'],
      layout: {
        visibility: 'none',
      },
      paint: {
        'circle-color': '#31c48d',
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 3.2, 9, 6.2],
        'circle-stroke-color': '#0d4d3d',
        'circle-stroke-width': 1.1,
      },
    });
  }

  if (!map.getLayer(PUBLIC_EARTHQUAKE_LAYER_ID)) {
    map.addLayer({
      id: PUBLIC_EARTHQUAKE_LAYER_ID,
      type: 'circle',
      source: PUBLIC_SOURCE_ID,
      filter: ['==', ['get', 'category'], 'earthquake'],
      layout: {
        visibility: 'none',
      },
      paint: {
        'circle-color': '#f84f5a',
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['coalesce', ['get', 'magnitude'], 0],
          0,
          2.8,
          2,
          5,
          4,
          8,
          6,
          12,
        ],
        'circle-stroke-color': '#fff0f0',
        'circle-stroke-width': 1,
        'circle-opacity': 0.84,
      },
    });
  }
}

function setLayerVisibility(map, layerId, visible) {
  if (!map.getLayer(layerId)) {
    return;
  }

  map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
}

function buildTrackFeatureCollection(track) {
  const validPoints = track.filter(
    (point) => typeof point.longitude === 'number' && typeof point.latitude === 'number',
  );

  if (!validPoints.length) {
    return emptyFeatureCollection();
  }

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: validPoints.map((point) => [point.longitude, point.latitude]),
        },
        properties: {},
      },
      ...validPoints.map((point, index) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [point.longitude, point.latitude],
        },
        properties: {
          latest: index === validPoints.length - 1 ? 1 : 0,
        },
      })),
    ],
  };
}

function ensureTrackLayers(map) {
  if (!map.getSource(TRACK_SOURCE_ID)) {
    map.addSource(TRACK_SOURCE_ID, {
      type: 'geojson',
      data: emptyFeatureCollection(),
    });
  }

  if (!map.getLayer(TRACK_LINE_LAYER_ID)) {
    map.addLayer({
      id: TRACK_LINE_LAYER_ID,
      type: 'line',
      source: TRACK_SOURCE_ID,
      filter: ['==', ['geometry-type'], 'LineString'],
      paint: {
        'line-color': '#f4c400',
        'line-width': 2.4,
        'line-opacity': 0.9,
      },
    });
  }

  if (!map.getLayer(TRACK_POINT_LAYER_ID)) {
    map.addLayer({
      id: TRACK_POINT_LAYER_ID,
      type: 'circle',
      source: TRACK_SOURCE_ID,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-color': ['case', ['==', ['get', 'latest'], 1], '#fff1ad', '#f4c400'],
        'circle-radius': ['case', ['==', ['get', 'latest'], 1], 4.8, 2.7],
        'circle-stroke-color': '#7b5b00',
        'circle-stroke-width': 1,
      },
    });
  }
}

function isWithinBounds(bounds, longitude, latitude) {
  return bounds.contains([longitude, latitude]);
}

function resizeCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const devicePixelRatio = window.devicePixelRatio || 1;
  const scaledWidth = Math.round(width * devicePixelRatio);
  const scaledHeight = Math.round(height * devicePixelRatio);

  if (canvas.width !== scaledWidth || canvas.height !== scaledHeight) {
    canvas.width = scaledWidth;
    canvas.height = scaledHeight;
  }

  return { width, height, devicePixelRatio };
}

function drawAircraftGlyph(context, x, y, size, headingDeg, selected) {
  context.save();
  context.translate(x, y);
  context.rotate(((headingDeg ?? 0) - 90) * (Math.PI / 180));

  context.beginPath();
  context.moveTo(size * 1.55, 0);
  context.lineTo(size * 0.2, size * 0.22);
  context.lineTo(size * -0.25, size * 0.72);
  context.lineTo(size * -0.42, size * 0.72);
  context.lineTo(size * -0.26, size * 0.14);
  context.lineTo(size * -1.25, size * 0.38);
  context.lineTo(size * -1.34, size * 0.18);
  context.lineTo(size * -0.74, 0);
  context.lineTo(size * -1.34, size * -0.18);
  context.lineTo(size * -1.25, size * -0.38);
  context.lineTo(size * -0.26, size * -0.14);
  context.lineTo(size * -0.42, size * -0.72);
  context.lineTo(size * -0.25, size * -0.72);
  context.lineTo(size * 0.2, size * -0.22);
  context.closePath();
  context.fillStyle = selected ? '#fff4ab' : '#f4c400';
  context.strokeStyle = selected ? '#6b4d00' : '#7a5b00';
  context.lineWidth = selected ? 1.9 : 1.35;
  context.shadowColor = selected ? 'rgba(255, 244, 171, 0.45)' : 'rgba(244, 196, 0, 0.32)';
  context.shadowBlur = selected ? 18 : 10;
  context.fill();
  context.shadowBlur = 0;
  context.stroke();
  context.restore();
}

function pickAircraftTarget(targets, x, y) {
  let bestMatch = null;

  for (const target of targets) {
    const distance = Math.hypot(target.x - x, target.y - y);
    if (distance > target.radius + HIT_PADDING_PX) {
      continue;
    }

    if (!bestMatch || distance < bestMatch.distance) {
      bestMatch = { ...target, distance };
    }
  }

  return bestMatch;
}

export function RadarMap({
  aircraft,
  onCenterChange,
  onViewportChange,
  selectedAircraftIcao24,
  selectedTrack,
  publicFeatures,
  publicLayers,
  followSelected = false,
  viewMode = '2d',
  showLabels = true,
  onSelectAircraft,
}) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const mapRef = useRef(null);
  const latestAircraftRef = useRef([]);
  const selectedTrackRef = useRef([]);
  const selectedAircraftRef = useRef(selectedAircraftIcao24);
  const publicFeaturesRef = useRef(emptyFeatureCollection());
  const publicLayersRef = useRef(publicLayers ?? {});
  const lastFollowRef = useRef(null);
  const renderFrameRef = useRef(null);
  const hitTargetsRef = useRef([]);
  const [tooltip, setTooltip] = useState(null);

  const renderableAircraft = useMemo(() => buildRenderableAircraft(aircraft), [aircraft]);

  function syncTrackData() {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) {
      return;
    }

    const source = map.getSource(TRACK_SOURCE_ID);
    if (source) {
      source.setData(buildTrackFeatureCollection(selectedTrackRef.current));
    }
  }

  function syncPublicData() {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) {
      return;
    }

    ensurePublicLayers(map);

    const source = map.getSource(PUBLIC_SOURCE_ID);
    if (source) {
      source.setData(publicFeaturesRef.current ?? emptyFeatureCollection());
    }

    setLayerVisibility(map, SEAMARK_LAYER_ID, Boolean(publicLayersRef.current.seamarks));
    setLayerVisibility(map, PUBLIC_PORT_LAYER_ID, Boolean(publicLayersRef.current.ports));
    setLayerVisibility(
      map,
      PUBLIC_FERRY_TERMINAL_LAYER_ID,
      Boolean(publicLayersRef.current.ports),
    );
    setLayerVisibility(
      map,
      PUBLIC_SHIPPING_ROUTE_LAYER_ID,
      Boolean(publicLayersRef.current.shippingRoutes),
    );
    setLayerVisibility(map, PUBLIC_POWER_LINE_LAYER_ID, Boolean(publicLayersRef.current.powerGrid));
    setLayerVisibility(map, PUBLIC_SUBSTATION_LAYER_ID, Boolean(publicLayersRef.current.powerGrid));
    setLayerVisibility(map, PUBLIC_POWER_PLANT_LAYER_ID, Boolean(publicLayersRef.current.powerPlants));
    setLayerVisibility(map, PUBLIC_GAS_PIPELINE_LAYER_ID, Boolean(publicLayersRef.current.gasPipelines));
    setLayerVisibility(map, PUBLIC_GAS_SITE_LAYER_ID, Boolean(publicLayersRef.current.gasSites));
    setLayerVisibility(map, PUBLIC_EARTHQUAKE_LAYER_ID, Boolean(publicLayersRef.current.earthquakes));
  }

  const renderOverlayRef = useRef(() => {});
  renderOverlayRef.current = () => {
    const map = mapRef.current;
    const canvas = canvasRef.current;

    if (!map || !canvas) {
      return;
    }

    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }

    const { width, height, devicePixelRatio } = resizeCanvas(canvas);
    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);

    const bounds = map.getBounds();
    const zoom = map.getZoom();
    const renderBudget = getRenderBudget(zoom);
    const visibleAircraft = latestAircraftRef.current.filter((entry) =>
      isWithinBounds(bounds, entry.longitude, entry.latitude),
    );
    const drawnAircraft = visibleAircraft.slice(0, renderBudget);
    const selectedAircraft = latestAircraftRef.current.find(
      (entry) => entry.icao24 === selectedAircraftRef.current,
    );

    if (
      selectedAircraft &&
      !drawnAircraft.some((entry) => entry.icao24 === selectedAircraft.icao24) &&
      isWithinBounds(bounds, selectedAircraft.longitude, selectedAircraft.latitude)
    ) {
      drawnAircraft.push(selectedAircraft);
    }

    const hitTargets = [];

    for (const entry of drawnAircraft) {
      const point = map.project([entry.longitude, entry.latitude]);
      const size = clamp(entry.size + zoom * 0.55, 5.2, 13.4);
      const selected = entry.icao24 === selectedAircraftRef.current;

      if (
        point.x < -size ||
        point.y < -size ||
        point.x > width + size ||
        point.y > height + size
      ) {
        continue;
      }

      context.beginPath();
      context.arc(point.x, point.y, size + 5.5, 0, Math.PI * 2);
      context.fillStyle = selected ? 'rgba(255, 244, 171, 0.18)' : 'rgba(244, 196, 0, 0.11)';
      context.fill();

      drawAircraftGlyph(context, point.x, point.y, size, entry.headingDeg, selected);

      if (showLabels && (selected || (zoom >= 6.2 && drawnAircraft.length <= 36))) {
        context.font = selected ? '700 13px Rajdhani' : '600 12px Rajdhani';
        context.textBaseline = 'middle';
        context.fillStyle = selected ? '#2d2611' : 'rgba(48, 48, 48, 0.88)';
        const label = entry.label;
        const labelWidth = context.measureText(label).width;
        const labelX = point.x + size + 8;
        const labelY = point.y;
        context.fillRect(labelX - 5, labelY - 10, labelWidth + 10, 20);
        context.fillStyle = selected ? '#fff4ab' : '#f4c400';
        context.fillText(label, labelX, labelY);
      }

      hitTargets.push({
        x: point.x,
        y: point.y,
        radius: size + 2,
        entry,
      });
    }

    hitTargetsRef.current = hitTargets;
  };

  function scheduleOverlayRender() {
    if (renderFrameRef.current !== null) {
      return;
    }

    renderFrameRef.current = window.requestAnimationFrame(() => {
      renderFrameRef.current = null;
      renderOverlayRef.current();
    });
  }

  useEffect(() => {
    latestAircraftRef.current = renderableAircraft;
    scheduleOverlayRender();
  }, [renderableAircraft]);

  useEffect(() => {
    selectedAircraftRef.current = selectedAircraftIcao24;
    scheduleOverlayRender();
  }, [selectedAircraftIcao24]);

  useEffect(() => {
    scheduleOverlayRender();
  }, [showLabels, viewMode]);

  useEffect(() => {
    selectedTrackRef.current = Array.isArray(selectedTrack) ? selectedTrack : [];
    syncTrackData();
  }, [selectedTrack]);

  useEffect(() => {
    publicFeaturesRef.current = publicFeatures ?? emptyFeatureCollection();
    syncPublicData();
  }, [publicFeatures]);

  useEffect(() => {
    publicLayersRef.current = publicLayers ?? {};
    syncPublicData();
  }, [publicLayers]);

  useEffect(() => {
    if (!followSelected) {
      lastFollowRef.current = null;
    }
  }, [followSelected]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    map.easeTo({
      pitch: viewMode === '3d' ? 58 : 0,
      bearing: viewMode === '3d' ? 22 : 0,
      duration: 520,
      essential: true,
    });
  }, [selectedAircraftIcao24, viewMode]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return undefined;
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: RADAR_MAP_STYLE,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      minZoom: 1,
      maxZoom: 10,
      pitch: 0,
      attributionControl: false,
    });

    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    const emitViewport = () => {
      const center = map.getCenter();
      const bounds = map.getBounds();
      onCenterChange?.({ lat: center.lat, lon: center.lng });
      onViewportChange?.({
        west: bounds.getWest(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        north: bounds.getNorth(),
        zoom: map.getZoom(),
        centerLat: center.lat,
        centerLon: center.lng,
      });
    };

    map.on('load', () => {
      ensurePublicLayers(map);
      ensureTrackLayers(map);
      syncPublicData();
      syncTrackData();
      scheduleOverlayRender();
      emitViewport();
    });

    map.on('move', () => {
      setTooltip(null);
      scheduleOverlayRender();
    });

    map.on('moveend', () => {
      emitViewport();
      scheduleOverlayRender();
    });

    map.on('zoom', scheduleOverlayRender);
    map.on('resize', scheduleOverlayRender);

    return () => {
      if (renderFrameRef.current !== null) {
        window.cancelAnimationFrame(renderFrameRef.current);
        renderFrameRef.current = null;
      }

      hitTargetsRef.current = [];
      setTooltip(null);
      map.remove();
      mapRef.current = null;
    };
  }, [onCenterChange, onViewportChange]);

  useEffect(() => {
    const container = containerRef.current;
    const map = mapRef.current;
    if (!container) {
      return undefined;
    }

    const handlePointerMove = (event) => {
      const rect = container.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const match = pickAircraftTarget(hitTargetsRef.current, x, y);

      container.style.cursor = match ? 'pointer' : '';

      if (!match) {
        setTooltip(null);
        return;
      }

      setTooltip({
        x: match.x + 14,
        y: match.y - 16,
        entry: match.entry,
      });
    };

    const handlePointerLeave = () => {
      container.style.cursor = '';
      setTooltip(null);
    };

    const handleClick = (event) => {
      const rect = container.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const match = pickAircraftTarget(hitTargetsRef.current, x, y);

      if (!match) {
        return;
      }

      onSelectAircraft?.(match.entry.icao24);
      map?.easeTo({
        center: [match.entry.longitude, match.entry.latitude],
        zoom: Math.max(map.getZoom(), 4.6),
        duration: 720,
      });
    };

    container.addEventListener('mousemove', handlePointerMove);
    container.addEventListener('mouseleave', handlePointerLeave);
    container.addEventListener('click', handleClick);

    return () => {
      container.removeEventListener('mousemove', handlePointerMove);
      container.removeEventListener('mouseleave', handlePointerLeave);
      container.removeEventListener('click', handleClick);
    };
  }, [onSelectAircraft]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !followSelected || !selectedAircraftIcao24) {
      return;
    }

    const selectedAircraft = renderableAircraft.find(
      (entry) => entry.icao24 === selectedAircraftIcao24,
    );
    if (!selectedAircraft) {
      return;
    }

    const lastFollow = lastFollowRef.current;
    const currentCenter = {
      icao24: selectedAircraftIcao24,
      longitude: selectedAircraft.longitude,
      latitude: selectedAircraft.latitude,
    };
    const movedFarEnough =
      !lastFollow ||
      lastFollow.icao24 !== selectedAircraftIcao24 ||
      Math.hypot(
        lastFollow.longitude - currentCenter.longitude,
        lastFollow.latitude - currentCenter.latitude,
      ) > 0.18;

    if (!movedFarEnough) {
      return;
    }

    lastFollowRef.current = currentCenter;
    map.easeTo({
      center: [selectedAircraft.longitude, selectedAircraft.latitude],
      zoom: Math.max(map.getZoom(), 4.8),
      duration: lastFollow?.icao24 === selectedAircraftIcao24 ? 640 : 900,
      essential: true,
    });
  }, [followSelected, renderableAircraft, selectedAircraftIcao24]);

  return (
    <div className="radar-map-shell">
      <div ref={containerRef} className="radar-map" />
      <canvas ref={canvasRef} className="radar-map__canvas" />
      <div className="radar-map__mask" />
      {tooltip ? (
        <div
          className="map-tooltip"
          style={{
            left: tooltip.x,
            top: tooltip.y,
          }}
        >
          <strong>{tooltip.entry.label}</strong>
          <span>{tooltip.entry.typecode ?? tooltip.entry.typeFamily ?? 'Unbekannter Typ'}</span>
          <span>{tooltip.entry.operator ?? tooltip.entry.originCountry ?? 'n/a'}</span>
          <span>{Math.round(tooltip.entry.co2KgPerHour ?? 0).toLocaleString('de-DE')} kg CO2/h</span>
        </div>
      ) : null}
    </div>
  );
}
