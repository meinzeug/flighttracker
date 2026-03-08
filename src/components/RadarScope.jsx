import { useEffect, useRef } from 'react';

import { getSegmentColor } from '../lib/segments';

function distanceKm(from, to) {
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;
  const dLat = ((to.lat - from.lat) * Math.PI) / 180;
  const dLon = ((to.lon - from.lon) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingRad(from, to) {
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;
  const dLon = ((to.lon - from.lon) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return Math.atan2(y, x);
}

function sortScopeAircraft(aircraft) {
  return [...aircraft]
    .filter((entry) => typeof entry.longitude === 'number' && typeof entry.latitude === 'number')
    .sort(
      (left, right) =>
        (right.co2KgPerHour ?? 0) - (left.co2KgPerHour ?? 0) ||
        (right.lastContact ?? 0) - (left.lastContact ?? 0),
    )
    .slice(0, 1200);
}

export function RadarScope({ aircraft, center, selectedAircraftIcao24 = null }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !center) {
      return undefined;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return undefined;
    }

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const maxRangeKm = 4000;
    const radius = Math.min(rect.width, rect.height) * 0.45;
    const cx = rect.width / 2;
    const cy = rect.height / 2;

    ctx.fillStyle = '#04130f';
    ctx.fillRect(0, 0, rect.width, rect.height);

    for (let ring = 1; ring <= 4; ring += 1) {
      ctx.strokeStyle = 'rgba(143, 255, 196, 0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, (radius * ring) / 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (let axis = 0; axis < 4; axis += 1) {
      const angle = (axis * Math.PI) / 2;
      ctx.strokeStyle = 'rgba(143, 255, 196, 0.12)';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
      ctx.stroke();
    }

    const wedgeGradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    wedgeGradient.addColorStop(0, 'rgba(143, 255, 196, 0.16)');
    wedgeGradient.addColorStop(1, 'rgba(143, 255, 196, 0)');
    ctx.fillStyle = wedgeGradient;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, -0.45, 0.1);
    ctx.closePath();
    ctx.fill();

    for (const entry of sortScopeAircraft(aircraft)) {
      const distance = distanceKm(center, { lat: entry.latitude, lon: entry.longitude });
      if (distance > maxRangeKm) {
        continue;
      }

      const angle = bearingRad(center, { lat: entry.latitude, lon: entry.longitude });
      const pointRadius = (distance / maxRangeKm) * radius;
      const x = cx + Math.sin(angle) * pointRadius;
      const y = cy - Math.cos(angle) * pointRadius;
      const isSelected = entry.icao24 === selectedAircraftIcao24;

      ctx.beginPath();
      ctx.fillStyle = getSegmentColor(entry.operationSegment);
      ctx.shadowColor = getSegmentColor(entry.operationSegment);
      ctx.shadowBlur = isSelected ? 18 : 8;
      ctx.arc(x, y, (isSelected ? 4.2 : 2.2) + Math.min(entry.engineCount ?? 1, 3), 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      if (isSelected) {
        ctx.strokeStyle = 'rgba(255, 201, 87, 0.8)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(x, y, 9.5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    ctx.fillStyle = 'rgba(231, 255, 244, 0.92)';
    ctx.font = '600 12px "IBM Plex Mono", monospace';
    ctx.fillText(`Center ${center.lat.toFixed(1)} / ${center.lon.toFixed(1)}`, 16, 22);
    ctx.fillText(`Range ${maxRangeKm.toLocaleString('de-DE')} km`, 16, 40);

    return undefined;
  }, [aircraft, center, selectedAircraftIcao24]);

  return <canvas ref={canvasRef} className="radar-scope" />;
}
