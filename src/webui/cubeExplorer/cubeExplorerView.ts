import { MediaTypes, cciField, cciFieldType } from "../../cci/cube/cciField";
import { cciFields } from "../../cci/cube/cciFields";
import { cciRelationship, cciRelationshipType } from "../../cci/cube/cciRelationship";
import { Cube } from "../../core/cube/cube";
import { CubeType } from "../../core/cube/cubeDefinitions";
import { CubeField } from "../../core/cube/cubeField";
import { isPrintable } from "../../core/helpers/misc";
import { VerityView } from "../verityView";
import { CubeExplorerController, CubeFilter } from "./cubeExplorerController";

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
      readonly controller: CubeExplorerController,
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
    const dateText = this.formatDate(cube.getDate());
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
      // field type
      let fieldType: string = fieldName ?? field.type.toString();
      if (Object.values(cube.fieldParser.fieldDef.positionalFront).includes(field.type) ||
          Object.values(cube.fieldParser.fieldDef.positionalBack).includes(field.type)) {
        fieldType += " (positional field)"
      } else fieldType += ` (code ${(field.type >> 2).toString()} / 0x${(field.type >> 2).toString(16)})`;
      (detailsTable.querySelector(".veritySchematicFieldType") as HTMLElement)
        .innerText = fieldType;
      // field start index
      (detailsTable.querySelector(".veritySchematicFieldStart") as HTMLElement)
        .innerText = field.start.toString();
      // content length
      (detailsTable.querySelector(".veritySchematicFieldLength") as HTMLElement)
        .innerText = field.length.toString();
      // TODO: parse known field contents instead of just dumping their value
      // find best encoding for content -- TODO: when decoding PAYLOAD, should respect MEDIA_TYPE field if any
      this.setDecodedFieldContent(field, detailsTable);
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

  setDecodedFieldContent(field: CubeField, detailsTable: HTMLTableElement): void {
    // can we decode this field type semantically?
    if (field.type === cciFieldType.RELATES_TO) {
      this.setRelFieldContent(field, detailsTable);
    } else {
      // no semantic decoding available, offer basic string and hex decoding instead
      this.setRawFieldContent(field, detailsTable);
    }
  }

  private setRelFieldContent(
      field: CubeField,
      detailsTable: HTMLTableElement
  ): void {
    const rel: cciRelationship = cciRelationship.fromField(field);
    // do we know the name of this relationship type?
    let relTypeString: string;
    if (rel.type in cciRelationshipType) {
      relTypeString = `${cciRelationshipType[rel.type]} (code ${rel.type} / 0x${rel.type.toString(16)})`
    } else relTypeString = rel.type.toString();
    // prepare view: Relationship type row
    const typeRow: HTMLTableRowElement = document.createElement('tr');
    const typeHeader: HTMLTableCellElement = document.createElement('th');
    typeHeader.textContent = "Relationship type";
    typeRow.appendChild(typeHeader);
    const typeData: HTMLTableCellElement = document.createElement('td');
    typeData.textContent = relTypeString;
    typeRow.appendChild(typeData);
    // prepare view: Remote Cube
    const remoteRow: HTMLTableRowElement = document.createElement('tr');
    const remoteHeader: HTMLTableCellElement = document.createElement('th');
    remoteHeader.textContent = "Remote Cube";
    const remoteCell: HTMLTableCellElement = document.createElement('td');
    const remoteData: HTMLAnchorElement = document.createElement('a');
    remoteCell.classList.add("verityEllipsisedKey");  // for CSS styling
    remoteData.textContent = rel.remoteKeyString;
    remoteData.href = "#";
    remoteData.onclick = () => this.controller.redisplay({key: rel.remoteKeyString});
    remoteCell.appendChild(remoteData);
    remoteRow.appendChild(remoteHeader);
    remoteRow.appendChild(remoteCell);
    // replace generic content row with relationship type and target rows
    const contentRow: HTMLTableRowElement =
      detailsTable.querySelector(".veritySchematicFieldContentRow");
    contentRow?.remove();
    const tBody: HTMLTableSectionElement = detailsTable.querySelector("tbody");
    tBody.appendChild(typeRow);
    tBody.appendChild(remoteRow);
  }

  setRawFieldContent(
      field: CubeField,
      detailsTable: HTMLTableElement,
      encodingIndex: EncodingIndex = this.findBestEncoding(field.value),
  ): void {
    let content: string;
    if (field.value.length === 0) {
      // no content, nothing to display
      const contentRow: HTMLTableRowElement =
      detailsTable.querySelector(".veritySchematicFieldContentRow");
      contentRow?.remove();
      return;
    }
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

  fetchCubeFilter(): CubeFilter {
    const ret: CubeFilter = {};
    // read and parse search filters:
    // Cube Key
    const key: string = (this.renderedView.querySelector(
      ".verityCubeKeyFilter") as HTMLInputElement)?.value;
    if (key.length > 0) ret.key = key;
    // Sculpt date
    const dateFromInput: string = (this.renderedView.querySelector(
      ".verityCubeDateFrom") as HTMLInputElement)?.value;
    let dateFrom: number = (new Date(dateFromInput)).getTime() / 1000;
    if (!Number.isNaN(dateFrom)) ret.dateFrom = dateFrom;
    const dateToInput: string = (this.renderedView.querySelector(
      ".verityCubeDateTo") as HTMLInputElement)?.value;
    let dateTo: number = (new Date(dateToInput)).getTime() / 1000;
    if (!Number.isNaN(dateTo)) ret.dateTo = dateTo;
    // String content
    const content: string = (this.renderedView.querySelector(
      ".verityCubeContentFilter") as HTMLInputElement)?.value;
    if (content.length > 0) ret.content = content;
    return ret;
  }

  displayCubeFilter(filter: CubeFilter): void {
    // key filter
    const keyInput: HTMLInputElement =
      this.renderedView.querySelector('.verityCubeKeyFilter');
    keyInput.value = filter.key ?? "";
    // date from filter
    const dateFromInput: HTMLInputElement =
      this.renderedView.querySelector(".verityCubeDateFrom");
    dateFromInput.value = this.unixtimeToDatetimeLocal(filter.dateFrom);
    // date to filter
    const dateToInput: HTMLInputElement =
    this.renderedView.querySelector(".verityCubeDateTo");
    dateToInput.value = this.unixtimeToDatetimeLocal(filter.dateTo);
    // content string filter
    const contentInput: HTMLInputElement =
      this.renderedView.querySelector(".verityCubeContentFilter");
    contentInput.textContent = filter.content ?? "";
  }

  private unixtimeToDatetimeLocal(unixtime: number): string {
    if (unixtime === undefined) return "";
    var date = new Date(unixtime * 1000);
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0,16);
  }
}