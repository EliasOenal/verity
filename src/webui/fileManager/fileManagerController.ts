import { VerityController, ControllerContext } from "../verityController";
import { FileManagerView } from "./fileManagerView";
import { FileApplication } from "../../app/fileApplication";
import { logger } from "../../core/logger";
import { Buffer } from 'buffer';
import { CubeKey } from "../../core/cube/cube.definitions";

export class FileManagerController extends VerityController {
  declare public contentAreaView: FileManagerView;

  constructor(parent: ControllerContext) {
    super(parent);
    this.contentAreaView = new FileManagerView(this, undefined, true);
  }

  async showFileManager(): Promise<void> {
    this.contentAreaView.show();
  }

  async uploadFile(file: File): Promise<void> {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const cubeKeys: string[] = [];

      const progressCallback = (progress: number, remainingSize: number) => {
        this.contentAreaView.updateUploadProgress(progress, remainingSize);
      };

      const cubes = await FileApplication.createFileCubes(buffer, file.name, progressCallback);

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

  async downloadFile(key: string): Promise<void> {
    try {
      const cubeKey = Buffer.from(key, 'hex') as CubeKey;
      const { content, fileName } = await FileApplication.retrieveFile(cubeKey, this.cubeStore);

      const blob = new Blob([content], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);

      // Offer file for download
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      this.contentAreaView.showDownloadSuccess(fileName);
    } catch (error) {
      logger.error(`Error downloading file: ${error}`);
      this.contentAreaView.showDownloadError(error.message);
    }
  }

  async inspectFile(key: string): Promise<void> {
    try {
      const cubeKey = Buffer.from(key, 'hex') as CubeKey;
      const { content, fileName } = await FileApplication.retrieveFile(cubeKey, this.cubeStore);

      let imageUrl: string | undefined;
      if (this.isImage(fileName)) {
        const blob = new Blob([content], { type: this.getImageMimeType(fileName) });
        imageUrl = URL.createObjectURL(blob);
      }

      this.contentAreaView.showInspectedFile(fileName, content.length, imageUrl);
    } catch (error) {
      logger.error(`Error inspecting file: ${error}`);
      this.contentAreaView.showDownloadError(error.message);
    }
  }

  private isImage(fileName: string): boolean {
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
    const ext = fileName.toLowerCase().split('.').pop();
    return imageExtensions.includes(`.${ext}`);
  }

  private getImageMimeType(fileName: string): string {
    const ext = fileName.toLowerCase().split('.').pop();
    switch (ext) {
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'png':
        return 'image/png';
      case 'gif':
        return 'image/gif';
      case 'bmp':
        return 'image/bmp';
      case 'webp':
        return 'image/webp';
      default:
        return 'application/octet-stream';
    }
  }
}
