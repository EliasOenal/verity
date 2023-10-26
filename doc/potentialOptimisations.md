# Potential optimisations

This document collects potential future optimisations to the Verity network
which we don't currently plan to implement, but could be invoked once the need
arises.

## Evolving full nodes to trackers
On a cube request, full nodes could, instead of returning the Cube itself,
return a list of nodes they previously sent this Cube to.

## Credit scoring
(Full) Nodes could keep a credit score of connected nodes:
Requesting a cube costs a credit, proving further dissemination of that cube
could earn credits.
