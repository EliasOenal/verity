import { FieldParser } from "../../src/core/fieldParser";
import { CubeField, CubeFieldType, CubeFields, CubeRelationshipType, CubeRelationship } from "../../src/core/cubeFields";
import { NetConstants } from "../../src/core/networkDefinitions";
import { ZwField, ZwFieldType, ZwFields, ZwRelationship, ZwRelationshipType, zwFieldDefinition } from '../../src/app/zwFields';

describe('fieldParser', () => {
  it('should correctly compile and decompile top level fields', () => {
    const fieldParser: FieldParser = FieldParser.toplevel;
    const fields = new CubeFields();

    // define a few fields
    fields.data.push(
      CubeField.Payload("Mein kleiner grüner Kaktus")
    );
    fields.data.push(
      CubeField.RelatesTo(
        new CubeRelationship(CubeRelationshipType.CONTINUED_IN,
        Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(0xDA))
      )
    );
    fields.data.push(
      CubeField.Payload("steht draußen am Balkon")
    );

    // compile and decompile
    const compiled: Buffer = fieldParser.compileFields(fields);
    const restoredarray: Array<CubeField> = fieldParser.decompileFields(compiled);
    const restored: CubeFields = new CubeFields(restoredarray);

    // compare
    expect(restored.data.length).toEqual(3);
    expect(restored.getFieldsByType(CubeFieldType.PAYLOAD).length).toEqual(2);
    expect(restored.getFieldsByType(CubeFieldType.RELATES_TO).length).toEqual(1);
    expect(
      restored.getFirstField(CubeFieldType.PAYLOAD).value.toString('utf-8')).
      toEqual("Mein kleiner grüner Kaktus");
    const restoredrel = CubeRelationship.fromField(restored.getFirstField(CubeFieldType.RELATES_TO));
    expect(restoredrel.type).toEqual(CubeRelationshipType.CONTINUED_IN);
    expect(restoredrel.remoteKey[0]).toEqual(0xDA);
  });


  it('should correctly compile and decompile ZW fields', () => {
    const fieldParser: FieldParser = new FieldParser(zwFieldDefinition);
    const fields = new ZwFields();

    // define a few fields
    fields.data.push(
      ZwField.Payload("Mein kleiner grüner Kaktus")
    );
    fields.data.push(
      ZwField.RelatesTo(
        new CubeRelationship(ZwRelationshipType.MYPOST,
        Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(0xDA))
      )
    );
    fields.data.push(
      ZwField.Payload("steht draußen am Balkon")
    );

    // compile and decompile
    const compiled: Buffer = fieldParser.compileFields(fields);
    const restoredarray: Array<ZwField> = fieldParser.decompileFields(compiled);
    const restored: ZwFields = new ZwFields(restoredarray);

    // compare
    expect(restored.data.length).toEqual(3);
    expect(restored.getFieldsByType(ZwFieldType.PAYLOAD).length).toEqual(2);
    expect(restored.getFieldsByType(ZwFieldType.RELATES_TO).length).toEqual(1);
    expect(
      restored.getFirstField(ZwFieldType.PAYLOAD).value.toString('utf-8')).
      toEqual("Mein kleiner grüner Kaktus");
    const restoredrel = ZwRelationship.fromField(restored.getFirstField(ZwFieldType.RELATES_TO));
    expect(restoredrel.type).toEqual(ZwRelationshipType.MYPOST);
    expect(restoredrel.remoteKey[0]).toEqual(0xDA);
  });

});