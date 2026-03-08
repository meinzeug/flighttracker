import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';

import { RADAR_MAP_STYLE } from '../lib/map-style';
import { getSegmentColor } from '../lib/segments';

const DEFAULT_CENTER = [11.5, 18];
const DEFAULT_ZOOM = 1.65;

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
      color: getSegmentColor(entry.operationSegment),
      size: clamp(3 + Math.log10((entry.co2KgPerHour ?? 20) + 12) * 1.8, 3, 8.4),
      headingRad: (((entry.trackDeg ?? 0) - 90) * Math.PI) / 180,
    }));
}

function syncCanvasSize(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  return { width: rect.width, height: rect.height, dpr };
}

function findHitTarget(x, y, targets) {
  let closestTarget = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const target of targets) {
    const dx = target.x - x;
    const dy = target.y - y;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq <= target.radius * target.radius && distanceSq < closestDistance) {
      closestTarget = target;
      closestDistance = distanceSq;
    }
  }

  return closestTarget;
}

function drawPlaneGlyph(ctx, x, y, size, headingRad, color, emphasis) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(headingRad);

  ctx.shadowColor = color;
  ctx.shadowBlur = emphasis ? 18 : 10;
  ctx.fillStyle = color;

  ctx.beginPath();
  ctx.moveTo(size * 1.55, 0);
  ctx.lineTo(-size * 0.2, size * 0.4);
  ctx.lineTo(-size * 0.55, size * 1.05);
  ctx.lineTo(-size * 0.82, size * 1.05);
  ctx.lineTo(-size * 0.55, size * 0.18);
  ctx.lineTo(-size * 1.35, size * 0.18);
  ctx.lineTo(-size * 1.35, -size * 0.18);
  ctx.lineTo(-size * 0.55, -size * 0.18);
  ctx.lineTo(-size * 0.82, -size * 1.05);
  ctx.lineTo(-size * 0.55, -size * 1.05);
  ctx.lineTo(-size * 0.2, -size * 0.4);
  ctx.closePath();
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.lineWidth = emphasis ? 1.6 : 1.1;
  ctx.strokeStyle = 'rgba(255,255,255,0.82)';
  ctx.stroke();
  ctx.restore();
}

