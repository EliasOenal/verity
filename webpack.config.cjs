const path = require('path');
const CopyWebpackPlugin = require("copy-webpack-plugin");
const webpack = require('webpack');

module.exports = {
  target: 'web',
  entry: {
    "fullNode-bundle": './src/fullNode.ts',
    webuievents: './webui/webuievents.ts'
  },
  mode: 'development',
  module: {
    rules: [
      {
        test: /\.ts?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
    fallback: {
      // Use can only include required modules. Also install the package.
      // for example: npm install --save-dev assert
      url: require.resolve('url'),
      fs: require.resolve('fs'),
      //assert: require.resolve('assert'),
      crypto: require.resolve('crypto-browserify'),
      http: require.resolve('stream-http'),
      //https: require.resolve('https-browserify'),
      //os: require.resolve('os-browserify/browser'),
      buffer: require.resolve('buffer'),
      stream: require.resolve('stream-browserify'),
      "util": require.resolve("util/"),
      "path": require.resolve("path-browserify"),
      "tty": require.resolve("tty-browserify"),
      "path": require.resolve("path-browserify"),
      //"net": require.resolve("net-browserify"),
      "timers": require.resolve("timers-browserify"),
      "events": require.resolve("events/"),
    }
  },
  externals: {
    bufferutil: "bufferutil",
    "utf-8-validate": "utf-8-validate",
    fs: "fs",
  },
  output: {
    filename: '[name].js',
    path: path.resolve(__dirname, 'distweb'),
  },
  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        { from: './webui/index.html' },
	      { from: './img/vera_250px_nobg.png' },
      ]
    }),
   new webpack.ProvidePlugin({
	// Make a global `process` variable that points to the `process` package,
	// because the `util` package expects there to be a global variable named `process`.
	// Thanks to https://stackoverflow.com/a/65018686/14239942
	//process: 'process/browser',
   }),
   new webpack.IgnorePlugin({
    resourceRegExp: /nodespecific/,
   })
  ],
  devServer: {
    static: path.join(__dirname, "distweb"),
    compress: true,
    port: 4000,
  },
};
