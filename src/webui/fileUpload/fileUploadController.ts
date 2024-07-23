import { VerityController, ControllerContext } from "../verityController";
import { FileUploadView } from "./fileUploadView";
import { FileApplication } from "../../app/fileApplication";
import { logger } from "../../core/logger";
import { Buffer } from 'buffer';

export class FileUploadController extends VerityController {
  declare public contentAreaView: FileUploadView;

  constructor(parent: ControllerContext) {
    super(parent);
    this.contentAreaView = new FileUploadView(this);
  }

  async showUploadForm(): Promise<void> {
    this.contentAreaView.show();
  }

  async uploadFile(file: File): Promise<void> {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const cubes = await FileApplication.createFileCubes(buffer, file.name);
      
      const cubeKeys: string[] = [];
      for (const cube of cubes) {
        await this.cubeStore.addCube(cube);
        const key = await cube.getKey();
        cubeKeys.push(key.toString('hex'));
      }

      logger.info(`File "${file.name}" uploaded successfully`);
      logger.info(`Cube keys: ${cubeKeys.join(', ')}`);
      this.contentAreaView.showUploadSuccess(file.name, cubeKeys);
    } catch (error) {
      logger.error(`Error uploading file: ${error}`);
      this.contentAreaView.showUploadError(error.message);
    }
  }
}
