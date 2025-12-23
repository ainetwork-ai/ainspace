import { create } from "zustand";

export type TiledLayer = {
  data: number[];
  name: string;
  type: string;
  visible: boolean;
  width: number;
  height: number;
};


export type Tileset = {
  firstgid: number;
  image: HTMLImageElement;
  columns: number;
  tilecount: number;
  tilewidth: number;
  tileheight: number;
  imageScale?: number;
};

export type TiledMap = {
  tilewidth: number;
  tileheight: number;
  width: number;
  height: number;
  layers: TiledLayer[];
  tilesets: Tileset[];
};

interface MapState {
  mapData: TiledMap | null;
  tilesets: Tileset[];
  collisionTiles: Array<{ x: number; y: number }>;
  mapStartPosition: { x: number; y: number };
  mapEndPosition: { x: number; y: number };
  isLoaded: boolean;

  setIsLoaded: (isLoaded: boolean) => void;
  setMapData: (mapData: TiledMap) => void;
  setTilesets: (tilesets: Tileset[]) => void;
  setCollisionTiles: (collisionTiles: Array<{ x: number; y: number }>) => void;
  setMapStartPosition: (mapStartPosition: { x: number; y: number }) => void;
  setMapEndPosition: (mapEndPosition: { x: number; y: number }) => void;
  isCollisionTile: (x: number, y: number) => boolean;
}

export const useMapStore = create<MapState>((set, get) => ({
  mapData: null,
  tilesets: [],
  collisionTiles: [],
  mapStartPosition: { x: 0, y: 0 },
  mapEndPosition: { x: 0, y: 0 },
  isLoaded: false,

  setIsLoaded: (isLoaded: boolean) => set({ isLoaded }),
  setMapData: (mapData: TiledMap) => set({ mapData }),
  setTilesets: (tilesets: Tileset[]) => set({ tilesets }),
  setCollisionTiles: (collisionTiles: Array<{ x: number; y: number }>) => set({ collisionTiles }),
  setMapStartPosition: (mapStartPosition: { x: number; y: number }) => set({ mapStartPosition }),
  setMapEndPosition: (mapEndPosition: { x: number; y: number }) => set({ mapEndPosition }),
  isCollisionTile: (x: number, y: number) => get().collisionTiles.some((tile) => tile.x === x && tile.y === y),
}));
