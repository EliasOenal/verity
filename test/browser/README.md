# Verity Browser Testing with Playwright

This directory contains comprehensive browser testing for Verity using Playwright to test functionality in real browser environments.

## Migration from JSDOM to Playwright

The browser tests have been migrated from JSDOM + fake-indexeddb simulation to real browser testing using Playwright. This provides:

- **Real Browser Environment**: Tests run in actual Chromium/Firefox/Safari browsers
- **Authentic Browser APIs**: Real IndexedDB, WebRTC, Web Workers, Service Workers
- **Multi-Node Testing**: Support for testing multiple browser instances concurrently
- **Extended Coverage**: Comprehensive testing beyond the original scope

## Test Structure

### Core Browser Tests (Playwright)
- `basic-environment.playwright.test.ts` - Browser environment and API verification
- `basic-node.playwright.test.ts` - Basic Verity node functionality in browser
- `connectivity.playwright.test.ts` - Multi-node connectivity and communication
- `extended-browser.playwright.test.ts` - Extended browser-specific functionality

### Utilities
- `playwright-utils.ts` - Helper functions for browser testing

### Legacy Tests (JSDOM-based)
- `basic-environment.test.ts` - Legacy JSDOM environment test
- `basic-node.test.ts` - Legacy JSDOM node test  
- `connectivity.test.ts` - Legacy JSDOM connectivity test
- `browser-test-utils.ts` - Legacy JSDOM utilities

## Running Tests

### Playwright Tests (Recommended)
```bash
# Run all Playwright browser tests
npm run test:playwright

# Run specific test file
npx playwright test basic-environment.playwright.test.ts

# Run with UI (interactive mode)
npm run test:playwright:ui

# Run specific test group
npx playwright test -g "Extended Verity Browser Testing"
```

### Legacy JSDOM Tests
```bash
# Run legacy browser tests
npm run test:browser
```

## Test Coverage

### Basic Browser Environment
- ✅ Verity web application loading
- ✅ Browser API availability (IndexedDB, WebRTC, Crypto, localStorage)
- ✅ Verity node initialization and configuration
- ✅ Page refresh and node reinitialization

### Node Functionality
- ✅ Browser node creation and configuration
- ✅ Cube storage and retrieval operations
- ✅ Multiple cube handling and uniqueness
- ✅ Storage persistence across operations
- ✅ Node identity and uniqueness verification

### Multi-Node Connectivity
- ✅ Multiple independent browser nodes
- ✅ Independent cube storage between nodes
- ✅ Browser-specific transport configuration
- ✅ Concurrent cube operations across nodes
- ✅ Multi-node scenario simulation (2 browser + 1 server node)

### Extended Browser Features
- ✅ IndexedDB integration and storage capabilities
- ✅ WebRTC and P2P functionality testing
- ✅ Crypto API verification (hashing, key generation, signing)
- ✅ Web Worker functionality for heavy operations
- ✅ Service Worker integration testing
- ✅ Multiple browser tabs/contexts
- ✅ Stress testing with rapid cube operations
- ✅ Memory usage and cleanup verification

## Configuration

The Playwright configuration is in `playwright.config.ts`:

- **Test Directory**: `./test/browser`
- **Base URL**: `http://localhost:11984` (webpack dev server)
- **Browser**: Chromium (with support for Firefox/Safari)
- **Web Server**: Automatically starts `npm run server`

## Browser Node Architecture

Browser nodes in Verity are configured as:
- **Light Nodes**: Optimized for browser environments
- **In-Memory Storage**: Fast, ephemeral storage (with optional IndexedDB persistence)
- **WebRTC Transport**: P2P communication capability
- **Independent Operation**: Each browser instance runs an independent node

## Multi-Node Testing Scenarios

The tests verify the original requirement: "two browser nodes connected to one Node.js full node concurrently":

1. **Browser Node 1**: Independent Verity node in first browser context
2. **Browser Node 2**: Independent Verity node in second browser context  
3. **Server Node**: The webpack dev server acts as the connection point
4. **Concurrent Operations**: Simultaneous cube creation and storage
5. **Independent Storage**: Each node maintains separate cube stores

## Implementation Notes

### Cube Creation
Cubes are created using the Verity cockpit's `prepareVeritum()` method:
```typescript
const cockpit = window.verity.cockpit;
const veritum = cockpit.prepareVeritum();
await veritum.compile();
const cubes = Array.from(veritum.chunks);
await window.verity.node.cubeStore.addCube(cubes[0]);
```

### Unique Cube Creation
The tests create cubes with unique content and timing to ensure semantic meaningfulness, demonstrating proper multi-node scenarios where different nodes create different cubes.

### Browser API Integration
Tests verify integration with browser-specific APIs:
- **IndexedDB**: For persistent storage
- **WebRTC**: For P2P communication
- **Web Workers**: For heavy cryptographic operations
- **Service Workers**: For offline capability
- **Crypto API**: For cryptographic operations

## Future Enhancements

Potential areas for expansion:
- Network connectivity testing with real peer connections
- Performance benchmarking in browser environments  
- Cross-browser compatibility testing (Firefox, Safari)
- Mobile browser testing
- Offline functionality testing
- Large-scale multi-node scenarios

## Troubleshooting

### Common Issues
1. **Server not starting**: Ensure webpack dev server is running on port 11984
2. **Browser API failures**: Check browser support for modern APIs
3. **Timing issues**: Increase timeouts for slow operations
4. **Memory leaks**: Use proper cleanup in test teardown

### Debug Mode
Run tests with debug output:
```bash
DEBUG=pw:api npx playwright test
```

View test traces:
```bash
npx playwright show-trace test-results/[test-name]/trace.zip
```