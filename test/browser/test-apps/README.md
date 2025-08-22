# Test Applications Directory

This directory contains dedicated web applications for testing specific aspects of the Verity library in real browsers.

Each test application is minimal, focused, and comes with testCoreOptions built-in for optimal performance.

## Test Applications

- **full-node/**: Full Verity node with all capabilities
- **light-node/**: Light Verity node for client-side testing  
- **chat/**: Chat functionality testing with message cubes
- **webrtc/**: WebRTC P2P connectivity and data channels

## Key Features

- **Built-in testCoreOptions**: All apps initialize with performance optimizations
- **Library-focused**: Test core Verity functionality, not demo UI
- **Minimal overhead**: Direct library usage without UI framework dependencies
- **Playwright-optimized**: Designed specifically for automated testing

## Build System

Uses dedicated webpack configuration (`webpack.test.mjs`) that:
- Creates separate bundles for each test application
- Serves on port 11985 (separate from main demo app)
- Copies HTML/CSS assets to test-dist directory
- Enables hot reloading for test development