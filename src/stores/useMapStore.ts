import { create } from "zustand";

type TiledLayer = {
  data: number[];
  name: string;
  type: string;
  visible: boolean;
  width: number;
  height: number;
};

type TiledTileset = {
  firstgid: number;
  source: string;
};

type TilesetResource = {
  firstgid: number;
  image: HTMLImageElement;
  columns: number;
  tilecount: number;
  tilewidth: number;
  tileheight: number;
};

type TiledMap = {
  tilewidth: number;
  tileheight: number;
  width: number;
  height: number;
  layers: TiledLayer[];
  tilesets: TiledTileset[];
};

interface MapState {
  mapData: TiledMap | null;
  tilesets: TilesetResource[];
  collisionTiles: Array<{ x: number; y: number }>;

  setMapData: (mapData: TiledMap) => void;
  setTilesets: (tilesets: TilesetResource[]) => void;
  setCollisionTiles: (collisionTiles: Array<{ x: number; y: number }>) => void;
  isCollisionTile: (x: number, y: number) => boolean;
}

export const useMapStore = create<MapState>((set, get) => ({
  mapData: null,
  tilesets: [],
  collisionTiles: [],
  
  setMapData: (mapData: TiledMap) => set({ mapData }),
  setTilesets: (tilesets: TilesetResource[]) => set({ tilesets }),
  setCollisionTiles: (collisionTiles: Array<{ x: number; y: number }>) => set({ collisionTiles }),
  isCollisionTile: (x: number, y: number) => get().collisionTiles.some((tile) => tile.x === x && tile.y === y),
}));
