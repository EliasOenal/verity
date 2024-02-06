import { Cube } from "../../core/cube/cube";
import { CubeType } from "../../core/cube/cubeDefinitions";
import { VerityView } from "../webUiDefinitions";

const cubeEmoji: Map<CubeType, string> = new Map([
  [CubeType.DUMB, String.fromCodePoint(0x1F9CA)],  // 🧊
  [CubeType.MUC, String.fromCodePoint(0x1F504)],  // 🔄
]);

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

  displayStats(total: number, displayed: number, unparsable: number){
    (this.renderedView.querySelector(".verityCubeStoreStatTotalCubes") as HTMLElement)
      .innerText = total.toString();
    (this.renderedView.querySelector(".verityCubeStoreStatCubesDisplayed") as HTMLElement)
      .innerText = displayed.toString();
    (this.renderedView.querySelector(".verityCubeStoreStatCubesUnparsable") as HTMLElement)
      .innerText = unparsable.toString();
  }

  displayCube(key: string, cube: Cube, li?: HTMLLIElement) {
    let emoji: string = "", type: string = "", typeWithEmoji: string = "";
    if (cubeEmoji.get(cube.cubeType)) emoji = cubeEmoji.get(cube.cubeType);
    if (CubeType[cube.cubeType]) type = CubeType[cube.cubeType];
    else type = cube.cubeType.toString();
    typeWithEmoji = emoji + type;

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
    summary.innerText = emoji + key;

    // set general cube information
    (li.querySelector(".verityCubeType") as HTMLElement).innerText = typeWithEmoji;
    (li.querySelector(".verityCubeHash") as HTMLElement).innerText = cube.getHashIfAvailable().toString('hex');
    const date: Date = new Date(cube.getDate()*1000);
    const dateformat: Intl.DateTimeFormatOptions =
      { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const dateText =
      date.toLocaleDateString(navigator.language, dateformat) + " " + date.toLocaleTimeString(navigator.language);
    (li.querySelector(".verityCubeDate") as HTMLElement).innerText = dateText;
    (li.querySelector(".verityCubeDifficulty") as HTMLElement).innerText = cube.getDifficulty().toString();

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
      schematicField.innerText = fieldName ?? (field.type >> 2).toString();
      schematicContainer.appendChild(schematicField);

      // field details
      const detailsTable: HTMLTableElement =
        this.newFromTemplate(".veritySchematicFieldDetails") as HTMLTableElement;
      detailsTable.setAttribute("id", `pills-${key}-${i}`);
      detailsTable.setAttribute("aria-labelledby", `pills-tab-${key}-${i}`);
      (detailsTable.querySelector(".veritySchematicFieldType") as HTMLElement)
        .innerText = (fieldName ?? field.type.toString()) + ` (code ${(field.type >> 2).toString()} / 0x${(field.type >> 2).toString(16)})`;  // TODO omit code for positionals
      (detailsTable.querySelector(".veritySchematicFieldLength") as HTMLElement)
        .innerText = field.length.toString();
      // TODO: parse known field contents instead of just dumping their value
      // TODO: instead of showing utf8 and hex, guess best representation
      //       and provide a switch to change presentation
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