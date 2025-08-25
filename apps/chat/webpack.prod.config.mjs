import baseConfig from './webpack.config.mjs';

// Clone the base (dev) config and adjust for production/minified output
const prodConfig = {
  ...baseConfig,
  mode: 'production',
  devtool: false,
  output: {
    ...baseConfig.output,
    filename: '[name].js', // consistent name chatApp.js for dev/prod
  },
  optimization: {
    minimize: true,
    // Keep splitting disabled for a single-file style bundle if possible
    splitChunks: false,
    runtimeChunk: false,
  },
};

export default prodConfig;
