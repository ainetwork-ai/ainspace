// Game tile and map constants

// Tile size in pixels (both for rendering and game coordinates)
export const TILE_SIZE = 40;

// Map dimensions
export const MAP_SIZE_PIXELS = 4200;
export const MAP_TILES = MAP_SIZE_PIXELS / TILE_SIZE; // 105 tiles

// Viewport dimensions (in tiles)
export const MAP_WIDTH = 16;
export const MAP_HEIGHT = 12;
export const VIEW_RADIUS = 6;

export const BROADCAST_RADIUS = 5;

// Map boundaries
export const MIN_WORLD_X = Math.floor(MAP_WIDTH / 2);
export const MAX_WORLD_X = MAP_TILES - Math.ceil(MAP_WIDTH / 2);
export const MIN_WORLD_Y = Math.floor(MAP_HEIGHT / 2);
export const MAX_WORLD_Y = MAP_TILES - Math.ceil(MAP_HEIGHT / 2);

// Player initial position
export const INITIAL_PLAYER_POSITION = { x: 0, y: 0 };
// export const INITIAL_PLAYER_POSITION = { x: 59, y: 70 };

// Agent settings
export const ENABLE_AGENT_MOVEMENT = false; // Set to false to disable agent movement
export const AGENT_RESPONSE_DISTANCE = 2; // Distance in tiles for agent to respond to player

// Player movement settings
export const MIN_MOVE_INTERVAL = 150; // Minimum milliseconds between moves (prevents double movement)

export enum DIRECTION {
    UP = 'up',
    DOWN = 'down',
    LEFT = 'left',
    RIGHT = 'right',
    STOP = 'stop'
}

export enum MAP_NAMES {
  HAPPY_VILLAGE = 'Happy Village',
  HAHOE_VILLAGE = 'Hahoe Village',
  UNCOMMON_VILLAGE = 'Uncommon Village',
  HARRIS_VILLAGE = 'Harris Village',
  UNBLOCK_VILLAGE = 'Unblock Village',
}

export const MAP_ZONES: {
  [key in MAP_NAMES]: {
    startX: number;
    startY: number;
    endX: number;
    endY: number;
  }
} = {
  [MAP_NAMES.HAPPY_VILLAGE]: {
    startX: -10,
    startY: -19,
    endX: 8,
    endY: 1,
  },
  [MAP_NAMES.HAHOE_VILLAGE]: {
    startX: -29,
    startY: -19,
    endX: -10,
    endY: 1,
  },
  [MAP_NAMES.UNCOMMON_VILLAGE]: {
    startX: -29,
    startY: 3,
    endX: 8,
    endY: 16,
  },
  [MAP_NAMES.HARRIS_VILLAGE]: {
    startX: 10,
    startY: 3,
    endX: 26,
    endY: 16,
  },
  [MAP_NAMES.UNBLOCK_VILLAGE]: {
    startX: 12,
    startY: -19,
    endX: 26,
    endY: 1,
  },
}