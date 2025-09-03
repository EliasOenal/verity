import { NetConstants } from "../networking/networkDefinitions";
import { Cube } from "./cube";
import { CubeType, CubeFieldType, CubeError, NotificationKey, CubeKey } from "./cube.definitions";
import { CubeStore } from "./cubeStore";
import { logger } from "../logger";
import { Sublevels } from "./levelBackend";

export async function autoIncrementPmuc(cube: Cube, store: CubeStore): Promise<void> {
  // If this is a PMUC and the PMUC_UPDATE_COUNT field has not been set
  // manually, attempt to auto-increment it.
  // TODO: Only auto-increment if this version actually differs from
  //   the latest one in store
  if (cube.cubeType === CubeType.PMUC || cube.cubeType === CubeType.PMUC_NOTIFY) {
    // sanity check: Is this a valid PMUC with a PMUC_UPDATE_COUNT field?
    const countField = cube.getFirstField(CubeFieldType.PMUC_UPDATE_COUNT);
    if (countField === undefined) {
      throw new CubeError(`cubeStoreUtil.autoIncrementPmuc(): Cannot auto-increment counter on invalid ${CubeType[cube.cubeType] ?? cube.cubeType} ${cube.getKeyStringIfAvailable() ?? 'with unknown key'} as it does not have a PMUC_UPDATE_COUNT field.`);
    }

    // Only auto-increment if version is still at the default of 0
    if (countField.value.readUIntBE(0, NetConstants.PMUC_UPDATE_COUNT_SIZE) === 0) {
      // sanity check: We can only increment the counter if we have the private key
      if (!cube.privateKey) {
        logger.warn(`CubeStoreUtil.autoIncrementPmuc(): Cannot auto-increment counter on ${CubeType[cube.cubeType] ?? cube.cubeType} ${cube.getKeyStringIfAvailable()} as we do not have the private key.`);
        return;
      }
      // Fetch latest version from store
      const latestVersion = await store.getCube(cube.getKeyIfAvailable());
      const latestCount: number =
        latestVersion?.getFirstField?.(
          CubeFieldType.PMUC_UPDATE_COUNT)?.value?.readUIntBE?.(
          0, NetConstants.PMUC_UPDATE_COUNT_SIZE)
        ?? 0;  // default to 0 if no old version (or old version has no counter)

      // Auto-increment the count
      const newCount = latestCount + 1;
      countField.value.writeUIntBE(newCount, 0, NetConstants.PMUC_UPDATE_COUNT_SIZE);
      cube.cubeManipulated();  // Cube requires recompilation
    }
  }
}

/**
 * Calculates the database key on the notifications sublevels
 * for a given (notification) Cube.
 * This is done by concatenating first the notification (recipient) key,
 * then either the timestamp or difficulty based on the sublevel,
 * and finally the Cube key.
 **/
async function getNotificationKey(
    sublevel: Sublevels,
    param1: Cube|NotificationKey,
    middleParam?: number|Buffer,
    cubeKey?: CubeKey
): Promise<Buffer> {
    let recipient: Buffer;
    let middlePart: Buffer;

    const middlePartSize = (sublevel === Sublevels.INDEX_TIME) ? NetConstants.TIMESTAMP_SIZE : 1;
    const functionName = (sublevel === Sublevels.INDEX_TIME) ? 'getNotificationDateKey' : 'getNotificationDifficultyKey';

    if (param1 instanceof Cube) {
        recipient = param1.getFirstField(CubeFieldType.NOTIFY)?.value;
        cubeKey = await param1.getKey();
        if (sublevel === Sublevels.INDEX_TIME) {
            middlePart = param1.getFirstField(CubeFieldType.DATE)?.value;
        }
        else { // ByDifficulty
            const difficulty = param1.getDifficulty();
            middlePart = Buffer.alloc(1);
            middlePart.writeUInt8(difficulty);
        }
    } else {
        recipient = param1;
        if (Buffer.isBuffer(middleParam)) {
            middlePart = middleParam;
        }
        else if (sublevel === Sublevels.INDEX_TIME) {
            middlePart = Buffer.alloc(NetConstants.TIMESTAMP_SIZE);
            middlePart.writeUIntBE(middleParam as number, 0, NetConstants.TIMESTAMP_SIZE);
        }
        else { // ByDifficulty
            middlePart = Buffer.alloc(1);
            middlePart.writeUInt8(middleParam as number);
        }
    }

    if (
        recipient?.length !== NetConstants.NOTIFY_SIZE ||
        middlePart?.length !== middlePartSize ||
        cubeKey?.length !== NetConstants.CUBE_KEY_SIZE
    ) {
        logger.info(`cubeStoreUtil.${functionName}(): Invalid input; returning undefined.`);
        return undefined;
    }

    return Buffer.concat([recipient, middlePart, cubeKey]);
}

/**
 * Calculates the database key on the notifications-by-date sublevel
 * for a given (notification) Cube.
 * This is done by concatenating the notification (recipient) key, timestamp,
 * and cube key.
 **/
export async function getNotificationDateKey(cube: Cube): Promise<Buffer>;
export async function getNotificationDateKey(recipient: NotificationKey, timestamp: number|Buffer, cubeKey: CubeKey): Promise<Buffer>;

export async function getNotificationDateKey(param1: Cube|NotificationKey, timestamp?: number|Buffer, cubeKey?: CubeKey): Promise<Buffer> {
  return getNotificationKey(Sublevels.INDEX_TIME, param1, timestamp, cubeKey);
}

/**
 * Calculates the database key on the notifications-by-difficulty sublevel
 * for a given (notification) Cube.
 * This is done by concatenating the notification (recipient) key, difficulty,
 * and cube key.
 **/
export async function getNotificationDifficultyKey(cube: Cube): Promise<Buffer>;
export async function getNotificationDifficultyKey(recipient: NotificationKey, difficulty: number|Buffer, cubeKey: CubeKey): Promise<Buffer>;

export async function getNotificationDifficultyKey(param1: Cube|NotificationKey, difficulty?: number|Buffer, cubeKey?: CubeKey): Promise<Buffer> {
  return getNotificationKey(Sublevels.INDEX_DIFF, param1, difficulty, cubeKey);
}
