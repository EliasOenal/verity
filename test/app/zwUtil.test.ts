import { Cube } from "../../src/core/cube/cube";
import { cciField } from "../../src/cci/cube/cciField";
import { NetConstants } from "../../src/core/networking/networkDefinitions";

import { cciFieldType } from "../../src/cci/cube/cciCube.definitions";
import { cciCube } from "../../src/cci/cube/cciCube";
import { cciRelationshipType } from "../../src/cci/cube/cciRelationship";

import { makePost, assertZwCube } from "../../src/app/zw/model/zwUtil";

import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

describe('makePost function', () => {
  it('should create a basic post', async () => {
    const text = 'Habeo res importantes dicere';
    const post: cciCube = await makePost(text);
    expect(post).toBeInstanceOf(Cube);
    expect(assertZwCube(post)).toBe(true);
    expect(post.getFirstField(cciFieldType.PAYLOAD).value.toString('utf8')).
      toEqual(text);
  });

  it('should create a reply post', async () => {
    const text = "Habeo res importantiores dicere quam meus praecessor";
    const post: cciCube = await makePost(text, Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(42));
    expect(post).toBeInstanceOf(Cube);
    expect(assertZwCube(post)).toBe(true);
    expect(post.getFirstField(cciFieldType.PAYLOAD).value.toString('utf8')).
      toEqual(text);
    expect(post.fields.getFirstRelationship(cciRelationshipType.REPLY_TO).remoteKey).
      toEqual(Buffer.alloc(NetConstants.CUBE_KEY_SIZE).fill(42));
  });

  it('should throw when trying to create an overly large post', () => {
    const text = 'Gallia est omnis divisa in partes tres, quarum unam incolunt Belgae, aliam Aquitani, tertiam qui ipsorum lingua Celtae, nostra Galli appellantur. Hi omnes lingua, institutis, legibus inter se differunt. Gallos ab Aquitanis Garumna flumen, a Belgis Matrona et Sequana dividit. Horum omnium fortissimi sunt Belgae, propterea quod a cultu atque humanitate provinciae longissime absunt, minimeque ad eos mercatores saepe commeant atque ea quae ad effeminandos animos pertinent important, proximique sunt Germanis, qui trans Rhenum incolunt, quibuscum continenter bellum gerunt. Qua de causa Helvetii quoque reliquos Gallos virtute praecedunt, quod fere cotidianis proeliis cum Germanis contendunt, cum aut suis finibus eos prohibent aut ipsi in eorum finibus bellum gerunt. Eorum una pars, quam Gallos obtinere dictum est, initium capit a flumine Rhodano, continetur Garumna flumine, Oceano, finibus Belgarum, attingit etiam ab Sequanis et Helvetiis flumen Rhenum, vergit ad septentriones. Belgae ab extremis Galliae finibus oriuntur, pertinent ad inferiorem partem fluminis Rheni, spectant in septentrionem et orientem solem. Aquitania a Garumna flumine ad Pyrenaeos montes et eam partem Oceani quae est ad Hispaniam pertinet; spectat inter occasum solis et septentriones. Apud Helvetios longe nobilissimus fuit et ditissimus Orgetorix. Is M. Messala, [et P.] M. Pisone consulibus regni cupiditate inductus coniurationem nobilitatis fecit et civitati persuasit ut de finibus suis cum omnibus copiis exirent: perfacile esse, cum virtute omnibus praestarent, totius Galliae imperio potiri. Id hoc facilius iis persuasit, quod undique loci natura Helvetii continentur: una ex parte flumine Rheno latissimo atque altissimo, qui agrum Helvetium a Germanis dividit; altera ex parte monte Iura altissimo, qui est inter Sequanos et Helvetios; tertia lacu Lemanno et flumine Rhodano, qui provinciam nostram ab Helvetiis dividit. His rebus fiebat ut et minus late vagarentur et minus facile finitimis bellum inferre possent; qua ex parte homines bellandi cupidi magno dolore adficiebantur. Pro multitudine autem hominum et pro gloria belli atque fortitudinis angustos se fines habere arbitrabantur, qui in longitudinem milia passuum CCXL, in latitudinem CLXXX patebant.';
    expect(async () => { await makePost(text) }).rejects.toThrow();
  });

  it.todo('should create a post with replyto and id');
});

describe('assertZwCube function', () => {
  it('should return true for a valid ZW cube', () => {
    const validCube: Cube = cciCube.Frozen({ fields: [
      cciField.Application("ZW"),
      cciField.Payload('Habeo res importantes dicere'),
    ]});
    expect(assertZwCube(validCube)).toBe(true);
  });

  it('should return false for a cube without an application field', () => {
    const invalidCube: Cube = cciCube.Frozen({ fields: [
      cciField.Payload('Habeo res importantes dicere'),
    ]});
    expect(assertZwCube(invalidCube)).toBe(false);
  });

  it('should return false for a cube with an application field not equal to ZW', () => {
    const invalidCube: Cube = cciCube.Frozen({ fields: [
      cciField.Application("Applicatio latina"),
      cciField.Payload('Habeo res importantes dicere'),
    ]});
    expect(assertZwCube(invalidCube)).toBe(false);
  });
});

describe.skip('assertZwMuc function', () => {
  // TODO write tests
});
