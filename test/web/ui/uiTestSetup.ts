import { JSDOM } from 'jsdom';

export async function loadVerityBaseTemplate(): Promise<void> {
  const baseTemplate: JSDOM = await JSDOM.fromFile(
    "src/webui/static/index.html", {
      runScripts: "dangerously",
    });
  global.document = baseTemplate.window.document;
  // Wait for the DOM to fully load
  return new Promise<void>(resolve => {
    baseTemplate.window.addEventListener("load", () => { resolve() }, {once: true});
  });
}
