import { Settings } from '../../../src/core/settings';
import { Cube } from '../../../src/core/cube/cube';
import { CubeStore } from '../../../src/core/cube/cubeStore';
import { CubeType } from '../../../src/core/cube/cube.definitions';
import { CubeField } from '../../../src/core/cube/cubeField';

import { vi, describe, expect, it, test, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

describe('CubeStore Retention Policy', () => {
    let cubeStore: CubeStore;
    const reducedDifficulty = 0;

    beforeEach(async () => {
        cubeStore = new CubeStore({
            inMemory: true,
            requiredDifficulty: Settings.REQUIRED_DIFFICULTY,
            enableCubeRetentionPolicy: true,
        });
        await cubeStore.readyPromise;
    });

    it('should reject a cube with a past date', async () => {
        const pastCube = Cube.Frozen({requiredDifficulty: reducedDifficulty});
        pastCube.setDate(Math.floor(Date.now() / 1000) - (365 * 24 * 60 * 60)); // 1 year ago

        let result = await cubeStore.addCube(pastCube);
        expect(result).toBeUndefined();
    });

    it('should reject a cube with a future date', async () => {
        const futureCube = Cube.Frozen({requiredDifficulty: reducedDifficulty});
        futureCube.setDate(Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60)); // 1 year in the future

        let result = await cubeStore.addCube(futureCube);
        expect(result).toBeUndefined();
    });

    it('should accept a current cube', async () => {
        // TODO reduce challenge level for tests -- currently running on full
        // due to lifetime becoming negative on low challenge levels
        // https://github.com/EliasOenal/verity/issues/134
        const currentCube = Cube.Frozen({
            fields: CubeField.RawContent(CubeType.FROZEN,
                "Cubi recentes accipiendi sunt"),
            requiredDifficulty: Settings.REQUIRED_DIFFICULTY
        });
        currentCube.setDate(Math.floor(Date.now() / 1000)); // current time

        await cubeStore.addCube(currentCube);

        const storedCube: Cube = await cubeStore.getCube(currentCube.getKeyIfAvailable());
        expect(storedCube).toBeDefined();
        expect(storedCube!.getHash()).toEqual(currentCube.getHash());
    });

    // TODO add more tests, e.g. concerning persistence
});