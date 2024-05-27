import { commonConfig } from './webpack.base.mjs'
import CopyWebpackPlugin from 'copy-webpack-plugin';

export const zwConfig = {
  ...commonConfig
};
zwConfig.plugins.push(
  new CopyWebpackPlugin({
    patterns: [
      { from: './src/webui/static/index.html' },
      { from: './src/webui/static/style.css' },
      { from: './src/webui/static/frontend.js' },  // alternatively, we could write that in Typescript and make it a second bundle
      { from: './src/webui/static/manifest.json' },
      { from: './src/webui/static/serviceWorker.js' },
      { from: './img/vera.svg' },
      { from: './img/unknownuser.svg' },
      { from: './img/bootstrap.bundle.min.js' },
      { from: './img/bootstrap.min.css' },
      { from: './img/bootstrap-icons.min.css' },
      { from: './img/bootstrap-icons.woff', to: 'fonts/bootstrap-icons.woff' },
    ]
  }),
);
zwConfig.entry.verityUI = "./src/app/zw/main.ts";

export default zwConfig;