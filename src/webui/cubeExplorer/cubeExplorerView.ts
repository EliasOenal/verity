import { cciFieldType } from "../../cci/cube/cciCube.definitions";
import { cciRelationship, cciRelationshipType } from "../../cci/cube/cciRelationship";
import { Cube } from "../../core/cube/cube";
import { CubeType } from "../../core/cube/cube.definitions";
import { CubeField } from "../../core/cube/cubeField";
import { isPrintable } from "../../core/helpers/misc";
import { logger } from "../../core/logger";
import { toggleCollapsible } from "../helpers/bootstrap";
import { datetimeLocalToUnixtime, formatDate, unixtimeToDatetimeLocal } from "../helpers/datetime";
import { AlertTypeList, VerityView } from "../verityView";
import { UiError } from "../webUiDefinitions";
import { CubeExplorerController, CubeFilter, EncodingIndex } from "./cubeExplorerController";

const cubeEmoji: Map<CubeType, string> = new Map([
  [CubeType.FROZEN, String.fromCodePoint(0x1F9CA)],  // 🧊
  [CubeType.MUC, String.fromCodePoint(0x1F504)],  // 🔄
]);
const cubeTypeString: Map<CubeType, string> = new Map([
  [CubeType.FROZEN, "Frozen (basic) Cube"],
  [CubeType.MUC, "Mutable User Cube"],
]);

export class CubeExplorerView extends VerityView {
  declare readonly controller: CubeExplorerController;
  private cubeList: HTMLUListElement;

  // TODO: Do not display view before values have been filled in
  constructor(
      controller: CubeExplorerController,
      htmlTemplate: HTMLTemplateElement = document.getElementById(
        "verityCubeExplorerTemplate") as HTMLTemplateElement,
  ){
    super(controller, htmlTemplate);
    this.cubeList = this.renderedView.querySelector(".verityCubeList") as HTMLUListElement;
    if (!this.cubeList) throw new UiError("CubeExplorerView.constructor(): Could not find verityCubeList in template");
    this.clearAll();
  }

  //***
  // View assembly methods
  //***

  clearAll(): void {
    this.clearAlerts();
    this.displayStats(0, 0, 0);
    this.cubeList.replaceChildren();
  }

  displayStats(processed: number, displayed: number, filtered: number): void {
    (this.renderedView.querySelector(".verityCubeStoreStatCubesProcessed") as HTMLElement)
      .textContent = processed.toString();
    (this.renderedView.querySelector(".verityCubeStoreStatCubesDisplayed") as HTMLElement)
      .textContent = displayed.toString();
    (this.renderedView.querySelector(".verityCubeStoreStatCubesFiltered") as HTMLElement)
      .textContent = filtered.toString();
  }

  displayCubeSummary(key: string): void {
    // instantiate from template
    const li = this.newFromTemplate(".verityCube") as HTMLLIElement;

    // fill in attributes with Cube key
    li.setAttribute("data-cubekey", key);
    const toggleControl: HTMLElement = li.querySelector(".verityCubeToggleControl");
    toggleControl.setAttribute("data-bs-target", `#verityExploredCube-${key}`);
    toggleControl.setAttribute("aria-controls", `verityExploredCube-${key}`);
    const detailsContainer: HTMLElement = li.querySelector(".verityExploredCube");
    detailsContainer.setAttribute("id", `verityExploredCube-${key}`);

    // write toggler text
    const summary: HTMLElement = li.querySelector(".verityCubeSummary");
    summary.textContent = key;

    // remove Cube details from now to shrink DOM size
    const exploredCube: HTMLElement = li.querySelector(".verityExploredCube");
    exploredCube.replaceChildren();

    // set event handler for toggler -- this will not just toggle the accordion
    // but also fetch and fill in the Cube details
    toggleControl.addEventListener('click', () => this.controller.toggleCubeDetails(key));

    this.cubeList.appendChild(li);
  }

