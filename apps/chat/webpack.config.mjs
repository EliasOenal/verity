import path from 'path';
import CopyWebpackPlugin from 'copy-webpack-plugin';
import { commonConfig } from '../../webpack.base.mjs';

// Absolute path to this directory
const dirname = path.dirname(new URL(import.meta.url).pathname);

// Start from the shared low-level webpack base (without webui asset copying)
const chatConfig = {
  ...commonConfig,
  entry: {
    chatApp: './apps/chat/src/main.ts', // distinct bundle name
  },
  output: {
    filename: '[name].js',
    path: path.resolve(dirname, './dist'),
    clean: true,
  },
  devServer: {
    static: path.join(dirname, './dist'),
    compress: true,
    port: 11986,
    allowedHosts: 'all',
    hot: false,
    liveReload: false,
    client: { logging: 'warn', reconnect: false },
  },
  plugins: [
    // Retain existing commonConfig plugins
    ...commonConfig.plugins,
    // Copy ONLY chat app specific assets (no webui mixing)
    new CopyWebpackPlugin({
      patterns: [
        { from: './apps/chat/index.html' },
        { from: './apps/chat/chat.css' },
        // Minimal required shared asset for favicon / logo
        { from: './img/vera.svg', to: 'vera.svg' },
      ],
    }),
  ],
};

export default chatConfig;