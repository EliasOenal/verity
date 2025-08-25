import path from 'path';
import { frontendConfig } from '../../webpack.veritycommon.mjs';
import CopyWebpackPlugin from 'copy-webpack-plugin';

const dirname = path.dirname(new URL(import.meta.url).pathname);

// Create the base config for the chat app
const chatConfig = frontendConfig(dirname, path.resolve(dirname, '../..'));

// Override entry point for chat app
chatConfig.entry = {
  verityUI: "./apps/chat/src/main.ts",
};

// Override output directory for chat app
chatConfig.output = {
  filename: '[name].js',
  path: path.resolve(dirname, './dist'),
  clean: true,
};

// Override dev server configuration
chatConfig.devServer = {
  static: path.join(dirname, "./dist"),
  compress: true,
  port: 11986, // Different port for chat app
  allowedHosts: 'all',
  hot: false, // Disable hot module replacement completely
  liveReload: false, // Disable live reload to prevent constant refreshing
  client: {
    logging: 'warn',
    reconnect: false,
  },
};

// Find the existing CopyWebpackPlugin and modify its patterns
const copyPlugin = chatConfig.plugins.find(plugin => plugin instanceof CopyWebpackPlugin);
if (copyPlugin) {
  // Remove the default index.html from the patterns
  copyPlugin.patterns = copyPlugin.patterns.filter(pattern => !pattern.from.includes('index.html'));
  
  // Add our custom index.html
  copyPlugin.patterns.push({ from: './apps/chat/index.html' });
  // Copy chat specific assets (css)
  copyPlugin.patterns.push({ from: './apps/chat/chat.css' });
}

export default chatConfig;