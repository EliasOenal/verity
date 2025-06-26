import { NetConstants } from "../../core/networking/networkDefinitions";
import { CubeKey } from "../../core/cube/cube.definitions";
import { asCubeKey } from "../../core/cube/keyUtil";

import { FieldType } from "./cciCube.definitions";
import { VerityField } from "./verityField";

import { logger } from "../../core/logger";

export enum RelationshipType {
  CONTINUED_IN = 1,
  // unused = 2,
  REPLY_TO = 3,
  QUOTATION = 4,
  MYPOST = 5,
  MENTION = 6,

  REPLACED_BY = 11,
  INTERPRETS = 12,

  // Only used in MUCs:
  ILLUSTRATION = 71,
  KEY_BACKUP_CUBE = 72,
  SUBSCRIPTION_RECOMMENDATION_INDEX = 73,

  // Only used in MUC extension cubes:
  SUBSCRIPTION_RECOMMENDATION = 81,

  // codes 128 and above are reserved for app-specific usage
}

export const RelationshipLimits: Map<RelationshipType, number> = new Map([
  [RelationshipType.CONTINUED_IN, 1],
  [RelationshipType.MENTION, undefined],
  [RelationshipType.REPLY_TO, 1],
  [RelationshipType.QUOTATION, undefined],
  [RelationshipType.MYPOST, undefined],
  [RelationshipType.ILLUSTRATION, 1],
  [RelationshipType.KEY_BACKUP_CUBE, undefined],
  [RelationshipType.SUBSCRIPTION_RECOMMENDATION_INDEX, undefined],
  [RelationshipType.SUBSCRIPTION_RECOMMENDATION, undefined]
]);

/**
 * Represents a relationship between two Cubes
 */
export class Relationship {
  /** Described the kind of relationship */
  type: RelationshipType;
  remoteKey: CubeKey;

  get remoteKeyString(): string {
    if (this.remoteKey === undefined) return "undefined";
    else return this.remoteKey.toString('hex');
  }

  constructor(type: RelationshipType = undefined, remoteKey: CubeKey = undefined) {
      this.type = type;
      this.remoteKey = remoteKey;
  }

  toString(): string {
    return `${RelationshipType[this.type] ?? this.type} rel to ${this.remoteKeyString}`;
  }

  static fromField(field: VerityField): Relationship {
      const relationship = new Relationship();
      if (field.type !== FieldType.RELATES_TO) {
        logger.error(`cciRelationship.fromField(): Can only construct relationship object from RELATES_TO field, got ${field.type}; returning undefined instead.`);
        return undefined;
      }
      // sanity-check field size
      if (field.length <
          NetConstants.RELATIONSHIP_TYPE_SIZE + NetConstants.CUBE_KEY_SIZE) {
        logger.error(`cciRelationship.fromField(): Supplies RELATES_TO field is invalid as it is just ${field.length} bytes long, must be ${NetConstants.RELATIONSHIP_TYPE_SIZE + NetConstants.CUBE_KEY_SIZE}; returning undefined instead.`);
        return undefined;
      }
      relationship.type = field.value.readUIntBE(0, NetConstants.RELATIONSHIP_TYPE_SIZE);
      relationship.remoteKey = asCubeKey(field.value.subarray(
          NetConstants.RELATIONSHIP_TYPE_SIZE,
          NetConstants.RELATIONSHIP_TYPE_SIZE + NetConstants.CUBE_KEY_SIZE));
      return relationship;
  }

  static *fromKeys(
      type: RelationshipType,
      keys: Iterable<CubeKey | string>
  ): Generator<Relationship> {
    for (let key of keys) {
      yield new Relationship(type, asCubeKey(key));
    }
  }
}
