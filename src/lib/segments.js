export const SEGMENT_COLORS = {
  Passenger: '#8ce99a',
  Cargo: '#ffd166',
  'Military / Government': '#ff6b6b',
  'Business / Private': '#74c0fc',
  'General Aviation': '#c0eb75',
  Rotorcraft: '#63e6be',
  'Emergency / SAR': '#ffa94d',
  'Training / Special': '#c77dff',
  Unknown: '#adb5bd',
};

export const SEGMENT_RGB = {
  Passenger: [140, 233, 154],
  Cargo: [255, 209, 102],
  'Military / Government': [255, 107, 107],
  'Business / Private': [116, 192, 252],
  'General Aviation': [192, 235, 117],
  Rotorcraft: [99, 230, 190],
  'Emergency / SAR': [255, 169, 77],
  'Training / Special': [199, 125, 255],
  Unknown: [173, 181, 189],
};

export function getSegmentColor(segment) {
  return SEGMENT_COLORS[segment] ?? SEGMENT_COLORS.Unknown;
}

export function getSegmentRgb(segment) {
  return SEGMENT_RGB[segment] ?? SEGMENT_RGB.Unknown;
}
