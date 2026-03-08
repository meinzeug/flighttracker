import { CO2_KG_PER_KG_FUEL, JET_FUEL_DENSITY_KG_PER_L } from './config.js';

const baseFuelPerEngineKgPerHour = {
  Jet: { L: 360, 'L/M': 520, M: 1100, H: 2800, default: 900 },
  'Turboprop/Turboshaft': { L: 85, 'L/M': 120, M: 240, H: 420, default: 170 },
  Piston: { L: 32, 'L/M': 40, M: 55, H: 75, default: 38 },
  Electric: { default: 0 },
  Rocket: { default: 9000 },
};

const cruiseSpeedByEngineType = {
  Jet: 230,
  'Turboprop/Turboshaft': 145,
  Piston: 72,
  Electric: 55,
  Rocket: 450,
  default: 160,
};

const segmentFactor = {
  Cargo: 1.08,
  'Military / Government': 1.12,
  Passenger: 1.0,
  'Business / Private': 0.92,
  'General Aviation': 0.88,
  Rotorcraft: 0.95,
  'Emergency / SAR': 1.04,
  'Training / Special': 0.65,
  Unknown: 1.0,
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function inferEngineCount(typeRecord, aircraft) {
  if (typeRecord?.engineCount) {
    return typeRecord.engineCount;
  }

  const classMatch = String(aircraft?.icaoAircraftClass ?? '').match(/[A-Z](\d)/i);
  if (classMatch) {
    return Number.parseInt(classMatch[1], 10);
  }

  return 1;
}

function inferWtc(typeRecord, classification) {
  if (typeRecord?.wtc) {
    return typeRecord.wtc;
  }

  if (classification.emitterCategory === 'Heavy') {
    return 'H';
  }

  if (classification.emitterCategory === 'Large' || classification.emitterCategory === 'High vortex large') {
    return 'M';
  }

  return 'L';
}

function phaseMultiplier(state, engineType) {
  const altitudeM = toNumber(state.geoAltitudeM) ?? toNumber(state.baroAltitudeM) ?? 0;
  const verticalRate = toNumber(state.verticalRateMps) ?? 0;
  const velocity = toNumber(state.velocityMps) ?? cruiseSpeedByEngineType[engineType] ?? cruiseSpeedByEngineType.default;
  const cruise = cruiseSpeedByEngineType[engineType] ?? cruiseSpeedByEngineType.default;

  let factor = clamp(0.7 + (velocity / cruise) * 0.35, 0.62, 1.3);

  if (altitudeM < 1200) {
    factor *= 0.84;
  } else if (altitudeM < 3500) {
    factor *= 0.96;
  }

  if (verticalRate > 4) {
    factor *= 1.12;
  } else if (verticalRate < -4) {
    factor *= 0.9;
  }

  return factor;
}

export function estimateEmissions(state, aircraft, typeRecord, classification) {
  const engineType = typeRecord?.engineType ?? 'Jet';
  const wtc = inferWtc(typeRecord, classification);
  const engineCount = inferEngineCount(typeRecord, aircraft);
  const baseTable = baseFuelPerEngineKgPerHour[engineType] ?? baseFuelPerEngineKgPerHour.Jet;
  const baseFuel = (baseTable[wtc] ?? baseTable.default ?? 0) * engineCount;
  const fuelKgPerHour =
    baseFuel * phaseMultiplier(state, engineType) * (segmentFactor[classification.operationSegment] ?? 1);
  const co2KgPerHour = fuelKgPerHour * CO2_KG_PER_KG_FUEL;
  const fuelLitersPerHour = fuelKgPerHour / JET_FUEL_DENSITY_KG_PER_L;

  return {
    fuelKgPerHour: Math.round(fuelKgPerHour),
    fuelLitersPerHour: Math.round(fuelLitersPerHour),
    co2KgPerHour: Math.round(co2KgPerHour),
    engineType,
    engineCount,
    wtc,
    modelBasis: typeRecord?.designator ?? aircraft?.typecode ?? classification.typeFamily,
  };
}
