const path = require('path');
const CopyWebpackPlugin = require("copy-webpack-plugin");
const webpack = require('webpack');

module.exports = {
  target: 'web',
  entry: {
    verityUI: './src/webui/verityUI.ts',
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
      // fs: require.resolve('fs'),
      fs: false,
      //assert: require.resolve('assert'),
      // crypto: require.resolve('crypto-browserify'),
      crypto: false,  // using native web crypto api
      // http: require.resolve('stream-http'),
      //https: require.resolve('https-browserify'),
      //os: require.resolve('os-browserify/browser'),
      buffer: require.resolve('buffer'),
      stream: require.resolve('stream-browserify'),
      // "util": require.resolve("util/"),
      // "path": require.resolve("path-browserify"),
      // "tty": require.resolve("tty-browserify"),
      //"net": require.resolve("net-browserify"),
      // "timers": require.resolve("timers-browserify"),
      "events": require.resolve("events/"),
    }
  },
  externals: {
    bufferutil: "bufferutil",
    "utf-8-validate": "utf-8-validate",
    // fs: "fs",
  },
  output: {
    filename: '[name].js',
    path: path.resolve(__dirname, 'distweb'),
  },
  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        { from: './src/webui/static/index.html' },
        { from: './src/webui/static/style.css' },
        { from: './src/webui/static/frontend.js' },  // alternatively, we could write that in Typescript and make it a second bundle
	      { from: './img/vera.svg' },
        { from: './img/unknownuser.svg' },
        { from: './img/bootstrap.bundle.min.js' },
        { from: './img/bootstrap.min.css' },
        { from: './img/bootstrap-icons.min.css' },
        { from: './img/bootstrap-icons.woff', to: 'fonts/bootstrap-icons.woff' },
      ]
    }),
   new webpack.ProvidePlugin({
	   // Make a global `process` variable that points to the `process` package,
	   // because the `util` package expects there to be a global variable named `process`.
	   // Thanks to https://stackoverflow.com/a/65018686/14239942
	   process: 'process/browser',
   }),
   new webpack.IgnorePlugin({
    resourceRegExp: /nodespecific/,
   })
  ],
  devServer: {
    static: path.join(__dirname, "distweb"),
    compress: true,
    port: 11984,
  },
};
