'use client';

import { createContext, useContext, ReactNode } from 'react';

interface MapDataContextType {
  getMapData: (centerX: number, centerY: number, width: number, height: number) => number[][];
  getCircularMapData: (centerX: number, centerY: number, radius: number, width: number, height: number) => number[][];
  generateTileAt: (x: number, y: number) => number;
}

const MapDataContext = createContext<MapDataContextType | undefined>(undefined);

interface MapDataProviderProps {
  children: ReactNode;
}

export function MapDataProvider({ children }: MapDataProviderProps) {
  const generateTileAt = (x: number, y: number): number => {
    // Create deterministic pseudo-random generation based on coordinates
    const seed = x * 1000 + y;
    const random = Math.abs(Math.sin(seed * 12.9898) * 43758.5453) % 1;
    
    // Create biomes based on position
    const biomeX = Math.floor(x / 20);
    const biomeY = Math.floor(y / 20);
    const biomeSeed = biomeX * 100 + biomeY;
    const biomeRandom = Math.abs(Math.sin(biomeSeed * 7.1234) * 23456.7891) % 1;
    
    // Determine biome type
    let biomeType = 0;
    if (biomeRandom < 0.3) biomeType = 1; // Desert biome
    else if (biomeRandom < 0.5) biomeType = 2; // Water biome
    else if (biomeRandom < 0.7) biomeType = 3; // Mountain biome
    
    // Generate roads/paths occasionally
    if (x % 15 === 0 || y % 15 === 0) {
      if (random < 0.7) return 1; // Dirt path
    }
    
    // Generate structures - removed stone structures for free movement
    
    // Generate terrain based on biome - removed stone tiles for free movement
    switch (biomeType) {
      case 1: // Desert biome
        if (random < 0.4) return 1; // Dirt
        return 0; // Grass (sandy grass)
        
      case 2: // Water biome
        if (random < 0.6) return 2; // Water
        if (random < 0.8) return 0; // Grass
        return 1; // Dirt
        
      case 3: // Mountain biome (now without stone obstacles)
        if (random < 0.7) return 1; // Dirt
        return 0; // Grass
        
      default: // Plains biome
        if (random < 0.15) return 1; // Dirt
        if (random < 0.25) return 2; // Water
        return 0; // Grass
    }
  };

  const getMapData = (centerX: number, centerY: number, width: number, height: number): number[][] => {
    const halfWidth = Math.floor(width / 2);
    const halfHeight = Math.floor(height / 2);
    
    const mapData: number[][] = [];
    
    for (let y = 0; y < height; y++) {
      const row: number[] = [];
      for (let x = 0; x < width; x++) {
        const worldX = centerX - halfWidth + x;
        const worldY = centerY - halfHeight + y;
        row.push(generateTileAt(worldX, worldY));
      }
      mapData.push(row);
    }
    
    return mapData;
  };

  const getCircularMapData = (centerX: number, centerY: number, radius: number, width: number, height: number): number[][] => {
    const halfWidth = Math.floor(width / 2);
    const halfHeight = Math.floor(height / 2);
    
    const mapData: number[][] = [];
    
    for (let y = 0; y < height; y++) {
      const row: number[] = [];
      for (let x = 0; x < width; x++) {
        const worldX = centerX - halfWidth + x;
        const worldY = centerY - halfHeight + y;
        
        // Calculate distance from center
        const dx = worldX - centerX;
        const dy = worldY - centerY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // If outside radius, use a special "void" tile (we'll use -1 to indicate invisible)
        if (distance > radius) {
          row.push(-1); // Invisible/void tile
        } else {
          row.push(generateTileAt(worldX, worldY));
        }
      }
      mapData.push(row);
    }
    
    return mapData;
  };

  const value: MapDataContextType = {
    getMapData,
    getCircularMapData,
    generateTileAt,
  };

  return (
    <MapDataContext.Provider value={value}>
      {children}
    </MapDataContext.Provider>
  );
}

export function useMapData() {
  const context = useContext(MapDataContext);
  if (context === undefined) {
    throw new Error('useMapData must be used within a MapDataProvider');
  }
  return context;
}