import { defineConfig } from "vite";
import path from "path";
import pkg from "./package.json" assert { type: "json" };
import glob from "fast-glob";

const entries = Object.fromEntries(
  glob.sync("src/**/*.ts").map(file => [
    file.replace(/^src\//, "").replace(/\.ts$/, ""),
    path.resolve(__dirname, file)
  ])
);

export default defineConfig({
  build: {
    ssr: true, // build for NodeJS
    lib: {
      entry: entries,
      formats: ["es"],
      fileName: () => "verity.js",
    },
    rollupOptions: {
      output: {
        preserveModules: true,
        preserveModulesRoot: "src",
      },
      external: [
        // Node built-ins
        "fs",
        "fs/promises",
        "path",
        "crypto",
        "https",
        "url",
        "events",
        "stream",
        "buffer",
        "process",

        // Excluide all dependencies from package.json...
        ...Object.keys(pkg.dependencies)
      ],
    },
    sourcemap: true,
  },
});
