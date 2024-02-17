import { Settings } from '../../src/core/settings';
import { Cube } from '../../src/core/cube/cube';
import { CubeStore as CubeStore } from '../../src/core/cube/cubeStore';

describe('CubeStore Retention Policy', () => {
    let cubeStore;

    beforeEach(() => {
        cubeStore = new CubeStore({
            enableCubePersistance: false,
            requiredDifficulty: Settings.REQUIRED_DIFFICULTY,
        });
    });

    test('should reject a cube with a past date', async () => {
        const pastCube = new Cube();
        pastCube.setDate(Math.floor(Date.now() / 1000) - (365 * 24 * 60 * 60)); // 1 year ago

        let result = await cubeStore.addCube(pastCube);
        expect(result).toBeUndefined();
    });

    test('should reject a cube with a future date', async () => {
        const futureCube = new Cube();
        futureCube.setDate(Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60)); // 1 year in the future

        let result = await cubeStore.addCube(futureCube);
        expect(result).toBeUndefined();
    });

    test('should accept a current cube', async () => {
        const currentCube = new Cube();
        currentCube.setDate(Math.floor(Date.now() / 1000)); // current time

        await cubeStore.addCube(currentCube);

        const storedCube = cubeStore.getCube(currentCube.getKeyIfAvailable());
        expect(storedCube).toBeDefined();
        expect(storedCube!.getHash()).toEqual(currentCube.getHash());
    });
});