function drawTarget(ctx, plane, projected, zoom, pulse, isSelected, isHovered) {
  const x = projected.x;
  const y = projected.y;
  const color = plane.color;
  const size = clamp(plane.size * (zoom < 2.6 ? 0.92 : zoom < 4 ? 1.14 : 1.44), 3, 11.5);
  const emphasis = isSelected || isHovered;
  const glowRadius = size * (emphasis ? 3 + pulse * 0.45 : 2.2);

  const glow = ctx.createRadialGradient(x, y, 0, x, y, glowRadius * 2);
  glow.addColorStop(0, `${color}cc`);
  glow.addColorStop(0.2, `${color}5c`);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, glowRadius * 2, 0, Math.PI * 2);
  ctx.fill();

  if (zoom < 2.6) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, size * 0.82, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.beginPath();
    ctx.arc(x, y, size * 0.28, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const trailLength = clamp((plane.velocityMps ?? 0) / 11, 8, 28);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(plane.headingRad);
    ctx.strokeStyle = `${color}aa`;
    ctx.lineWidth = emphasis ? 2.2 : 1.4;
    ctx.beginPath();
    ctx.moveTo(-trailLength * 0.4, 0);
    ctx.lineTo(-trailLength * 1.4, 0);
    ctx.stroke();
    ctx.restore();

    drawPlaneGlyph(ctx, x, y, size, plane.headingRad, color, emphasis);
  }

  if (emphasis) {
    ctx.strokeStyle = `rgba(232, 255, 244, ${0.5 + pulse * 0.28})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(x, y, size * (zoom < 2.6 ? 2.4 : 2.8 + pulse * 0.3), 0, Math.PI * 2);
    ctx.stroke();
  }

  if (isSelected) {
    ctx.save();
    ctx.font = '600 12px "IBM Plex Mono", monospace';
    const title = plane.label ?? plane.icao24;
    const subline = [plane.typecode ?? plane.typeFamily, plane.operationSegment].filter(Boolean).join(' · ');
    const width = Math.max(
      ctx.measureText(title).width,
      subline ? ctx.measureText(subline).width : 0,
    );
    const boxWidth = width + 18;
    const boxHeight = subline ? 38 : 24;
    const boxX = x + 14;
    const boxY = y - boxHeight - 12;

    ctx.fillStyle = 'rgba(6, 17, 14, 0.92)';
    ctx.strokeStyle = 'rgba(143, 255, 196, 0.34)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 12);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = 'rgba(242, 255, 249, 0.96)';
    ctx.fillText(title, boxX + 9, boxY + 15);
    if (subline) {
      ctx.fillStyle = 'rgba(190, 234, 214, 0.78)';
      ctx.fillText(subline, boxX + 9, boxY + 31);
    }

    ctx.restore();
  }

  return {
    x,
    y,
    radius: Math.max(size * 2.8, 12),
    entry: plane,
  };
}

export function RadarMap({
  aircraft,
  onCenterChange,
  selectedAircraftIcao24,
  onSelectAircraft,
}) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const mapRef = useRef(null);
  const animationFrameRef = useRef(0);
  const hitTargetsRef = useRef([]);
  const latestAircraftRef = useRef([]);
  const selectedAircraftRef = useRef(selectedAircraftIcao24);
  const [tooltip, setTooltip] = useState(null);
  const [hoveredIcao24, setHoveredIcao24] = useState(null);

  const renderableAircraft = useMemo(() => buildRenderableAircraft(aircraft), [aircraft]);

  useEffect(() => {
    latestAircraftRef.current = renderableAircraft;
  }, [renderableAircraft]);

  useEffect(() => {
    selectedAircraftRef.current = selectedAircraftIcao24;
  }, [selectedAircraftIcao24]);

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

    const emitCenter = () => {
      const center = map.getCenter();
      onCenterChange?.({ lat: center.lat, lon: center.lng });
    };

    map.on('load', emitCenter);
    map.on('moveend', emitCenter);

    return () => {
      window.cancelAnimationFrame(animationFrameRef.current);
      setTooltip(null);
      map.remove();
      mapRef.current = null;
    };
  }, [onCenterChange]);

  useEffect(() => {
    const draw = (time) => {
      const map = mapRef.current;
      const canvas = canvasRef.current;
      if (!map || !canvas || !map.isStyleLoaded()) {
        animationFrameRef.current = window.requestAnimationFrame(draw);
        return;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        animationFrameRef.current = window.requestAnimationFrame(draw);
        return;
      }

      const { width, height, dpr } = syncCanvasSize(canvas);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const zoom = map.getZoom();
      const pulse = (Math.sin(time / 360) + 1) / 2;
      const hitTargets = [];
      const hoveredId = hoveredIcao24;
      const selectedId = selectedAircraftRef.current;

      for (const plane of latestAircraftRef.current) {
        const projected = map.project([plane.longitude, plane.latitude]);
        if (projected.x < -28 || projected.x > width + 28 || projected.y < -28 || projected.y > height + 28) {
          continue;
        }

        hitTargets.push(
          drawTarget(
            ctx,
            plane,
            projected,
            zoom,
            pulse,
            plane.icao24 === selectedId,
            plane.icao24 === hoveredId,
          ),
        );
      }

      hitTargetsRef.current = hitTargets;
      animationFrameRef.current = window.requestAnimationFrame(draw);
    };

    animationFrameRef.current = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(animationFrameRef.current);
  }, [hoveredIcao24]);

  function handlePointerMove(event) {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const target = findHitTarget(x, y, hitTargetsRef.current);

    if (!target) {
      setHoveredIcao24(null);
      setTooltip(null);
      canvas.style.cursor = '';
      return;
    }

    canvas.style.cursor = 'pointer';
    setHoveredIcao24(target.entry.icao24);
    setTooltip({
      x,
      y,
      entry: target.entry,
    });
  }

  function handlePointerLeave() {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.style.cursor = '';
    }

    setHoveredIcao24(null);
    setTooltip(null);
  }

  function handleClick(event) {
    const canvas = canvasRef.current;
    const map = mapRef.current;
    if (!canvas || !map) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const target = findHitTarget(x, y, hitTargetsRef.current);

    if (!target) {
      return;
    }

    onSelectAircraft?.(target.entry.icao24);
    map.easeTo({
      center: [target.entry.longitude, target.entry.latitude],
      zoom: Math.max(map.getZoom(), 4.6),
      duration: 720,
    });
  }

  return (
    <div className="radar-map-shell">
      <div ref={containerRef} className="radar-map" />
      <canvas
        ref={canvasRef}
        className="radar-map__canvas"
        onMouseMove={handlePointerMove}
        onMouseLeave={handlePointerLeave}
        onClick={handleClick}
      />
      <div className="radar-map__mask" />
      {tooltip ? (
        <div
          className="map-tooltip"
          style={{
            left: tooltip.x + 14,
            top: tooltip.y + 14,
          }}
        >
          <strong>{tooltip.entry.label}</strong>
          <span>{tooltip.entry.typecode ?? tooltip.entry.typeFamily ?? 'Unbekannter Typ'}</span>
          <span>{tooltip.entry.operationSegment}</span>
          <span>{tooltip.entry.co2KgPerHour.toLocaleString('de-DE')} kg CO2/h</span>
        </div>
      ) : null}
    </div>
  );
}
