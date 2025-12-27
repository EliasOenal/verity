import { ApiMisuseError, Settings } from "../../core/settings";
import { FieldNumericalParam } from "../../core/fields/fieldParser";

import { FieldType } from "../cube/cube.definitions";
import { VerityField } from "../cube/verityField";

import { Buffer } from 'buffer';
import multiavatar from "@multiavatar/multiavatar";

export const UNKNOWNAVATAR = "unknownuser.svg";
const INVALIDSEED = Buffer.alloc(0);

export enum AvatarScheme {
  MULTIAVATAR = 1,
  UNKNOWN = 99,
}
export const DEFAULT_AVATARSCHEME = AvatarScheme.MULTIAVATAR;

export const AvatarSeedLength: FieldNumericalParam = {
  [AvatarScheme.MULTIAVATAR]: 5,
}

export interface AvatarSeed {
  scheme: AvatarScheme,
  seed: Buffer,
}

export class Avatar {
  private _seed: Buffer = INVALIDSEED
  scheme: AvatarScheme = AvatarScheme.UNKNOWN;

  /**
   * Create a new random avatar.
   * Scheme can be specified if required; otherwise any available scheme may be
   * used. (Current implementation defaults to multiavatar.)
   **/
  constructor(createRandom: true, scheme?: AvatarScheme);

  /**
   * Reconstruct an existing avatar based on a known seed.
   * scheme must always be specified as it's not encoded within the seed.
   */
  constructor(seed: Buffer | string, scheme: AvatarScheme);

  /**
   * Reconstruct an existing avatar based on an avatar CCI field.
   * (This usually means: Show me another user's avatar.)
   */
  constructor(field: VerityField);

  /** Create an invalid Avatar object representing an unknown avatar. */
  constructor();

  constructor(
      multiParam: Buffer | string | boolean | VerityField = undefined,
      scheme: AvatarScheme = undefined
  ){
    if (multiParam === undefined || multiParam === "") {
      this.scheme = AvatarScheme.UNKNOWN;
      this._seed = INVALIDSEED;
    }
    else if (multiParam === true) {  // create random avatar
      this.random(scheme);
    } else if (multiParam instanceof VerityField) {
      this.fromField(multiParam);
    } else {  // re-create deterministic avatar based on specific seed
      this.scheme = scheme;  // set scheme first to enable auto-truncate
      this.seed = multiParam as string|Buffer;
    }
  }

  get seed(): Buffer { return this._seed }
  set seed(val: string | Buffer) {
    if (!(val instanceof Buffer)) {
      const valbuf = Buffer.from(val as string, 'hex');
      if (Settings.RUNTIME_ASSERTIONS) {
        if (valbuf.toString('hex') != val) {
          throw new ApiMisuseError("Avatar: Seed must be Buffer or hex string");
        }
        this._seed = valbuf;
      }
    }
    else if (this.scheme && AvatarSeedLength[this.scheme] && val.length > AvatarSeedLength[this.scheme]) {
      val = val.subarray(0, AvatarSeedLength[this.scheme]);
      this._seed = val;
    }
    else {
      this._seed = val;
    }
  }
  get seedString(): string {
    const str = this._seed.toString('hex');
    return str;
  }

  equals(other: Avatar): boolean {
    if (this.scheme === AvatarScheme.UNKNOWN && other.scheme === AvatarScheme.UNKNOWN) return true;
    else if (this.scheme === other.scheme && this.seed.equals(other.seed)) return true;
    else return false;
  }

  render(): string {
    if (this.scheme === AvatarScheme.MULTIAVATAR) {
      const avatar: string = multiavatar(this.seedString);
      const marshalled = "data:image/svg+xml;base64," + btoa(avatar);
      return marshalled;
    }
    else return UNKNOWNAVATAR;  // unknown avatar scheme
  }

  /** Replaces this avatar by a random new one */
  random(scheme: AvatarScheme = undefined): void {
    if (scheme === undefined) scheme = AvatarScheme.MULTIAVATAR;
    this.scheme = scheme;
    if (this.scheme === AvatarScheme.MULTIAVATAR) {
      this._seed = Buffer.alloc(AvatarSeedLength[AvatarScheme.MULTIAVATAR]);
      for (let i=0; i<this._seed.length; i++) {
        this._seed[i] = Math.floor(Math.random()*255);
      }
    } else {
      this._seed = INVALIDSEED;
      this.scheme = AvatarScheme.UNKNOWN;
    }
  }

  /** Replaces this avatar by the one described in the supplied AVATAR cciField */
  fromField(field: VerityField) {
    if (field.type != FieldType.AVATAR) {
      throw new ApiMisuseError("Avatar: Cannot reconstruct avatar from non-avatar field");
    }
    const avatarScheme: AvatarScheme = field.value.readUint8();
    if (avatarScheme in AvatarScheme) {  // valid avatar scheme?
      this.scheme = avatarScheme;
      this._seed = field.value.subarray(1, 1+AvatarSeedLength[avatarScheme]);
    } else {  // unknown or invalid
      this.scheme = AvatarScheme.UNKNOWN;
      this._seed = INVALIDSEED;
    }
  }

  toField(): VerityField {
    if (this.scheme === AvatarScheme.UNKNOWN) return undefined;
    const length = AvatarSeedLength[this.scheme] + 1;  // 1: scheme field
    const val: Buffer = Buffer.alloc(length, 0);
    val.writeUInt8(this.scheme);
    val.set(this._seed, 1);
    return new VerityField(FieldType.AVATAR, val);
  }
}
