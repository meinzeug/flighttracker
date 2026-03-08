export const RADAR_MAP_STYLE = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    terrain: {
      type: 'raster',
      tiles: ['https://tile.opentopomap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution:
        '&copy; OpenStreetMap contributors, SRTM | Kartendarstellung: OpenTopoMap',
    },
  },
  layers: [
    {
      id: 'terrain-raster',
      type: 'raster',
      source: 'terrain',
      minzoom: 0,
      maxzoom: 22,
      paint: {
        'raster-brightness-max': 0.96,
        'raster-saturation': -0.08,
        'raster-contrast': 0.14,
      },
    },
  ],
};
