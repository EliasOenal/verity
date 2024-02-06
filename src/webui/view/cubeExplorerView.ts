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
    if (!li) li = this.newFromTemplate(".verityCube") as HTMLLIElement;
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
    // prepare containers
    const schematicContainer: HTMLElement =
      li.querySelector(".veritySchematicFields");
    schematicContainer.replaceChildren();
    const fieldDetailsConstainer: HTMLElement =
      li.querySelector(".veritySchematicFieldDetailsContainer");
    fieldDetailsConstainer.replaceChildren();
    // populate fields
    for (let i=0; i<cube.fields.all.length; i++) {
      // schematic header
      const field = cube.fields.all[i];
      const fieldName: string = cube.fieldParser.fieldDef.fieldNames[field.type] as string;
      const schematicField: HTMLElement = this.newFromTemplate(".veritySchematicField");
      schematicField.setAttribute("id", `pills-tab-${key}-${i}`);
      schematicField.setAttribute("data-bs-target", `#pills-${key}-${i}`);
      schematicField.setAttribute("aria-controls", `pills-${key}-${i}`);
      schematicField.innerText = fieldName ?? field.type.toString();
      schematicContainer.appendChild(schematicField);

      // field details
      const detailsTable: HTMLTableElement =
        this.newFromTemplate(".veritySchematicFieldDetails") as HTMLTableElement;
      detailsTable.setAttribute("id", `pills-${key}-${i}`);
      detailsTable.setAttribute("aria-labelledby", `pills-tab-${key}-${i}`);
      (detailsTable.querySelector(".veritySchematicFieldType") as HTMLElement)
        .innerText = (fieldName ?? field.type.toString()) + ` (code ${field.type.toString()} / 0x${field.type.toString(16)})`;  // TODO omit code for positionals
      (detailsTable.querySelector(".veritySchematicFieldLength") as HTMLElement)
        .innerText = field.length.toString();
      (detailsTable.querySelector(".veritySchematicFieldHex") as HTMLElement)
        .innerText = field.value.toString('hex');
      (detailsTable.querySelector(".veritySchematicFieldUtf8") as HTMLElement)
        .innerText = field.value.toString('utf-8');
      fieldDetailsConstainer.appendChild(detailsTable);
    }

    // all done, append Cube to list
    this.cubeList.appendChild(li);
  }

}