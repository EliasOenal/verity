import { JSDOM } from 'jsdom';
import { loadStyle, loadTemplate } from '../../../../src/webui/helpers/dom';

import * as postTemplate from '../../../../src/app/zw/webui/post/postTemplate.html';
import { loadVerityBaseTemplate } from '../../../web/ui/uiTestSetup';
// import * as postStyle from '../../../../src/app/zw/webui/post/postStyle.css';


export async function loadZwTemplate(): Promise<void> {
  await loadVerityBaseTemplate();
  loadTemplate(postTemplate);
  // loadStyle(postStyle);
}
