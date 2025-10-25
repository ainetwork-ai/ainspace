# Tile-Based Rendering for Map Images

## Overview

This project now uses tile-based rendering for the map layers, which significantly improves performance and reduces initial load times.

## How It Works

### Before (Full Image Loading)
- Loaded entire map images: `land_layer_0.webp` (4.2MB) and `land_layer_1.webp` (2.7MB)
- Total initial download: ~7MB
- Used progressive loading (preview + high quality)
- All pixels loaded even if not visible

### After (Tile-Based Rendering)
- Map split into 5x5 grid of tiles (25 tiles per layer)
- Each tile: 840x840 pixels (21x21 game tiles)
- Only loads visible tiles
- Average tile size: ~180KB
- Typical scenario loads 4-6 tiles initially (~1MB)

## Performance Benefits

1. **Reduced Initial Load**: Only visible tiles are loaded (~85% reduction)
2. **Faster Time to Interactive**: Smaller initial payload
3. **Better Caching**: Individual tiles can be cached separately
4. **Smoother Scrolling**: Tiles load on-demand as user moves
5. **Memory Efficiency**: Unused tiles can be garbage collected

## File Structure

```
public/map/
├── land_layer_0.webp           # Original full image (legacy)
├── land_layer_1.webp           # Original full image (legacy)
├── land_layer_0_preview.webp   # Preview image (legacy)
├── land_layer_1_preview.webp   # Preview image (legacy)
└── tiles/                      # Tile-based rendering
    ├── land_layer_0/
    │   ├── tile_0_0.webp      # Top-left tile
    │   ├── tile_0_1.webp
    │   ├── ...
    │   └── tile_4_4.webp      # Bottom-right tile
    └── land_layer_1/
        ├── tile_0_0.webp
        ├── ...
        └── tile_4_4.webp
```

## Tile Configuration

- **Map Size**: 4200x4200 pixels
- **Game Tile Size**: 40x40 pixels
- **Total Game Tiles**: 105x105
- **Image Tile Size**: 840x840 pixels
- **Image Tiles per Side**: 5
- **Game Tiles per Image Tile**: 21x21

## Usage

### In TileMap Component

```tsx
<TileMap
  // ... other props
  useTileBasedRendering={true}  // Enable tile-based rendering (default)
/>
```

### Disable Tile-Based Rendering (Fallback)

```tsx
<TileMap
  // ... other props
  useTileBasedRendering={false}  // Use full image rendering
/>
```

## Generating Tiles

If you need to regenerate tiles (e.g., after updating map images):

```bash
node scripts/splitMapIntoTiles.js
```

This script:
1. Reads `land_layer_0.webp` and `land_layer_1.webp`
2. Splits them into 5x5 tiles
3. Saves tiles to `public/map/tiles/{layer_name}/`
4. Uses WebP format with 90% quality

## Implementation Details

### Custom Hook: `useTileBasedMap`

Located in `src/hooks/useTileBasedMap.ts`

This hook:
- Calculates which tiles are visible based on camera position
- Loads visible tiles on-demand
- Maintains a cache of loaded tiles
- Automatically loads new tiles when camera moves

### Drawing Function: `drawTiledMap`

Renders loaded tiles on canvas:
- Calculates tile positions in screen space
- Handles partial tile visibility
- Scales tiles based on zoom level

## Browser Caching

Tiles are cached by the browser, so:
- First visit: Downloads only visible tiles
- Subsequent visits: Tiles served from browser cache
- Moving around: Previously visited areas load instantly

## Future Optimizations

1. **Lazy Loading**: Add intersection observer for smoother loading
2. **Preloading**: Preload adjacent tiles before they're visible
3. **Different Zoom Levels**: Generate tiles at multiple resolutions
4. **Compression**: Experiment with different WebP quality settings
5. **CDN**: Serve tiles from a CDN for better performance

## Monitoring Performance

You can check tile loading in browser DevTools:

1. Open Network tab
2. Filter by "webp"
3. Watch as tiles load when moving camera
4. Check total size downloaded

## Troubleshooting

### Tiles Not Loading

1. Check console for errors
2. Verify tiles exist in `public/map/tiles/`
3. Check network tab for 404 errors
4. Try regenerating tiles with the script

### Tiles Look Blurry

- Tiles are rendered at 840x840 pixels
- Zoom levels beyond 2x may show pixelation
- Consider generating higher-resolution tiles if needed

### Performance Issues

- Check how many tiles are being loaded
- Consider implementing tile unloading for visited tiles
- Monitor memory usage in DevTools
