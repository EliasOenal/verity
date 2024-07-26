import { VerityView } from "../verityView";
import { FileManagerController } from "./fileManagerController";

export class FileManagerView extends VerityView {
  private uploadForm: HTMLFormElement;
  private fileInput: HTMLInputElement;
  private fileInfoDiv: HTMLDivElement;
  private fileSizeSpan: HTMLSpanElement;
  private estimatedTimeSpan: HTMLSpanElement;
  private submitButton: HTMLButtonElement;
  private downloadForm: HTMLFormElement;
  private keyInput: HTMLInputElement;
  private downloadButton: HTMLButtonElement;
  private inspectButton: HTMLButtonElement;
  private uploadMessageArea: HTMLDivElement;
  private downloadMessageArea: HTMLDivElement;
  private progressBarContainer: HTMLDivElement;
  private progressBar: HTMLDivElement;
  private progressText: HTMLDivElement;
  private uploadStartTime: number | null = null;

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
    this.fileInfoDiv = this.renderedView.querySelector(".verityFileInfo") as HTMLDivElement;
    this.fileSizeSpan = this.renderedView.querySelector(".verityFileSize") as HTMLSpanElement;
    this.estimatedTimeSpan = this.renderedView.querySelector(".verityEstimatedTime") as HTMLSpanElement;
    this.submitButton = this.renderedView.querySelector(".verityFileSubmit") as HTMLButtonElement;
    this.downloadForm = this.renderedView.querySelector(".verityFileDownloadForm") as HTMLFormElement;
    this.keyInput = this.renderedView.querySelector(".verityFileKeyInput") as HTMLInputElement;
    this.downloadButton = this.renderedView.querySelector(".verityFileDownload") as HTMLButtonElement;
    this.inspectButton = this.renderedView.querySelector(".verityFileInspect") as HTMLButtonElement;
    this.uploadMessageArea = this.renderedView.querySelector(".verityFileUploadMessage") as HTMLDivElement;
    this.downloadMessageArea = this.renderedView.querySelector(".verityFileDownloadMessage") as HTMLDivElement;
    
    // Create progress bar elements
    this.progressBarContainer = document.createElement('div');
    this.progressBarContainer.className = 'progress mb-3 position-relative';
    this.progressBarContainer.style.display = 'none';
    
    this.progressBar = document.createElement('div');
    this.progressBar.className = 'progress-bar';
    this.progressBar.setAttribute('role', 'progressbar');
    this.progressBar.setAttribute('aria-valuenow', '0');
    this.progressBar.setAttribute('aria-valuemin', '0');
    this.progressBar.setAttribute('aria-valuemax', '100');
    
    this.progressText = document.createElement('div');
    this.progressText.className = 'progress-text position-absolute w-100 text-center';
    this.progressText.style.top = '50%';
    this.progressText.style.left = '50%';
    this.progressText.style.transform = 'translate(-50%, -50%)';
    this.progressText.style.fontFamily = 'monospace';
    
    this.progressBarContainer.appendChild(this.progressBar);
    this.progressBarContainer.appendChild(this.progressText);
    this.uploadForm.insertBefore(this.progressBarContainer, this.submitButton);
  }

  private addEventListeners(): void {
    this.uploadForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const file = this.fileInput.files?.[0];
      if (file) {
        this.showProgressBar();
        (this.controller as FileManagerController).uploadFile(file);
      }
    });

    this.fileInput.addEventListener("change", () => {
      const file = this.fileInput.files?.[0];
      if (file) {
        this.displayFileInfo(file);
        this.submitButton.disabled = false;
      } else {
        this.hideFileInfo();
        this.submitButton.disabled = true;
      }
    });

    this.downloadButton.addEventListener("click",

 () => {
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
    this.hideProgressBar();
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

  updateUploadProgress(progress: number, remainingSize: number): void {
    if (this.uploadStartTime === null) {
      this.uploadStartTime = Date.now();
    }

    const elapsedTime = (Date.now() - this.uploadStartTime) / 1000; // in seconds
    const estimatedTotalTime = elapsedTime / (progress / 100);
    const remainingTime = estimatedTotalTime - elapsedTime;

    this.progressBar.style.width = `${progress}%`;
    this.progressBar.style.transition = 'width .5s ease';
    this.progressBar.setAttribute('aria-valuenow', progress.toString());
    
    const progressText = `${progress.toFixed(1)}% | ${remainingSize} bytes remaining | ${this.formatTime(remainingTime)}`;
    this.progressText.textContent = progressText;
  }

  private resetUploadForm(): void {
    this.uploadForm.reset();
    this.submitButton.disabled = true;
    this.hideFileInfo();
    this.hideProgressBar();
    this.uploadStartTime = null;
  }

  private displayFileInfo(file: File): void {
    const fileSize = this.formatFileSize(file.size);
    const estimatedTime = this.estimateUploadTime(file.size);

    this.fileSizeSpan.textContent = fileSize;
    this.estimatedTimeSpan.textContent = estimatedTime;
    this.fileInfoDiv.style.display = 'block';
  }

  private hideFileInfo(): void {
    this.fileInfoDiv.style.display = 'none';
  }

  private showProgressBar(): void {
    this.progressBarContainer.style.display = 'flex';
    this.progressText.style.display = 'block';
  }

  private hideProgressBar(): void {
    this.progressBarContainer.style.display = 'none';
    this.progressText.style.display = 'none';
  }

  private formatFileSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }

  private estimateUploadTime(bytes: number): string {
    const seconds = Math.ceil(bytes / 1024);
    return this.formatTime(seconds);
  }

  private formatTime(seconds: number): string {
    if (seconds < 60) {
      return `${Math.round(seconds)} second${Math.round(seconds) !== 1 ? 's' : ''}`;
    } else if (seconds < 3600) {
      const minutes = Math.round(seconds / 60);
      return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
    } else if (seconds < 86400) {
      const hours = Math.round(seconds / 3600);
      return `${hours} hour${hours !== 1 ? 's' : ''}`;
    } else {
      const days = Math.round(seconds / 86400);
      return `${days} day${days !== 1 ? 's' : ''}`;
    }
  }
}
