export const Settings = {
    // Cube related:
    CUBE_VERSION: 1,         // Cubes sculpted locally will have this version
    REQUIRED_DIFFICULTY: 12,  // hash cash must have this many zero bits at the end
    HASHCASH_SIZE: 4,  // reverse at least 4 bytes as scratch space for hash cash, giving us 2^32 attempts which is more than enough
    TREE_OF_WISDOM: false, // enable Tree of Wisdom structure for efficient cube syncing
    CUBE_RETENTION_POLICY: false,  // Verify cubes against current epoch

    // CubeStore related
    // - CubePersistence related
    CUBEDB_NAME: "cubes",
    CUBEDB_VERSION: 4,
    CUBE_PERSISTENCE_VERIFICATION: false,  // Not implemented -- Verify 0.07% of read cubes (1 in 1337)
    CUBE_PERSISTENCE_DELETE_CORRUPT: false,  // Not implemented -- Delete corrupt cubes from the database
    CUBESTORE_IN_MEMORY: true,  // this should really default to false to prevent accidental loss, but we need to check all of our tests for that
    CUBE_CACHE: true,  // Cache Cubes in memory until the garbage collector comes for them

    /**
     * Seed bytes used to derive a MUC extension key from a user's master key.
     * Can't be more than 6 for the current implementation.
     */
    MUC_EXTENSION_SEED_SIZE: 3,

    // Network related:
    DEFAULT_WS_PORT: 1984,
    DEFAULT_LIBP2P_PORT: 1985,  // this is actually also WebSocket, but libp2p's flavour
    NETWORK_TIMEOUT: (10 * 1000),  // 10 seconds
    ANNOUNCEMENT_INTERVAL: (25 * 60 * 1000),  // 25 minutes between Torrent tracker announcements
    NEW_PEER_INTERVAL: (1 * 1000),  // autoconnect a new peer every second
    CONNECT_RETRY_INTERVAL: (1 * 1000),  // Initially retry a failed peer connection after 1 sec
    RECONNECT_INTERVAL: (10 * 1000),  // Initially reconnect a peer after 10sec
    RECONNECT_MAX_FIBONACCI_FACTOR: 8, // 20, // increase RETRY and RECONNECT intervals on each failure according to a Fibonacci factor, but no more than 20 times (i.e. a maximum of 6765 times the initial interval)
    MAXIMUM_CONNECTIONS: 20, // Maximum number of connections to maintain
    RECENT_KEY_WINDOW_SIZE: 10000, // Network Manager keeps track of the last 10,000 new keys

    // Individual connection settings:
    DISCONNECT_ERROR_COUNT: 5,  // close a network peer after at least five
    DISCONNECT_ERROR_TIME: 60,  // errors spanning at least 60 seconds

    // Peer related:
    TRUST_SCORE_THRESHOLD: -1000,  // peers with a score below this are considered bad peers
    BAD_PEER_REHABILITATION_CHANCE: 0.1,  // chance of trying to connect to a peer with bad local trust score

    // Request scheduler related:
    KEY_REQUEST_TIME: (10 * 1000),  // run CubeRequests and/or KeyRequests every 10 seconds by default
    NODE_REQUEST_TIME: (10 * 1000),  // asks nodes for their known nodes every 10 seconds (this is still implemented directly in NetworkPeer rather than the RequestScheduler)
    CUBE_REQUEST_TIMEOUT: (60 * 1000),
    CUBE_REQUEST_RETRIES: 10,
    REQUEST_SCALE_FACTOR: 4,  // make requests n times more often at MAXIMUM_CONNECTION compared to on a single connection
    INTERACTIVE_REQUEST_DELAY: 100,  // when a (presumably) interactive application requests a Cube on a light node, auto-schedule the next request in 100ms -- in other words, keep collecting requests for the next 100ms before actually performing the request
    CUBE_SUBSCRIPTION_PERIOD: (600 * 1000),  // Cube subscriptions last 10 minues by default. NOTE: Expiry not implemented yet.

    // Debugging related:
    RUNTIME_ASSERTIONS: true,
}

export class VerityError extends Error { name = "CubeError" }
export class ApiMisuseError extends VerityError { name = "VerityError" }
