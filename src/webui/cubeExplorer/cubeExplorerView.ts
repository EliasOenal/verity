import { MediaTypes, cciField, cciFieldType } from "../../cci/cube/cciField";
import { cciFields } from "../../cci/cube/cciFields";
import { Cube } from "../../core/cube/cube";
import { CubeType } from "../../core/cube/cubeDefinitions";
import { CubeField } from "../../core/cube/cubeField";
import { isPrintable } from "../../core/helpers/misc";
import { VerityView } from "../verityView";

const cubeEmoji: Map<CubeType, string> = new Map([
  [CubeType.FROZEN, String.fromCodePoint(0x1F9CA)],  // 🧊
  [CubeType.MUC, String.fromCodePoint(0x1F504)],  // 🔄
]);
const cubeTypeString: Map<CubeType, string> = new Map([
  [CubeType.FROZEN, "Frozen (basic) Cube"],
  [CubeType.MUC, "Mutable User Cube"],
]);

enum EncodingIndex {
  // always make sure these match the select option order in index.html
  utf8 = 0,
  utf16 = 1,
  hex = 2,
}

export class CubeExplorerView extends VerityView {
  private cubeList: HTMLUListElement;

  // TODO: Do not display view before values have been filled in
  constructor(
      htmlTemplate: HTMLTemplateElement = document.getElementById(
        "verityCubeExplorerTemplate") as HTMLTemplateElement,
  ){
    super(htmlTemplate);
    this.cubeList = this.renderedView.querySelector(".verityCubeList") as HTMLUListElement;
    this.clearAll();
  }

  clearAll(): void {
    this.cubeList.replaceChildren();
  }

  displayStats(total: number, displayed: number, unparsable: number, filtered: number): void {
    (this.renderedView.querySelector(".verityCubeStoreStatTotalCubes") as HTMLElement)
      .innerText = total.toString();
    (this.renderedView.querySelector(".verityCubeStoreStatCubesDisplayed") as HTMLElement)
      .innerText = displayed.toString();
    (this.renderedView.querySelector(".verityCubeStoreStatCubesUnparsable") as HTMLElement)
      .innerText = unparsable.toString();
    (this.renderedView.querySelector(".verityCubeStoreStatCubesFiltered") as HTMLElement)
      .innerText = filtered.toString();
  }

  displayCube(key: string, cube: Cube, li?: HTMLLIElement): void {
    // prepare data
    let emoji: string = "", type: string = "", typeWithEmoji: string = "";
    // select cube emoji
    if (cubeEmoji.get(cube.cubeType)) emoji = cubeEmoji.get(cube.cubeType) + '\xa0';  // emoji + nbsp
    // select cube name string
    if (cubeTypeString.has(cube.cubeType)) type = cubeTypeString.get(cube.cubeType);
    else if (CubeType[cube.cubeType]) type = CubeType[cube.cubeType];  // fallback in case cubeTypeString is incomplete
    else type = cube.cubeType.toString();  // fallback in case of unknown Cube type -- should never happen
    // combine emoji with name
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
    const dateText = this.formatDate(cube.getDate()*1000);
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
    for (let i=0; i<cube.fields.length; i++) {
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
      detailsTable.setAttribute("data-fieldindex", i.toString());
      detailsTable.setAttribute("id", `pills-${key}-${i}`);
      detailsTable.setAttribute("aria-labelledby", `pills-tab-${key}-${i}`);
      (detailsTable.querySelector(".veritySchematicFieldType") as HTMLElement)
        .innerText = (fieldName ?? field.type.toString()) + ` (code ${(field.type >> 2).toString()} / 0x${(field.type >> 2).toString(16)})`;  // TODO omit code for positionals
      (detailsTable.querySelector(".veritySchematicFieldStart") as HTMLElement)
        .innerText = field.start.toString();
      (detailsTable.querySelector(".veritySchematicFieldLength") as HTMLElement)
        .innerText = field.length.toString();
      // TODO: parse known field contents instead of just dumping their value
      // find best encoding for content -- TODO: when decoding PAYLOAD, should respect MEDIA_TYPE field if any
      this.setDecodedFieldContent(field, this.findBestEncoding(field.value), detailsTable);
      fieldDetailsConstainer.appendChild(detailsTable);
    }

    // all done, append Cube to list
    this.cubeList.appendChild(li);
  }

  findBestEncoding(val: Buffer): EncodingIndex {
    if (isPrintable(val.toString("utf8"))) {
      return EncodingIndex.utf8;
    } else if (isPrintable(val.toString("utf16le"))) {
      return EncodingIndex.utf16;
    } else {
       return EncodingIndex.hex;
    }

  }

  setDecodedFieldContent(field: CubeField, encodingIndex: EncodingIndex, detailsTable: HTMLTableElement): void {
    let content: string;
    if (encodingIndex == EncodingIndex.utf8) content = field.value.toString("utf8");
    else if (encodingIndex == EncodingIndex.utf16) content = field.value.toString("utf16le");
    else content = field.value.toString("hex");
    (detailsTable.querySelector(".veritySchematicFieldContent") as HTMLElement)
      .innerText = content;
    (detailsTable.querySelector(".verityContentEncodingSwitch") as HTMLSelectElement)
      .selectedIndex = encodingIndex;
  }

  showBelowCubes(message: string): void {
    (this.renderedView.querySelector('.verityMessageBottom') as HTMLElement)
      .innerText = message;
  }
}