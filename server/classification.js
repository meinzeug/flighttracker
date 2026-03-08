const emitterCategoryMap = new Map([
  [0, 'No info'],
  [1, 'No ADS-B category'],
  [2, 'Light'],
  [3, 'Small'],
  [4, 'Large'],
  [5, 'High vortex large'],
  [6, 'Heavy'],
  [7, 'High performance'],
  [8, 'Rotorcraft'],
  [9, 'Glider'],
  [10, 'Lighter-than-air'],
  [11, 'Skydiver'],
  [12, 'Ultralight'],
  [13, 'Reserved'],
  [14, 'UAV'],
  [15, 'Space / trans-atmospheric'],
  [16, 'Surface emergency vehicle'],
  [17, 'Surface service vehicle'],
  [18, 'Point obstacle'],
  [19, 'Cluster obstacle'],
  [20, 'Line obstacle'],
]);

const cargoTokens = [
  'cargo',
  'freight',
  'express',
  'logistics',
  'parcel',
  'mail',
  'post',
  'courier',
  'amazon air',
  'cargolux',
  'fedex',
  'ups',
  'dhl',
  'atlas air',
  'kalitta',
  'polar air',
];

const militaryTokens = [
  'air force',
  'army',
  'navy',
  'military',
  'defense',
  'defence',
  'government',
  'coast guard',
  'police',
  'customs',
  'ministry',
  'nato',
  'royal flight',
  'state of',
];

const rescueTokens = [
  'ambulance',
  'med',
  'medevac',
  'rescue',
  'search and rescue',
  'lifeflight',
  'air ambulance',
];

const businessTokens = [
  'executive',
  'business',
  'aviation llc',
  'trustee',
  'holdings',
  'leasing',
  'charter',
  'aircraft management',
];

const airlineSignals = ['operatorIcao', 'operatorIata', 'operatorCallsign'];
const militaryCallsignPrefixes = ['rch', 'rrr', 'nvy', 'herc', 'lobo', 'duke', 'hawk'];
const cargoCallsignPrefixes = ['fdx', 'ups', 'bcs', 'gti', 'cwc', 'abx', 'cjt'];

function textPool(...values) {
  return values
    .filter(Boolean)
    .join(' | ')
    .toLowerCase();
}

function hasToken(haystack, tokens) {
  return tokens.some((token) => haystack.includes(token));
}

function hasPrefix(value, prefixes) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return prefixes.some((prefix) => normalized.startsWith(prefix));
}

export function getEmitterCategoryLabel(category) {
  return emitterCategoryMap.get(category) ?? 'Unknown';
}

export function classifyAircraft(state, aircraft, typeRecord) {
  const emitterCategory = getEmitterCategoryLabel(state.category);
  const searchable = textPool(
    state.callsign,
    aircraft?.registration,
    aircraft?.model,
    aircraft?.typecode,
    aircraft?.operator,
    aircraft?.operatorCallsign,
    aircraft?.operatorIcao,
    aircraft?.operatorIata,
    aircraft?.owner,
    aircraft?.categoryDescription,
    aircraft?.icaoAircraftClass,
    typeRecord?.modelFullName,
    typeRecord?.manufacturerCode,
    typeRecord?.aircraftDescription,
  );

  const typeFamily =
    typeRecord?.aircraftDescription === 'Helicopter'
      ? 'Rotorcraft'
      : typeRecord?.engineType === 'Jet'
        ? 'Jet'
        : typeRecord?.engineType === 'Turboprop/Turboshaft'
          ? 'Turboprop / Turboshaft'
          : typeRecord?.engineType === 'Piston'
            ? 'Piston'
            : typeRecord?.engineType === 'Electric'
              ? 'Electric'
              : emitterCategory;

  if (emitterCategory === 'Rotorcraft' || typeRecord?.aircraftDescription === 'Helicopter') {
    return {
      operationSegment: 'Rotorcraft',
      emitterCategory,
      typeFamily,
      confidence: 'high',
      reason: 'ADS-B rotorcraft flag or helicopter aircraft record',
    };
  }

  if (
    hasToken(searchable, militaryTokens) ||
    hasPrefix(state.callsign, militaryCallsignPrefixes) ||
    hasPrefix(aircraft?.operatorCallsign, militaryCallsignPrefixes)
  ) {
    return {
      operationSegment: 'Military / Government',
      emitterCategory,
      typeFamily,
      confidence: 'medium',
      reason: 'Military or government operator keywords',
    };
  }

  if (hasToken(searchable, rescueTokens)) {
    return {
      operationSegment: 'Emergency / SAR',
      emitterCategory,
      typeFamily,
      confidence: 'medium',
      reason: 'Medical or rescue keyword hit',
    };
  }

  if (
    hasToken(searchable, cargoTokens) ||
    hasPrefix(state.callsign, cargoCallsignPrefixes) ||
    hasPrefix(aircraft?.operatorCallsign, cargoCallsignPrefixes)
  ) {
    return {
      operationSegment: 'Cargo',
      emitterCategory,
      typeFamily,
      confidence: 'medium',
      reason: 'Cargo operator keyword or callsign hit',
    };
  }

  if (
    ['Glider', 'Lighter-than-air', 'Skydiver', 'Ultralight', 'UAV', 'Space / trans-atmospheric'].includes(
      emitterCategory,
    )
  ) {
    return {
      operationSegment: 'Training / Special',
      emitterCategory,
      typeFamily,
      confidence: 'high',
      reason: 'Special emitter category',
    };
  }

  if (hasToken(searchable, businessTokens)) {
    return {
      operationSegment: 'Business / Private',
      emitterCategory,
      typeFamily,
      confidence: 'medium',
      reason: 'Business aviation ownership pattern',
    };
  }

  if (airlineSignals.some((key) => aircraft?.[key]) && ['Large', 'High vortex large', 'Heavy', 'Small'].includes(emitterCategory)) {
    return {
      operationSegment: 'Passenger',
      emitterCategory,
      typeFamily,
      confidence: 'medium',
      reason: 'Commercial operator markers with transport category aircraft',
    };
  }

  if (['Jet', 'Turboprop / Turboshaft'].includes(typeFamily) && ['Light', 'Small'].includes(emitterCategory)) {
    return {
      operationSegment: 'Business / Private',
      emitterCategory,
      typeFamily,
      confidence: 'low',
      reason: 'Light transport-class aircraft without airline markers',
    };
  }

  if (typeFamily === 'Piston' || ['Light', 'Small', 'No info', 'No ADS-B category'].includes(emitterCategory)) {
    return {
      operationSegment: 'General Aviation',
      emitterCategory,
      typeFamily,
      confidence: 'low',
      reason: 'General aviation fallback',
    };
  }

  return {
    operationSegment: 'Unknown',
    emitterCategory,
    typeFamily,
    confidence: 'low',
    reason: 'No strong classification signal',
  };
}
