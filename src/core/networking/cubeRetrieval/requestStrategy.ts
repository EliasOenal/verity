import type { NetworkPeerIf } from '../networkPeerIf';

/**
 * RequestStrategies determine which connected node we'll ask whenever we
 * request a Cube, whether it is because a local application has requested it
 * or whether we're a full node and just try to get our hands on every single
 * Cube out there.
 */
export abstract class RequestStrategy {
  select(available: NetworkPeerIf[]): NetworkPeerIf {
    return undefined;
  }
}
/**
 * What does it sound like? We'll just ask any connected node, potentially
 * several times in a row if luck has it.
 * This is the most basic and probably least useful strategy.
 **/
export class RandomStrategy extends RequestStrategy {
  select(available: NetworkPeerIf[]): NetworkPeerIf {
    const index = Math.floor(Math.random()*available.length);
    return available[index];
  }
}

export class BestScoreStrategy extends RequestStrategy {
  select(available: NetworkPeerIf[]): NetworkPeerIf {
    let best = available[0];
    for (const peer of available) {
      if (peer.trustScore > best.trustScore) {
        best = peer;
      }
    }
    return best;
  }
}

export class RoundrobinStrategy extends RequestStrategy {
  private index = -1;
  select(available: NetworkPeerIf[]): NetworkPeerIf {
    this.index = (this.index + 1) % available.length;
    const peer = available[this.index];
    return peer;
  }
}