  displayCubeDetails(key: string, cube: Cube): void {
    const li = this.cubeList.querySelector(`[data-cubekey="${key}"]`) as HTMLLIElement;
    if (!li) return;

    let emoji: string = "", type: string = "", typeWithEmoji: string = "";
    if (cubeEmoji.get(cube.cubeType)) emoji = cubeEmoji.get(cube.cubeType) + '\xa0';
    if (cubeTypeString.has(cube.cubeType)) type = cubeTypeString.get(cube.cubeType);
    else if (CubeType[cube.cubeType]) type = CubeType[cube.cubeType];
    else type = cube.cubeType.toString();
    typeWithEmoji = emoji + type;

    const summary: HTMLElement = li.querySelector(".verityCubeSummary");
    summary.textContent = emoji + key;

    // (re-)create Cube details container
    const exploredCube: HTMLElement = li.querySelector(".verityExploredCube");
    const newExploredCube: HTMLElement = this.newFromTemplate(".verityExploredCube");
    exploredCube.replaceChildren(...(Array.from(newExploredCube.children)));

    (li.querySelector(".verityCubeType") as HTMLElement).textContent = typeWithEmoji;
    (li.querySelector(".verityCubeHash") as HTMLElement).textContent = cube.getHashIfAvailable().toString('hex');
    const dateText = formatDate(cube.getDate());
    (li.querySelector(".verityCubeDate") as HTMLElement).textContent = dateText;
    (li.querySelector(".verityCubeDifficulty") as HTMLElement).textContent = cube.getDifficulty().toString();

    const schematicContainer: HTMLElement = li.querySelector(".veritySchematicFields");
    schematicContainer.replaceChildren();
    const fieldDetailsContainer: HTMLElement = li.querySelector(".veritySchematicFieldDetailsContainer");
    fieldDetailsContainer.replaceChildren();

    for (let i=0; i<cube.fields.length; i++) {
      const field = cube.fields.all[i];
      const fieldName: string = cube.fieldParser.fieldDef.fieldNames[field.type] as string;
      const schematicField: HTMLElement = this.newFromTemplate(".veritySchematicField");
      schematicField.setAttribute("id", `pills-tab-${key}-${i}`);
      schematicField.setAttribute("data-bs-target", `#pills-${key}-${i}`);
      schematicField.setAttribute("aria-controls", `pills-${key}-${i}`);
      schematicField.textContent = fieldName ?? (field.type >> 2).toString();
      schematicContainer.appendChild(schematicField);

      const detailsTable: HTMLTableElement = this.newFromTemplate(".veritySchematicFieldDetails") as HTMLTableElement;
      detailsTable.setAttribute("data-fieldindex", i.toString());
      detailsTable.setAttribute("id", `pills-${key}-${i}`);
      detailsTable.setAttribute("aria-labelledby", `pills-tab-${key}-${i}`);

      let fieldType: string = fieldName ?? field.type.toString();
      if (Object.values(cube.fieldParser.fieldDef.positionalFront).includes(field.type) ||
          Object.values(cube.fieldParser.fieldDef.positionalBack).includes(field.type)) {
        fieldType += " (positional field)"
      } else if (cube.fieldParser.fieldDef.remainderField === field.type) {
        fieldType += " (virtual field containing unparsed data)"
      } else fieldType += ` (code ${(field.type >> 2).toString()} / 0x${(field.type >> 2).toString(16)})`;
      (detailsTable.querySelector(".veritySchematicFieldType") as HTMLElement).textContent = fieldType;
      (detailsTable.querySelector(".veritySchematicFieldStart") as HTMLElement).textContent = field.start?.toString();
      (detailsTable.querySelector(".veritySchematicFieldLength") as HTMLElement).textContent = field.length?.toString();

      this.setDecodedFieldContent(field, detailsTable);
      fieldDetailsContainer.appendChild(detailsTable);
    }
  }

  toggleCubeDetails(key: string): void {
    const li = this.cubeList.querySelector(`[data-cubekey="${key}"]`) as HTMLLIElement;
    const toggleControl: HTMLElement = li.querySelector(".verityCubeToggleControl");
    const collapsible: HTMLElement = li.querySelector(".verityExploredCube");
    toggleCollapsible(toggleControl, collapsible);
  }

