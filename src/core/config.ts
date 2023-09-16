
export const Settings = {
    // Cube related:
    REQUIRED_DIFFICULTY: 12,  // hash cash must have this many zero bits at the end
    HASHCASH_SIZE: 4,  // reverse at least 4 bytes as scratch space for hash cash, giving us 2^32 attempts which is more than enough

    // Network manager related:
    ANNOUNCEMENT_INTERVAL: (25 * 60 * 1000),  // 25 minutes in milliseconds
    NEW_PEER_INTERVAL: (1 * 1000),
    MAXIMUM_CONNECTIONS: 20, // Maximum number of connections to maintain

    // Network peer related:
    HASH_REQUEST_TIME: (10 * 1000),  // asks nodes for new cube keys every 10 seconds
    NODE_REQUEST_TIME: (60 * 1000),  // asks nodes for their known nodes every minute

    // local implementation details:
    HASH_WORKERS: false,  // whether or not to use the threaded hash cash implementation on NodeJS
}

export class VerityError extends Error {}
