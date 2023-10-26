import { Cube } from "../../src/core/cube/cube";
import { CubeField, CubeFields, CubeRelationship, CubeRelationshipType } from "../../src/core/cube/cubeFields";

describe('fields', () => {
  it('correctly sets and retrieves a reply_to relationship field', async () => {
    const root: Cube = new Cube(); // will only be used as referenc
    const payloadfield: CubeField = CubeField.Payload(Buffer.alloc(200));
    root.setFields(payloadfield);

    const leaf: Cube = new Cube();

    leaf.setFields(new CubeFields([
      payloadfield,
      CubeField.RelatesTo(new CubeRelationship(
        CubeRelationshipType.REPLY_TO, (await root.getKey())))
    ]));

    const retrievedRel: CubeRelationship = leaf.getFields().getFirstRelationship();
    expect(retrievedRel.type).toEqual(CubeRelationshipType.REPLY_TO);
    expect(retrievedRel.remoteKey.toString('hex')).toEqual((await root.getKey()).toString('hex'));
  }, 3000);
});
