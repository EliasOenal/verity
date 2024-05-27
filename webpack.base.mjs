import { createRequire } from 'node:module';
import path from 'path';
import webpack from 'webpack';

const { resolve } = createRequire(import.meta.url);
const __dirname = path.dirname(new URL(import.meta.url).pathname);

export const commonConfig = {
  mode: 'development',
  module: {
    rules: [
      {
        test: /\.ts?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
      {
        test: /\.html$/,
        use: 'raw-loader',
        exclude: ["/node_modules/", "/src/webui/static/"],
      },
      {
        test: /\.css$/,
        use: 'raw-loader',
        exclude: ["/node_modules/", "/src/webui/static/"],
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
      events: resolve("events/"),
      "process/browser": resolve("process/browser"),
    },
  },
  externals: {
    bufferutil: "bufferutil",
    "utf-8-validate": "utf-8-validate",
    // fs: "fs",
  },
  plugins: [
    new webpack.ProvidePlugin({
      // Make a global `process` variable that points to the `process` package,
      // because the `util` package expects there to be a global variable named `process`.
      // Thanks to https://stackoverflow.com/a/65018686/14239942
      process: 'process/browser',
    }),
    new webpack.IgnorePlugin({
      resourceRegExp: /nodespecific/,
    }),
  ],
  output: {
    filename: '[name].js',
    path: path.resolve(__dirname, 'distweb'),
  },
  target: 'web',
  entry: {
    verityUI: './src/main.ts',
  },
  devServer: {
    static: path.join(__dirname, "distweb"),
    compress: true,
    port: 11984,
  },
};
