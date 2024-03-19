import { Cube } from "./cube"
import { FieldParserTable, coreFieldParsers, coreTlvFieldParsers } from "./cubeFields"

export interface CubeFamilyDefinition {
  cubeClass: typeof Cube,
  parsers: FieldParserTable,
}
