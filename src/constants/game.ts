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

// Map boundaries
export const MIN_WORLD_X = Math.floor(MAP_WIDTH / 2);
export const MAX_WORLD_X = MAP_TILES - Math.ceil(MAP_WIDTH / 2);
export const MIN_WORLD_Y = Math.floor(MAP_HEIGHT / 2);
export const MAX_WORLD_Y = MAP_TILES - Math.ceil(MAP_HEIGHT / 2);

// Player initial position
export const INITIAL_PLAYER_POSITION = { x: 72, y: 64 };

// Agent settings
export const ENABLE_AGENT_MOVEMENT = false; // Set to false to disable agent movement
export const AGENT_RESPONSE_DISTANCE = 10; // Distance in tiles for agent to respond to player

export enum DIRECTION {
    UP = 'up',
    DOWN = 'down',
    LEFT = 'left',
    RIGHT = 'right',
    STOP = 'stop'
}
