# Feature backlog
## Core
- Direct access to Cubes from persistant memory / stop loading all Cubes to RAM
- Define a common interface for CubeStore and RequestScheduler so application
  code on light nodes can fetch Cubes directly from the network; rewrite a lot
  of CCI and application level code to use this new interface instead of assuming
  everything is always present in the local CubeStore (i.e. stop assuming
  everything is running on a full node)
- Implement PIC
- Parametrize pruning and enable it by default
  (e.g. pruning based on available space -- this is especially important
  now that we basically don't have any content and will therefore basically
  not want to do any pruning at all)
  Note: In the browser, use navigator.storage.estimate() to start pruning
  well before we reach the returned quota.
- Support multiple Cube exchange methods, implement ToW based exchange and
  enable it by default for full nodes.
  Rework current naive key list based exchange into a sliding-window based
  exchange of most recent Cubes.
- MUC subscriptions, i.e. implement a way in which a node can easily receive
  updates to a MUC without polling and re-downloading the same version over and
  over again.
- Persist known good peers to reduce reliance and load on initial peers
- Support WebRTC server nodes, or some other way to set up full nodes in a way
  which does not require an SSL cert and still makes them reachable from secure
  browser contexts.
- Allow Cube retraction: Cubes may contain a public key allowing the private
  key owner to retract the Cube with a signed message. Retractions to propagate
  through the network the same way as MUC updates. Any Cube may be retracted,
  even frozen ones. This is probably necessary for certain usage scenarios
  to comply with European data protection law.
- Node communities: Allow Cubes to limit propagation to a certain community of
  nodes, e.g. European nodes run by academic institutions. This is useful
  for certain usage scenarios to comply with European data protection law.
  It's a less intrusive alternative to fully private Verity networks, empowering
  full nodes run by users subject to such restrictions to still contribute to
  Verity as a whole.
- At some point in the far future: Local node-to-node communication using
  Bluetooth or ad-hoc WiFi
- Full node verification

# CCI
- Implement Cube encryption
- Implement continuation chains

## CCI Identity
- Support umbrella identities linking together a user's profiles over multiple
  Verity apps.
- Implement merge of remote changes. Problem: How to deal with deletions?

# UI Framework
- Move Verity node to a (shared) WebWorker (comlink)

# Microblogging app
- PWA: Rework service worker to auto-update cached assets
- Show user's profiles and their posts
- Allow further customization of profiles, e.g. with a short introductory text
- Implement post groups, e.g. hash tags
- QR codes for adding / subscribing to local friends

# Other global TODOs
...?
