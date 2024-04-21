import { NetConstants } from "../../core/networking/networkDefinitions";
import { CubeKey, WrongFieldType } from "../../core/cube/cubeDefinitions";
import { cciField, cciFieldType } from "./cciField";

import { Buffer } from 'buffer';

export enum cciRelationshipType {
  CONTINUED_IN = 1,
  MENTION = 2,
  REPLY_TO = 3,
  QUOTATION = 4,
  MYPOST = 5,

  // Only used in MUCs:
  PROFILEPIC = 71,
  KEY_BACKUP_CUBE = 72,
  SUBSCRIPTION_RECOMMENDATION_INDEX = 73,

  // Only used in MUC extension cubes:
  SUBSCRIPTION_RECOMMENDATION = 81,
}

export const cciRelationshipLimits: Map<cciRelationshipType, number> = new Map([
  [cciRelationshipType.CONTINUED_IN, 1],
  [cciRelationshipType.MENTION, undefined],
  [cciRelationshipType.REPLY_TO, 1],
  [cciRelationshipType.QUOTATION, undefined],
  [cciRelationshipType.MYPOST, undefined],
  [cciRelationshipType.PROFILEPIC, 1],
  [cciRelationshipType.KEY_BACKUP_CUBE, undefined],
  [cciRelationshipType.SUBSCRIPTION_RECOMMENDATION_INDEX, undefined],
  [cciRelationshipType.SUBSCRIPTION_RECOMMENDATION, undefined]
]);

/**
 * Represents a relationship between two Cubes
 */
export class cciRelationship {
  /** Described the kind of relationship */
  type: cciRelationshipType;
  remoteKey: CubeKey;

  get remoteKeyString(): string {
    if (this.remoteKey === undefined) return "undefined";
    else return this.remoteKey.toString('hex');
  }

  constructor(type: cciRelationshipType = undefined, remoteKey: CubeKey = undefined) {
      this.type = type;
      this.remoteKey = remoteKey;
  }

  static fromField(field: cciField): cciRelationship {
      const relationship = new cciRelationship;
      if (field.type != cciFieldType.RELATES_TO) {
          throw (new WrongFieldType(
              "Can only construct relationship object from RELATES_TO field, " +
              "got " + field.type + "."));
      }
      relationship.type = field.value.readIntBE(0, NetConstants.RELATIONSHIP_TYPE_SIZE);
      relationship.remoteKey = field.value.subarray(
          NetConstants.RELATIONSHIP_TYPE_SIZE,
          NetConstants.RELATIONSHIP_TYPE_SIZE + NetConstants.CUBE_KEY_SIZE);
      return relationship;
  }

  static *fromKeys(
      type: cciRelationshipType,
      keys: Iterable<CubeKey | string>
  ): Generator<cciRelationship> {
    for (let key of keys) {
      // convert any string to binary
      if (!(key instanceof Buffer)) key = Buffer.from(key, 'hex');
      yield new cciRelationship(type, key);
    }
  }
}
