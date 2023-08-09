
export const Settings = {
    REQUIRED_DIFFICULTY: 12,
    ANNOUNCEMENT_INTERVAL: (25 * 60 * 1000),  // 25 minutes in milliseconds
    NEW_PEER_INTERVAL: (1 * 60 * 1000),  // 1 minutes in milliseconds
    RECONNECT_INTERVAL: (10 * 1000),  // 10 seconds in milliseconds
    RECONNECT_ATTEMPTS: 2,
    MAXIMUM_CONNECTIONS: 20, // Maximum number of connections to maintain
    HASH_REQUEST_TIME: (10 * 1000),  // 10 seconds in milliseconds
    HASHCASH_SIZE: 4,  // reverse at least 4 bytes as scratch space for hash cash, giving us 2^32 attempts which is more than enough

    // debug/development settings -- should remove these later on
    HASH_WORKERS: false,
}

export class VerityError extends Error {}
