# Feature backlog
## Core
- Direct access to Cubes from persistant memory / stop loading all Cubes to RAM
- Parametrize pruning and enable it by default
  (e.g. pruning based on available space -- this is especially important
  now that we basically don't have any content and will therefore basically
  not want to do any pruning at all)
- Support multiple Cube exchange methods, implement ToW based exchange and
  enable it by default for full nodes.
  Rework current naive key list based exchange into a sliding-window based
  exchange of most current Cubes.
- Support WebRTC server nodes, or some other way to set up full nodes in a way
  which does not require an SSL cert and still makes them reachable from secure
  browser contexts.

## Microblogging app
- QR codes for adding / subscribing to local friends

# Other global TODOs
...?
