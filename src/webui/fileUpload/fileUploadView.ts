import { VerityView } from "../verityView";
import { FileUploadController } from "./fileUploadController";

export class FileUploadView extends VerityView {
  private uploadForm: HTMLFormElement;
  private fileInput: HTMLInputElement;
  private submitButton: HTMLButtonElement;
  private messageArea: HTMLDivElement;

  constructor(
    controller: FileUploadController,
    htmlTemplate: HTMLTemplateElement = document.getElementById(
      "verityFileUploadTemplate"
    ) as HTMLTemplateElement,
    show: boolean = false
  ) {
    super(controller, htmlTemplate);
    this.initializeElements();
    this.addEventListeners();
    if (show) this.show();
  }

  private initializeElements(): void {
    this.uploadForm = this.renderedView.querySelector(".verityFileUploadForm") as HTMLFormElement;
    this.fileInput = this.renderedView.querySelector(".verityFileInput") as HTMLInputElement;
    this.submitButton = this.renderedView.querySelector(".verityFileSubmit") as HTMLButtonElement;
    this.messageArea = this.renderedView.querySelector(".verityFileUploadMessage") as HTMLDivElement;
  }

  private addEventListeners(): void {
    this.uploadForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const file = this.fileInput.files?.[0];
      if (file) {
        (this.controller as FileUploadController).uploadFile(file);
      }
    });

    this.fileInput.addEventListener("change", () => {
      this.submitButton.disabled = !this.fileInput.files?.length;
    });
  }

  showUploadSuccess(fileName: string, cubeKeys: string[]): void {
    this.messageArea.innerHTML = `
      <p>File "${fileName}" uploaded successfully!</p>
      <p>Cube keys: (Hint: Use first key in [img][/img] tags.)</p>
      <ul>
        ${cubeKeys.map(key => `<li>${key}</li>`).join('')}
      </ul>
    `;
    this.messageArea.className = "alert alert-success";
    this.resetForm();
  }

  showUploadError(errorMessage: string): void {
    this.messageArea.textContent = `Upload failed: ${errorMessage}`;
    this.messageArea.className = "alert alert-danger";
  }

  private resetForm(): void {
    this.uploadForm.reset();
    this.submitButton.disabled = true;
  }
}
