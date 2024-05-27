import { commonConfig } from './webpack.base.mjs'
import CopyWebpackPlugin from 'copy-webpack-plugin';

// exported for application sub-projects only
export const frontendConfig = {
  ...commonConfig
};
frontendConfig.plugins.push(
  new CopyWebpackPlugin({
    patterns: [
      { from: 'node_modules/verity/src/webui/static/index.html' },
      { from: 'node_modules/verity/src/webui/static/style.css' },
      { from: 'node_modules/verity/src/webui/static/frontend.js' },  // alternatively, we could write that in Typescript and make it a second bundle
      { from: 'node_modules/verity/src/webui/static/manifest.json' },
      { from: 'node_modules/verity/src/webui/static/serviceWorker.js' },
      { from: 'node_modules/verity/img/vera.svg' },
      { from: 'node_modules/verity/img/unknownuser.svg' },
      { from: 'node_modules/verity/img/bootstrap.bundle.min.js' },
      { from: 'node_modules/verity/img/bootstrap.min.css' },
      { from: 'node_modules/verity/img/bootstrap-icons.min.css' },
      { from: 'node_modules/verity/img/bootstrap-icons.woff', to: 'fonts/bootstrap-icons.woff' },
    ]
  }),
);
