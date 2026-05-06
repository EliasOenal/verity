import type { CoreVeritable } from "../../core/cube/coreVeritable.definition";
import type { RelationshipType, Relationship } from "./relationship";

export interface Veritable extends CoreVeritable {
  getRelationships(type?: RelationshipType): Relationship[];

  getFirstRelationship(type?: number): Relationship;
}
