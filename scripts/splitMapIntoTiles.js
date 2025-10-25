#!/usr/bin/env node

/**
 * Script to split large map images into tiles for efficient tile-based rendering
 *
 * This script:
 * 1. Reads the large map images (land_layer_0.webp, land_layer_1.webp)
 * 2. Splits them into smaller tiles (e.g., 5x5 tiles of 840x840 pixels each)
 * 3. Saves tiles as separate WebP files for lazy loading
 *
 * Map info:
 * - Total size: 4200x4200 pixels
 * - Game tiles: 105x105 (40px each)
 * - Image tiles: 5x5 (each containing 21x21 game tiles)
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// Configuration
const MAP_DIR = path.join(__dirname, '../public/map');
const TILES_DIR = path.join(__dirname, '../public/map/tiles');
const MAP_SIZE = 4200; // Total map size in pixels
const TILE_SIZE = 840; // Each image tile will be 840x840 pixels (21 game tiles)
const TILES_PER_SIDE = Math.ceil(MAP_SIZE / TILE_SIZE); // 5 tiles per side

// Layers to process
const LAYERS = [
  { name: 'land_layer_0', filename: 'land_layer_0.webp' },
  { name: 'land_layer_1', filename: 'land_layer_1.webp' }
];

async function ensureDirectoryExists(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Created directory: ${dir}`);
  }
}

async function splitImageIntoTiles(inputPath, outputDir, layerName) {
  console.log(`\nProcessing ${layerName}...`);

  if (!fs.existsSync(inputPath)) {
    console.log(`Skipping ${layerName}: file not found at ${inputPath}`);
    return;
  }

  const layerDir = path.join(outputDir, layerName);
  await ensureDirectoryExists(layerDir);

  const image = sharp(inputPath);
  const metadata = await image.metadata();

  console.log(`Image size: ${metadata.width}x${metadata.height}`);
  console.log(`Splitting into ${TILES_PER_SIDE}x${TILES_PER_SIDE} tiles of ${TILE_SIZE}x${TILE_SIZE} pixels each`);

  let tilesCreated = 0;

  for (let row = 0; row < TILES_PER_SIDE; row++) {
    for (let col = 0; col < TILES_PER_SIDE; col++) {
      const left = col * TILE_SIZE;
      const top = row * TILE_SIZE;

      // Handle edge tiles that might be smaller
      const width = Math.min(TILE_SIZE, metadata.width - left);
      const height = Math.min(TILE_SIZE, metadata.height - top);

      const outputPath = path.join(layerDir, `tile_${row}_${col}.webp`);

      try {
        await sharp(inputPath)
          .extract({ left, top, width, height })
          .webp({ quality: 90, effort: 6 })
          .toFile(outputPath);

        tilesCreated++;
        process.stdout.write(`\rCreated ${tilesCreated}/${TILES_PER_SIDE * TILES_PER_SIDE} tiles`);
      } catch (error) {
        console.error(`\nError creating tile at (${row}, ${col}):`, error.message);
      }
    }
  }

  console.log(`\nCompleted ${layerName}: ${tilesCreated} tiles created`);
}

async function main() {
  console.log('=== Map Tile Splitter ===');
  console.log(`Map directory: ${MAP_DIR}`);
  console.log(`Output directory: ${TILES_DIR}\n`);

  await ensureDirectoryExists(TILES_DIR);

  for (const layer of LAYERS) {
    const inputPath = path.join(MAP_DIR, layer.filename);
    await splitImageIntoTiles(inputPath, TILES_DIR, layer.name);
  }

  console.log('\n=== Tile splitting complete! ===');
  console.log(`\nTiles saved to: ${TILES_DIR}`);
  console.log(`\nTile configuration:`);
  console.log(`- Tiles per side: ${TILES_PER_SIDE}`);
  console.log(`- Tile size: ${TILE_SIZE}x${TILE_SIZE} pixels`);
  console.log(`- Game tiles per image tile: 21x21`);
  console.log(`\nYou can now update your rendering code to use these tiles.`);
}

main().catch(console.error);
