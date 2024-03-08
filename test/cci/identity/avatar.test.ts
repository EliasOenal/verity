import { cciField, cciFieldType } from "../../../src/cci/cube/cciFields";
import { Avatar, AvatarScheme, AvatarSeedLength, UNKNOWNAVATAR } from "../../../src/cci/identity/avatar";
import { ApiMisuseError } from "../../../src/core/settings";

describe('Avatar class', () => {
  describe('Constructor', () => {
    it('Should create a random avatar when called with "true"', () => {
      const avatar = new Avatar(true);
      expect(avatar.scheme).toBe(AvatarScheme.MULTIAVATAR);
      expect(avatar.seed.length).toBe(AvatarSeedLength[AvatarScheme.MULTIAVATAR]);
    });

    it('Should create a random avatar with specified scheme when called with "true" and a scheme', () => {
      const avatar = new Avatar(true, AvatarScheme.MULTIAVATAR);
      expect(avatar.scheme).toBe(AvatarScheme.MULTIAVATAR);
      expect(avatar.seed.length).toBe(AvatarSeedLength[AvatarScheme.MULTIAVATAR]);
    });

    it('Should create an avatar from a seed when called with a Buffer and scheme', () => {
      const seed = Buffer.from('11223344', 'hex');
      const avatar = new Avatar(seed, AvatarScheme.MULTIAVATAR);
      expect(avatar.scheme).toBe(AvatarScheme.MULTIAVATAR);
      expect(avatar.seed).toEqual(seed);
    });

    it('Should create an avatar from a string seed when called with a string and scheme', () => {
      const avatar = new Avatar("00112233", AvatarScheme.MULTIAVATAR);
      expect(avatar.scheme).toBe(AvatarScheme.MULTIAVATAR);
      expect(avatar.seedString).toEqual("00112233");
    });

    it('Should create an avatar from a cciField', () => {
      const field = new cciField(cciFieldType.AVATAR, Buffer.from('01aabbcc', 'hex'));
      const avatar = new Avatar(field);
      expect(avatar.scheme).toBe(AvatarScheme.MULTIAVATAR);
      expect(avatar.seed.toString('hex')).toEqual('aabbcc');
    });

    it('Should create an unknown avatar when called without parameters', () => {
      const avatar = new Avatar();
      expect(avatar.scheme).toBe(AvatarScheme.UNKNOWN);
      expect(avatar.seedString).toEqual('');
    });

    it('Should throw ApiMisuseError when trying to create an avatar from a non-avatar cciField', () => {
      const field = new cciField(cciFieldType.PAYLOAD, Buffer.from('abc', 'ascii'));
      expect(() => new Avatar(field)).toThrow(ApiMisuseError);
    });
  });

  describe('equals method', () => {
    it('Should return true for two unknown avatars', () => {
      const avatar1 = new Avatar();
      const avatar2 = new Avatar();
      expect(avatar1.equals(avatar2)).toBe(true);
    });

    it('Should return true for two avatars with the same scheme and seed', () => {
      const avatar1 = new Avatar("0011223344", AvatarScheme.MULTIAVATAR);
      const avatar2 = new Avatar("0011223344", AvatarScheme.MULTIAVATAR);
      expect(avatar1.equals(avatar2)).toBe(true);
    });

    it('Should return false for two avatars with different schemes', () => {
      const avatar1 = new Avatar("0011223344", AvatarScheme.MULTIAVATAR);
      const avatar2 = new Avatar("0011223344", AvatarScheme.UNKNOWN);
      expect(avatar1.equals(avatar2)).toBe(false);
    });

    it('Should return false for two avatars with the same scheme but different seeds', () => {
      const avatar1 = new Avatar(Buffer.from("001122", 'hex'), AvatarScheme.MULTIAVATAR);
      const avatar2 = new Avatar(Buffer.from("334455", 'hex'), AvatarScheme.MULTIAVATAR);
      expect(avatar1.equals(avatar2)).toBe(false);
    });
  });

  describe('Render method', () => {
    it('Should return unknown avatar when scheme is UNKNOWN', () => {
      const avatar = new Avatar();
      expect(avatar.render()).toBe(UNKNOWNAVATAR);
    });

    it('Should return multiavatar when scheme is MULTIAVATAR', () => {
      const avatar = new Avatar(true);
      const renderedAvatar = avatar.render();
      expect(renderedAvatar).toMatch(/^data:image\/svg\+xml;base64,/);
    });
  });

  describe('Random method', () => {
    it('Should replace avatar with a new random one', () => {
      const avatar = new Avatar(true);
      const originalSeed = avatar.seed.toString('hex');
      avatar.random();
      expect(avatar.seed.toString('hex')).not.toBe(originalSeed);
    });

    it('Should create a random avatar when random method is called with a specified scheme', () => {
      const avatar = new Avatar();
      avatar.random(AvatarScheme.MULTIAVATAR);
      expect(avatar.scheme).toBe(AvatarScheme.MULTIAVATAR);
      expect(avatar.seed.length).toBe(AvatarSeedLength[AvatarScheme.MULTIAVATAR]);
    });

    it('Should create an unknown avatar when random method is called with an unknown scheme', () => {
      const avatar = new Avatar();
      avatar.random(999 as AvatarScheme); // Unknown scheme
      expect(avatar.scheme).toBe(AvatarScheme.UNKNOWN);
      expect(avatar.seedString).toEqual('');
    });
  });

  describe('FromField method', () => {
    it('Should throw ApiMisuseError when trying to reconstruct from non-avatar field', () => {
      const field = new cciField(cciFieldType.PAYLOAD, Buffer.from('abc'));
      const avatar = new Avatar();
      expect(() => avatar.fromField(field)).toThrow(ApiMisuseError);
    });

    it('Should reconstruct avatar from valid avatar cciField', () => {
      const field = new cciField(cciFieldType.AVATAR, Buffer.from('01aabbcc', 'hex'));
      const avatar = new Avatar();
      avatar.fromField(field);
      expect(avatar.scheme).toBe(AvatarScheme.MULTIAVATAR);
      expect(avatar.seed.toString('hex')).toEqual('aabbcc');
    });
  });

  describe('ToField method', () => {
    it('Should return undefined when scheme is UNKNOWN', () => {
      const avatar = new Avatar();
      const field = avatar.toField();
      expect(field).toBeUndefined();
    });

    it('Should return cciField when scheme is MULTIAVATAR', () => {
      const avatar = new Avatar(true);
      const field = avatar.toField();
      expect(field.type).toBe(cciFieldType.AVATAR);
      expect(field.length).toBe(6); // 1 (scheme) + 5 (seed)
      expect(field.value[0]).toEqual(AvatarScheme.MULTIAVATAR);  // scheme
    });

    it('Should return undefined when toField method is called with UNKNOWN scheme', () => {
      const avatar = new Avatar();
      const field = avatar.toField();
      expect(field).toBeUndefined();
    });

    it('Should ensure seed has the correct length', () => {
      const avatar = new Avatar(true); // Creating an avatar with a random seed
      const field = avatar.toField();
      if (field) {
        const expectedLength = AvatarSeedLength[avatar.scheme] + 1;
        expect(field.length).toBe(expectedLength);
        expect(field.value.length).toBe(expectedLength);
      } else {
        fail('Unexpected undefined value for cciField.');
      }
    });
  });

  describe('seed handling', () => {
    it('Should return an empty string in seedString method when seed is undefined', () => {
      const avatar = new Avatar(); // Creating an avatar with undefined seed
      expect(avatar.seedString).toBe('');
    });

    it('does not accept non-hex strings as seeds', () => {
      expect(() => new Avatar("Hello world", AvatarScheme.MULTIAVATAR)).toThrow(ApiMisuseError);
    });

    it('should truncate this.seed on setting if required', () => {
      const maxLength = AvatarSeedLength[AvatarScheme.MULTIAVATAR]; // Assuming a maximum length for the seed
      const longSeed = Buffer.from('Hic semen nimis longum est', 'ascii');
      const avatar = new Avatar();
      avatar.scheme = AvatarScheme.MULTIAVATAR;
      avatar.seed = longSeed;

      const expectedTruncatedSeed = longSeed.subarray(0, maxLength);
      expect(avatar.seed.equals(expectedTruncatedSeed)).toBeTruthy();
    });
  })
});
