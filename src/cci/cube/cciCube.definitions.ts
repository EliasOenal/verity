import { CubeFieldType, CubeFieldLength } from "../../core/cube/cube.definitions";
import { FieldNumericalParam } from "../../core/fields/fieldParser";
import { NetConstants } from "../../core/networking/networkDefinitions";

/**
 * cciAdditionalFieldType contains the field types defined on the CCI layer,
 * which supplement the CoreFieldTypes.
 * For three CCI field types -- PAYLAOD, CCI_END and PADDING -- this
 * implementation improperly defines them in the core layer instead, as they
 * are used in core layer unit tests and in padding up "core" Cubes.
 **/
export enum cciAdditionalFieldType {
  CCI_END = 0x00 << 2,       // 0
  APPLICATION = 0x01 << 2,   // 4

  /**
  * Seed used to derive a new key pair for an extension MUC.
  * Note that this should not actually be public information as it's only needed
  * by the author to derive their private key from their master key.
  * We're still putting it right into the MUC out of convenience and due to
  * the fact that this information must be available somewhere on the network
  * for Identity recovery ("password-based login").
  * We're pretty confident this does not actually expose any cryptographically
  * sensitive information, but we maybe should encrypt it.
  */
  SUBKEY_SEED = 0x03 << 2,   // 12

  PAYLOAD = 0x10 << 2,       // 64
  CONTENTNAME = 0x11 << 2,   // 68
  DESCRIPTION = 0x12 << 2,   // 72
  RELATES_TO = 0x13 << 2,    // 76
  USERNAME = 0x14 << 2,      // 80
  MEDIA_TYPE = 0x15 << 2,    // 84
  AVATAR = 0x16 << 2,        // 88
  PADDING = 0x1F << 2,       // 124 -- currently defined on core layer

  // Reserved space from 0x20 to 0x2F, may either be used for future CCI fields
  // or to extend the custom field range in the future.

  CUSTOM1 = 0x30 << 2,      // 192
  CUSTOM2 = 0x31 << 2,      // 196
  CUSTOM3 = 0x32 << 2,      // 200
  CUSTOM4 = 0x33 << 2,      // 204
  CUSTOM5 = 0x34 << 2,      // 208
  CUSTOM6 = 0x35 << 2,      // 212
  CUSTOM7 = 0x36 << 2,      // 216
  CUSTOM8 = 0x37 << 2,      // 220
  CUSTOM9 = 0x38 << 2,      // 224
  CUSTOM10 = 0x39 << 2,      // 228
  CUSTOM11 = 0x3A << 2,      // 232
  CUSTOM12 = 0x3B << 2,      // 236
  CUSTOM13 = 0x3C << 2,      // 240
  CUSTOM14 = 0x3D << 2,      // 244
  CUSTOM15 = 0x3E << 2,      // 248
  CUSTOM16 = 0x3F << 2,      // 252

  REMAINDER = 40001,         // virtual field only used on decompiling Cubes
                             // to represent data after CCI_END
}
export const cciFieldType = {...CubeFieldType, ...cciAdditionalFieldType} as const;

export const cciAdditionalFieldLength: FieldNumericalParam = {
  [cciFieldType.CCI_END]: 0,
  [cciFieldType.CONTENTNAME]: undefined,
  [cciFieldType.DESCRIPTION]: undefined,
  [cciFieldType.SUBKEY_SEED]: undefined,
  [cciFieldType.PAYLOAD]: undefined,
  [cciFieldType.AVATAR]: undefined,
  [cciFieldType.APPLICATION]: undefined,
  [cciFieldType.MEDIA_TYPE]: 1,
  [cciFieldType.RELATES_TO]: NetConstants.RELATIONSHIP_TYPE_SIZE + NetConstants.CUBE_KEY_SIZE,
  [cciFieldType.USERNAME]: undefined,
  [cciFieldType.PADDING]: undefined,
  [cciFieldType.CUSTOM1]: undefined,
  [cciFieldType.CUSTOM2]: undefined,
  [cciFieldType.CUSTOM3]: undefined,
  [cciFieldType.CUSTOM4]: undefined,
  [cciFieldType.CUSTOM5]: undefined,
  [cciFieldType.CUSTOM6]: undefined,
  [cciFieldType.CUSTOM7]: undefined,
  [cciFieldType.CUSTOM8]: undefined,
  [cciFieldType.CUSTOM9]: undefined,
  [cciFieldType.CUSTOM10]: undefined,
  [cciFieldType.CUSTOM11]: undefined,
  [cciFieldType.CUSTOM12]: undefined,
  [cciFieldType.CUSTOM13]: undefined,
  [cciFieldType.CUSTOM14]: undefined,
  [cciFieldType.CUSTOM15]: undefined,
  [cciFieldType.CUSTOM16]: undefined,
  [cciFieldType.REMAINDER]: undefined,
}
export const cciFieldLength = {...CubeFieldLength, ...cciAdditionalFieldLength};


export enum MediaTypes {
  TEXT = 1,  // may contain markdown
  JPEG = 2,
  RESERVED = 255,  // may be used for an extension header
}
