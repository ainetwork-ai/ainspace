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

  setMapData: (mapData: TiledMap) => void;
  setTilesets: (tilesets: TilesetResource[]) => void;
}

export const useMapStore = create<MapState>((set) => ({
  mapData: null,
  tilesets: [],
  
  setMapData: (mapData: TiledMap) => set({ mapData }),
  setTilesets: (tilesets: TilesetResource[]) => set({ tilesets }),
}));
