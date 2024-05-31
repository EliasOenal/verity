import path from 'path';
import { frontendConfig } from './webpack.veritycommon.mjs'

var dirname = path.dirname(new URL(import.meta.url).pathname);
const zwConfig = frontendConfig(dirname, dirname);
zwConfig.entry.verityUI = "./src/app/zw/main.ts";

export default zwConfig;
