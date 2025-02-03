import { JSDOM } from 'jsdom';
import { loadStyle, loadTemplate } from '../../../../src/webui/helpers/dom';

import * as postTemplate from '../../../../src/app/zw/webui/post/postTemplate.html';
// import * as postStyle from '../../../../src/app/zw/webui/post/postStyle.css';


export async function loadZwTemplate(): Promise<void> {
  const baseTemplate: JSDOM = await JSDOM.fromFile(
    "src/webui/static/index.html", {runScripts: "dangerously"});
  global.document = baseTemplate.window.document;
  // Wait for the DOM to fully load
  await new Promise<void>(resolve => {
    baseTemplate.window.addEventListener("load", () => { resolve() }, {once: true});
  });
  loadTemplate(postTemplate);
  // loadStyle(postStyle);
}
