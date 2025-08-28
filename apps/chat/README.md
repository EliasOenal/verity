<img src='../../img/vera.svg' width='120'>

# Verity Chat (Standalone App)

This folder contains Verity Chat, a demo built on top of the Verity platform. It showcases messaging using Verity cube data structures.

## Features
* Minimal responsive UI
* Handles offline and online messaging
* Uses the shared Verity core and CCI library

## Directory Layout
```
apps/chat/
	index.html          # Static HTML shell copied to dist
	chat.css            # Chat-specific styles
	src/
		main.ts           # Entry point (bundled as chatApp.js)
		chatAppController.ts
		local/
			localChatController.ts
			chatStorage.ts
	dist/               # Generated build output
	webpack.config.mjs  # Dev / baseline config (source maps, no minification)
	webpack.prod.config.mjs # Production build tweaks (minify, no devtool)
	README.md           # This file
```

## Prerequisites
From the project root:
```bash
npm install
```

If you want a local supporting Verity node (optional for some purely local tests):
```bash
npm run build
npm run start -- -w 1984
```
Then the Chat app can connect to that node (adjust port/flags as needed).

## NPM Scripts
The root `package.json` defines dedicated scripts for this app:

| Script | Purpose |
| ------ | ------- |
| `npm run chat:serve` | Start dev server on http://localhost:11986/ with live (manual) refresh. |
| `npm run chat:build` | One-off development build (unminified, source maps) into `apps/chat/dist/`. |
| `npm run chat:build:prod` | Production build (minified) into `apps/chat/dist/`. |

## Production Build
Generate an optimized, minified bundle:
```bash
npm run chat:build:prod
```
Artifacts appear in `apps/chat/dist/`. Deploy by serving that directory’s static files with any web server.
