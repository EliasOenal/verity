import path from 'path';
import { commonConfig } from './webpack.base.mjs';
import CopyWebpackPlugin from 'copy-webpack-plugin';

const dirname = path.dirname(new URL(import.meta.url).pathname);

// Test-specific webpack configuration
const testConfig = {
  ...commonConfig,
  mode: 'development',
  output: {
    filename: '[name].js',
    path: path.resolve(dirname, './test-dist'),
    clean: true,
  },
  entry: {
    'full-node-test': './test/browser/test-apps/full-node/main.ts',
    'light-node-test': './test/browser/test-apps/light-node/main.ts',
    'chat-test': './test/browser/test-apps/chat/main.ts',
    'webrtc-test': './test/browser/test-apps/webrtc/main.ts',
  },
  resolve: {
    ...commonConfig.resolve,
  },
  devServer: {
    static: [
      {
        directory: path.join(dirname, "./test-dist"),
      },
      {
        directory: path.join(dirname, "./test/browser/test-apps"),
        watch: false,
      }
    ],
    compress: true,
    port: 11985, // Different port from main app
    allowedHosts: 'all',
  },
  plugins: [
    ...commonConfig.plugins,
    new CopyWebpackPlugin({
      patterns: [
        { from: './test/browser/test-apps/**/*.html', to: '[name][ext]' },
        { from: './test/browser/test-apps/**/*.css', to: '[name][ext]' },
      ]
    }),
  ],
};

export default testConfig;