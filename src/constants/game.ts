// Game tile and map constants

// Tile size in pixels (both for rendering and game coordinates)
export const TILE_SIZE = 40;

// Village dimensions (in tiles) - each village is a square grid
export const VILLAGE_SIZE = 20;

// Viewport dimensions (in tiles)
export const MAP_WIDTH = 16;
export const MAP_HEIGHT = 12;
export const VIEW_RADIUS = 6;

export const BROADCAST_RADIUS = 5;

// Player initial position
export const INITIAL_PLAYER_POSITION = { x: 0, y: 0 };
// export const INITIAL_PLAYER_POSITION = { x: 59, y: 70 };

// Agent settings
export const ENABLE_AGENT_MOVEMENT = true; // Set to false to disable agent movement
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

export enum MOVEMENT_MODE {
    VILLAGE_WIDE = 'village_wide',
    SPAWN_CENTERED = 'spawn_centered',
    STATIONARY = 'stationary'
}

// Default movement mode for agents without explicit mode set
export const DEFAULT_MOVEMENT_MODE = MOVEMENT_MODE.STATIONARY;

// Radius for spawn-centered movement (in tiles)
export const SPAWN_RADIUS = process.env.NEXT_PUBLIC_SPAWN_RADIUS
    ? parseInt(process.env.NEXT_PUBLIC_SPAWN_RADIUS, 10)
    : 3;