  /**
   * Displays an alert on top or instead of the Cube's details.
   * @param key - The key of the Cube for which the alert shall be displayed
   * @param type - A Bootstrap alert type, e.g. "danger" for an error
   * @param msg - The message to display in the alert
   * @param exclusive - If true, the alert will be displayed instead of the
   *   Cube details. Otherwise, it will be displayed on top of the Cube details.
   * @returns The HTMLElement containing the alert
   */
  makeCubeAlert(
      key: string,
      type: AlertTypeList,
      msg: string,
      exclusive: boolean = false
  ): HTMLElement {
    // fetch this Cube's DOM container
    const li = this.cubeList.querySelector(`[data-cubekey="${key}"]`) as HTMLLIElement;
    const accordionBody: HTMLElement = li?.querySelector(".accordion-body");
    //
    let messageContainer: HTMLElement;
    if (!exclusive) messageContainer = accordionBody?.querySelector(".verityMessageCube");
    else messageContainer = accordionBody;
    if (!messageContainer) {
      logger.warn(`CubeExplorerView.makeCubeAlert(): Could not find message container for Cube ${key}, did you mess with my DOM elements?!`);
      return undefined;
    }
    return this.makeAlert(msg, {container: messageContainer, type, exclusive });
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
    if (field.value.length === 0) {
      // no content, nothing to display
      const contentRow: HTMLTableRowElement =
      detailsTable.querySelector(".veritySchematicFieldContentRow");
      contentRow?.remove();
      return;
    }
    const content: string = field.value.toString(  // use specified encoding or default to hex
      EncodingIndex[encodingIndex] as BufferEncoding ?? 'hex');
    (detailsTable.querySelector(".veritySchematicFieldContent") as HTMLElement)
      .textContent = content;
    (detailsTable.querySelector(".verityContentEncodingSwitch") as HTMLSelectElement)
      .value = EncodingIndex[encodingIndex];
  }

  makeAlertBelowCubes(
    type: AlertTypeList,
    msg: string,
    exclusive: boolean = false,
  ): HTMLElement {
    const container: HTMLElement =
      this.renderedView.querySelector('.verityMessageBottom');
    if (!container) {
      logger.error("CubeExplorerView.makeAlertBelowCubes(): Could not find message container, did you mess with my DOM elements?!");
      return undefined;
    }
    this.makeAlert(msg, { container, type, exclusive });
  }

  displayCubeFilter(filter: CubeFilter): void {
    // key filter
    const keyInput: HTMLInputElement =
      this.renderedView.querySelector('.verityCubeKeyFilter');
    keyInput.value = filter.key ?? "";
    // date from filter
    const dateFromInput: HTMLInputElement =
      this.renderedView.querySelector(".verityCubeDateFrom");
    dateFromInput.value = unixtimeToDatetimeLocal(filter.dateFrom);
    // date to filter
    const dateToInput: HTMLInputElement =
    this.renderedView.querySelector(".verityCubeDateTo");
    dateToInput.value = unixtimeToDatetimeLocal(filter.dateTo);
    // content string filter
    const contentInput: HTMLInputElement =
      this.renderedView.querySelector(".verityCubeContentFilter");
    contentInput.textContent = filter.content ?? "";
  }


  //***
  // Conversion methods: Model to view
  //***

  findBestEncoding(val: Buffer): EncodingIndex {
    if (isPrintable(val.toString("utf8"))) {
      return EncodingIndex.utf8;
    } else if (isPrintable(val.toString("utf16le"))) {
      return EncodingIndex.utf16le;
    } else {
       return EncodingIndex.hex;
    }
  }

  //***
  // Conversion methods: View to model
  //***

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
    ret.dateFrom = datetimeLocalToUnixtime(dateFromInput);
    const dateToInput: string = (this.renderedView.querySelector(
      ".verityCubeDateTo") as HTMLInputElement)?.value;
    ret.dateTo = datetimeLocalToUnixtime(dateToInput);
    // Content filter encoding
    const encodingSelect: HTMLSelectElement =
      this.renderedView.querySelector(".verityContentEncodingSelect");
    ret.contentEncoding = EncodingIndex[encodingSelect.value];
    if (ret.contentEncoding === undefined) {
      // if somehow the DOM got corrupted and we get an encoding index which
      // does not exist, just default to hex and reflect that back to the view
      ret.contentEncoding = EncodingIndex.hex;
      encodingSelect.value = 'hex';
    }
    // Content filter string
    const content: string = (this.renderedView.querySelector(
      ".verityCubeContentFilter") as HTMLInputElement)?.value;
    if (content.length > 0) ret.content = content;
    return ret;
  }
}
