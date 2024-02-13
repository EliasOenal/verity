
export const Settings = {
    // Cube related:
    CUBE_VERSION: 1,         // Cubes sculpted locally will have this version
    REQUIRED_DIFFICULTY: 12,  // hash cash must have this many zero bits at the end
    NONCE_SIZE: 4,  // reserve at least 4 bytes as scratch space for hash cash, giving us 2^32 attempts which is more than enough

    /**
     * Seed bytes used to derive a MUC extension key from a user's master key.
     * Can't be more than 6 for the current implementation.
     */
    MUC_EXTENSION_SEED_SIZE: 3,

    // Network related:
    DEFAULT_WS_PORT: 1984,
    DEFAULT_LIBP2P_PORT: 1985,  // this is actually also WebSocket, but libp2p's flavour
    NETWORK_TIMEOUT: 0,  // Getting strange timeouts, deactivating for now , original: (10 * 1000),  // currently only used while establishing connection
    ANNOUNCEMENT_INTERVAL: (25 * 60 * 1000),  // 25 minutes between Torrent tracker announcements
    NEW_PEER_INTERVAL: (1 * 1000),  // autoconnect a new peer every second
    CONNECT_RETRY_INTERVAL: (1 * 1000),  // Initially retry a failed peer connection after 1 sec
    RECONNECT_INTERVAL: (10 * 1000),  // Initially reconnect a peer after 10sec
    RECONNECT_MAX_FIBONACCI_FACTOR: 8, // 20, // increase RETRY and RECONNECT intervals on each failure according to a Fibonacci factor, but no more than 20 times (i.e. a maximum of 6765 times the initial interval)
    MAXIMUM_CONNECTIONS: 20, // Maximum number of connections to maintain

    // Peer related:
    TRUST_SCORE_THRESHOLD: -1000,  // peers with a score below this are considered bad peers
    BAD_PEER_REHABILITATION_CHANCE: 0.1,  // chance of trying to connect to a peer with bad local trust score

    // Network peer related:
    KEY_REQUEST_TIME: (10 * 1000),  // asks nodes for new cube keys every 10 seconds
    NODE_REQUEST_TIME: (10 * 1000),  // asks nodes for their known nodes every minute

    // Debugging related:
    RUNTIME_ASSERTIONS: true,
}

export class VerityError extends Error {}
export class ApiMisuseError extends VerityError { }
