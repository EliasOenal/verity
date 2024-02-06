import { Cube } from "../../core/cube/cube";
import { VerityView } from "../webUiDefinitions";

export class CubeExplorerView extends VerityView {
  private cubeList: HTMLUListElement;

  constructor(
      htmlTemplate: HTMLTemplateElement = document.getElementById(
        "verityCubeExplorerTemplate") as HTMLTemplateElement,
  ){
    super(htmlTemplate);
    this.cubeList = this.renderedView.querySelector(".verityCubeList") as HTMLUListElement;
    this.clearAll();
  }

  clearAll() {
    this.cubeList.replaceChildren();
  }

  displayCube(key: string, cube: Cube, li?: HTMLLIElement) {
    // prepare containers and set HTML element attributes
    if (!li) li = this.newEntry(".verityCube") as HTMLLIElement;
    li.setAttribute("data-cubekey", key);
    const toggleControl: HTMLElement = li.querySelector(".verityCubeToggleControl");
    toggleControl.setAttribute("data-bs-target", `#verityExploredCube-${key}`);
    toggleControl.setAttribute("aria-controls", `verityExploredCube-${key}`);
    const detailsContainer: HTMLElement = li.querySelector(".verityExploredCube");
    detailsContainer.setAttribute("id", `verityExploredCube-${key}`);
    // set summary (i.e. what's visible before clicking)
    const summary: HTMLElement = li.querySelector(".verityCubeSummary");
    summary.innerText = key;
    // set schematic view
    const tr: HTMLTableRowElement = li.querySelector(".veritySchematicFields");
    tr.replaceChildren();
    for (const field of cube.fields.all) {
      const td: HTMLTableCellElement = document.createElement("td");
      td.setAttribute("class", "veritySchematicField");
      td.innerText = field.type.toString();  // TODO use field name if known, show more info
      tr.appendChild(td);
    }
    this.cubeList.appendChild(li);
  }

}