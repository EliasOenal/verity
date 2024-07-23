import { VerityView } from "../verityView";
import { FileManagerController } from "./fileManagerController";

export class FileManagerView extends VerityView {
  private uploadForm: HTMLFormElement;
  private fileInput: HTMLInputElement;
  private submitButton: HTMLButtonElement;
  private downloadForm: HTMLFormElement;
  private keyInput: HTMLInputElement;
  private downloadButton: HTMLButtonElement;
  private inspectButton: HTMLButtonElement;
  private uploadMessageArea: HTMLDivElement;
  private downloadMessageArea: HTMLDivElement;

  constructor(
    controller: FileManagerController,
    htmlTemplate?: HTMLTemplateElement,
    show: boolean = false
  ) {
    super(controller, htmlTemplate || document.getElementById('verityFileManagerTemplate') as HTMLTemplateElement);
    this.initializeElements();
    this.addEventListeners();
    this.renderedView.classList.add('mt-3', 'mt-sm-5', 'mb-3');
  }

  private initializeElements(): void {
    this.uploadForm = this.renderedView.querySelector(".verityFileUploadForm") as HTMLFormElement;
    this.fileInput = this.renderedView.querySelector(".verityFileInput") as HTMLInputElement;
    this.submitButton = this.renderedView.querySelector(".verityFileSubmit") as HTMLButtonElement;
    this.downloadForm = this.renderedView.querySelector(".verityFileDownloadForm") as HTMLFormElement;
    this.keyInput = this.renderedView.querySelector(".verityFileKeyInput") as HTMLInputElement;
    this.downloadButton = this.renderedView.querySelector(".verityFileDownload") as HTMLButtonElement;
    this.inspectButton = this.renderedView.querySelector(".verityFileInspect") as HTMLButtonElement;
    this.uploadMessageArea = this.renderedView.querySelector(".verityFileUploadMessage") as HTMLDivElement;
    this.downloadMessageArea = this.renderedView.querySelector(".verityFileDownloadMessage") as HTMLDivElement;
  }

  private addEventListeners(): void {
    this.uploadForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const file = this.fileInput.files?.[0];
      if (file) {
        (this.controller as FileManagerController).uploadFile(file);
      }
    });

    this.fileInput.addEventListener("change", () => {
      this.submitButton.disabled = !this.fileInput.files?.length;
    });

    this.downloadButton.addEventListener("click", () => {
      const key = this.keyInput.value.trim();
      if (key) {
        (this.controller as FileManagerController).downloadFile(key);
      }
    });

    this.inspectButton.addEventListener("click", () => {
      const key = this.keyInput.value.trim();
      if (key) {
        (this.controller as FileManagerController).inspectFile(key);
      }
    });

    this.keyInput.addEventListener("input", () => {
      const hasValue = !!this.keyInput.value.trim();
      this.downloadButton.disabled = !hasValue;
      this.inspectButton.disabled = !hasValue;
    });
  }

  showUploadSuccess(fileName: string, cubeKeys: string[]): void {
    this.uploadMessageArea.innerHTML = `
      <div class="alert alert-success">
        <p>File "${fileName}" uploaded successfully!</p>
        <p>Cube keys: (Hint: Use first key in [img][/img] tags.)</p>
        <ul class="mb-0">
          ${cubeKeys.map(key => `<li>${key}</li>`).join('')}
        </ul>
      </div>
    `;
    this.resetUploadForm();
  }

  showUploadError(errorMessage: string): void {
    this.uploadMessageArea.innerHTML = `
      <div class="alert alert-danger">
        Upload failed: ${errorMessage}
      </div>
    `;
  }

  showInspectedFile(fileName: string, fileSize: number, imageUrl?: string): void {
    let content = `
      <div class="alert alert-info">
        <p class="mb-1">File Name: ${fileName}</p>
        <p class="mb-1">File Size: ${fileSize} bytes</p>
    `;
    if (imageUrl) {
      content += `<img src="${imageUrl}" alt="${fileName}" class="img-fluid mt-2">`;
    }
    content += `</div>`;
    this.downloadMessageArea.innerHTML = content;
  }

  showDownloadSuccess(fileName: string): void {
    this.downloadMessageArea.innerHTML = `
      <div class="alert alert-success">
        File "${fileName}" downloaded successfully!
      </div>
    `;
  }

  showDownloadError(errorMessage: string): void {
    this.downloadMessageArea.innerHTML = `
      <div class="alert alert-danger">
        Download failed: ${errorMessage}
      </div>
    `;
  }

  private resetUploadForm(): void {
    this.uploadForm.reset();
    this.submitButton.disabled = true;
  }
}
