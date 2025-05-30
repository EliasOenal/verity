import { NetConstants } from "../networking/networkDefinitions";
import { Cube } from "./cube";
import { CubeType, CubeFieldType, CubeError } from "./cube.definitions";
import { CubeStore } from "./cubeStore";
import { logger } from "../logger";

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
