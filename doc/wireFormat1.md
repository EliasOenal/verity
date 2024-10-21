# Wire format 1.0

  1. **Protocol Version (1 byte)**: This is the version of the protocol being used. This allows for future updates and backward compatibility. For now, you can set this to 0x01.

  2. **Message Class (1 byte)**: This is an identifier for the type of message. Here's a possible mapping:
  - `0x00`: `Hello`
  - `0x01`: `KeyRequest`
  - `0x02`: `KeyResponse`
  - `0x03`: `CubeRequest`
  - `0x04`: `CubeResponse`
  - `0x05`: `MyServerAddress`
  - `0x06`: `NodeRequest`
  - `0x07`: `NodeResponse`
  - `0x08`: `NotificationCubeRequest` (brand new and already basically deprecated)

  Each of these message classes will have different data payloads:
  - `Hello`:
    - **Node Identifier (16 bytes)**: This is a unique NodeID that's randomly generated at startup. Primary purpose is to detect when we connected to ourselves. This may happen if we don't know our external IP. (e.g. NAT) Secondarily this may be used to detect duplicate connections to the same node, which may happen if the node is reachable via multiple IPs.
    - Proposed future additions:
      - **Node type (1 byte)***: 0x01 for full nodes, 0x02 for light nodes
      - **Community key (32 byte)**: Identifies this node to belong to a specific community of Verity nodes. Other nodes should only proceed with the connection
        if they identify with the same community. The exact mechanism of determining whether or not two nodes belong to the same community can be specific to the
        individual community. By default, nodes are assumed to belong the same community if their community keys are identical.
      - **Sharding from (32 bytes)**: Indicates this node only intends to serves Cubes with keys greater than this value.
      - **Sharding to (32 bytes)**: Indicates this node only intends to serves Cubes with keys less than this value.

  - `KeyRequest`:
    - **Header Byte (1 byte)**: Indicates the mode of the request:
      * `0x00`: Legacy Mode (Deprecated)
      * `0x01`: Sliding Window Mode
      * `0x02`: Sequential Store Sync Mode
      * `0x03`: Notification Mode w/ Challenge constraint
      * `0x04`: Notification Mode w/ Timestamp constraint
    - **Key Count (4 bytes)**: This is an integer indicating the number of keys being requested.
    - **Start-from key (32 bytes)**: Used in Sliding Window and Sequential Store Sync modes. Specifies the key to start from. In Sliding Window Mode it can be zero to start from the beginning. Mandatory in Sequential Store Sync Mode. The key itself is not included in the response, only the respective keys that succeed it.
    - Only in Notification Mode:
      - **Notification to (32 bytes)**: Only request notification Cubes containing exactly this key in their NOTIFY field.
      - Only in Notification Mode w/ Challenge constraint:
        - **Minimum challenge Level (1 byte)**: The minimum number of trailing zeroes required in the Cube's hash.
      - Only in Notification Mode w/ Timestamp constraint:
        - **Timestamp minimum (5 bytes)**: Cube must be newer than this timestamp
        - **Timestamp maximum (5 bytes)**: Cube must be older than this timestamp
    - Proposed extension... some day... somehow... and in an orthogonal fashion please. These different modes with different options make me go crazy.
      - **Filters (optional)**: Only request keys of Cubes matching certain criteria.
          - **Cube Type (1 byte)**: The type of the cube (e.g., regular, MUC, IPC).

    To support Sliding Window Mode each node holds one sliding window of the keys to the most recently received cubes. Upon receiving a request the requested key is identified and the keys succeeding it, up to the number of requested keys, is then sent via KeyResponse. The size of the window is configurable, but should be at least 1000 keys. The oldest keys are overwritten by the newest. This mode is meant for near real-time synchronization of the most recent cubes. On startup if no new cubes are downloaded the keys reported from other nodes may be used to fill the window, even if the respective cubes are already in the store.

    Sequential Store Sync Mode is a similar approach to Sliding Window Mode, but instead of a window, the node sends keys that succeed the requested key in the store. Reaching the last key of the store is a special case, where the node loops back to the first key and continues. This mode is mainly meant for background synchronization of the store.

    This message may get extended in the future to allow for more fine-grained control over which keys to request. (e.g. by date or by MPT subtree)

    >DoS Vulnerability: The Legacy Mode is deprecated and not recommended due to its potential for Denial of Service attacks. Supporting it requires large amounts of RAM on the node to store all keys.

  - `KeyResponse`:
    - **Header Byte (1 byte)**: Indicates the mode of the request:
      * `0x00`: Legacy Mode (Deprecated)
      * `0x01`: Sliding Window Mode
      * `0x02`: Sequential Store Sync Mode
    - **Key Count (4 bytes)**: This is an integer indicating the number of keys being sent.
    - **Cube Details**: Each detail includes:
      - **Cube Type (1 byte)**: The type of the cube (e.g., regular, MUC, IPC).
      - **Challenge Level (1 byte)**: The challenge level the cube adheres to.
      - **Timestamp (5 bytes)**: The timestamp of the cube.
      - **Key (32 bytes)**: The key of the cube.
      - Proposed extension: **PMUC update count (4 byte)**

  - `CubeRequest`:
    - **Cube Key Count (4 bytes)**: This is an integer indicating the number of cubes being requested.
    - **Cube Keys (32 bytes each)**: This is a series of 32-byte Cube key values. The number of keys must match the previously indicated Cube Key Count.

  - `CubeResponse`:
    - **Cube Count (4 bytes)**: This is an integer indicating the number of cubes being sent.
    - **Cubes (1024 bytes each)**: This is a series of cubes. Each cube is 1024 bytes as per your cube specification. The number of cubes should match the Cube Count.

  - `MyServerAddress`:
    - **Node Address type  (1 byte)**: 1=WebRTC, 2=LibP2p
    - **Node Address length (2 bytes)**
    - **Node Address string (variable length)**

  - `NodeRequest`: This message requests a list of known node addresses from a peer.
    - **Payload**: None

  - `NodeResponse`: This message provides a list of known node addresses to a peer.
    - **Node Count (4 bytes)**: An integer indicating the number of node addresses being sent.
    - **Node Entries (variable length)**: A series of node entries. Each entry consists of:
      - **Node Address type  (1 byte)**: 1=WebRTC, 2=LibP2p
      - **Node Address Length (2 bytes)**: An integer indicating the length of the node address.
      - **Node Address string (variable length)**: The node address (e.g., WebSocket URL). The length of the address should match the Node Address Length.

  - `NotificationRequest`: Requests all Cubes with a NOTIFY field containing the
    specified recipient key. This is a specialised type of CubeRequest and will
    be answered with a CubeResponse.
    - **Cube Key Count (4 bytes)**: The number of notification keys following
    - **Recipient key (32 bytes)**: Sender requests all Cubes notifying the specified key

  - `CubeSubscribe`: Requests all *future* Cube updates for the keys supplied.
    - Message follows the exact same structure as a CubeRequest.
    - TODO: Provide a way to select a subscription duration
    - TODO: Provide a way to cancel a subscription before it expires.
    - TODO: Provide for an efficient way to extend subscription, e.g. using
      the hash of all Cube keys as a subscription key.

  - `SubscriptionConfirmation`
    - **Response code (1 Byte)**:
      - `0x01`: Subscription confirmed
      - `0x02`: Subscriptions not supported
      - `0x03`: Subscriptions temporarily unavailable
      - `0x04`: You have reached the maximum number of subscriptions from this node
      - `0x10`: (At least one) Requested key not available
    - **Key(s) requested (32 Bytes)**:
      - In case a single key subscription was requested, the requested key
      - In case multiple keys were requested, this is the hash of all keys
        Note: The reponse always refers to a single request message, requests
        are never grouped by the serving node. This is to allow the requester
        to clearly identify which request this response refers to.
    - **Hash(es) of subscribed Cubes (32 Bytes)** (optional):
      - In case a single key subscription was requested, the hash of the
        current version of the subscribed cube
      - In case multiple keys were requested, this is the hash of all
        subscribed cube's hashes.
      - This field is omitted if the subscription request is not granted.
