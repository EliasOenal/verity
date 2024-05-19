import { createRequire } from 'node:module';
import path from 'path';
import webpack from 'webpack';
import CopyWebpackPlugin from 'copy-webpack-plugin';

const { resolve } = createRequire(import.meta.url);
const __dirname = path.dirname(new URL(import.meta.url).pathname);

export default {
  target: 'web',
  entry: {
    verityUI: './src/app/zw/main.ts',
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
      url: resolve('url'),
      fs: false,
      crypto: false,  // using native web crypto api
      buffer: resolve('buffer'),
      stream: resolve('stream-browserify'),
      "events": resolve("events/"),
    },
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
