import { FieldParser } from "../../src/model/fieldParser";
import { Relationship, CubeField, CubeFieldType, CubeFields, CubeRelationshipType } from "../../src/model/fields";
import { NetConstants } from "../../src/model/networkDefinitions";
import { ZwField, ZwFieldType, ZwFields, ZwRelationshipType, zwFieldDefinition } from '../../src/viewmodel/zwFields';

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
        new Relationship(CubeRelationshipType.CONTINUED_IN,
        new Buffer(NetConstants.CUBE_KEY_SIZE).fill(0xDA))
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
    const restoredrel = Relationship.fromField(restored.getFirstField(CubeFieldType.RELATES_TO));
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
        new Relationship(ZwRelationshipType.MYPOST,
        new Buffer(NetConstants.CUBE_KEY_SIZE).fill(0xDA))
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
    const restoredrel = Relationship.fromField(restored.getFirstField(ZwFieldType.RELATES_TO), zwFieldDefinition);
    expect(restoredrel.type).toEqual(ZwRelationshipType.MYPOST);
    expect(restoredrel.remoteKey[0]).toEqual(0xDA);
  });

});