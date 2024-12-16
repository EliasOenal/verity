import { commonConfig } from './webpack.base.mjs'
import CopyWebpackPlugin from 'copy-webpack-plugin';
import path from 'path';

// exported for application sub-projects only
export function frontendConfig(basepath, libpath=basepath+"/node_modules/verity/") {
  const ret = {
    ...commonConfig,
    output: {
      filename: '[name].js',
      path: path.resolve(basepath, './distweb'),
    },
    devServer: {
      static: path.join(basepath, "./distweb"),
      compress: true,
      port: 11984,
    },

  }
  ret.plugins.push(
    new CopyWebpackPlugin({
      patterns: [
        { from: libpath+'/src/webui/static/index.html' },
        { from: libpath+'/src/webui/static/style.css' },
        { from: libpath+'/src/webui/static/frontend.js' },  // alternatively, we could write that in Typescript and make it a second bundle
        { from: libpath+'/src/webui/static/manifest.json' },
        { from: libpath+'/src/webui/static/serviceWorker.js' },
        { from: libpath+'/img/vera.svg' },
        { from: libpath+'/img/Oxygen480-actions-im-invisible-user.svg', to: 'unknownuser.svg' },
        { from: libpath+'/img/bootstrap.bundle.min.js' },
        { from: libpath+'/img/bootstrap.min.css' },
        { from: libpath+'/img/bootstrap-icons.min.css' },
        { from: libpath+'/img/bootstrap-icons.woff', to: 'fonts/bootstrap-icons.woff' },
      ]
    }),
  );
  return ret;
};
