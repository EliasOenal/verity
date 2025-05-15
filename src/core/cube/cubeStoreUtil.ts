import { NetConstants } from "../networking/networkDefinitions";
import { Cube } from "./cube";
import { CubeType, CubeFieldType } from "./cube.definitions";
import { CubeStore } from "./cubeStore";

export async function autoIncrementPmuc(cube: Cube, store: CubeStore): Promise<void> {
  // If this is a PMUC and the PMUC_UPDATE_COUNT field has not been set
  // manually, attempt to auto-increment it.
  // TODO: Only auto-increment if this version actually differs from
  //   the latest one in store
  if (cube.cubeType === CubeType.PMUC) {
    const countField = cube.getFirstField(CubeFieldType.PMUC_UPDATE_COUNT);
    // Only auto-increment if version is still at the default of 0
    if (countField.value.readUIntBE(0, NetConstants.PMUC_UPDATE_COUNT_SIZE) === 0) {
        // Fetch latest version from store
        const latestVersion = await store.getCube(cube.getKeyIfAvailable());
        let latestCount: number = 0;
        if (latestVersion) {
        latestCount = latestVersion.getFirstField(
            CubeFieldType.PMUC_UPDATE_COUNT).value.readUIntBE(
            0, NetConstants.PMUC_UPDATE_COUNT_SIZE);
        }
        // Auto-increment the count
        const newCount = latestCount + 1;
        countField.value.writeUIntBE(newCount, 0, NetConstants.PMUC_UPDATE_COUNT_SIZE);
        cube.cubeManipulated();  // Cube requires recompilation
    }
  }
}
