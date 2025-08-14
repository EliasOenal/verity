# Verity - Decentralized Data Storage Platform

Verity is a decentralized and censorship-resistant data storage and distribution platform built with TypeScript/Node.js. It uses unique "cube" structures (1kB data blocks) synchronized across peer-to-peer nodes. The project includes both a support node (CLI) and a microblogging web application demo.

**ALWAYS follow these instructions first and only fallback to search or bash commands when you encounter information that contradicts or is missing from these instructions.**

## Working Effectively

### Bootstrap and Build the Repository
**CRITICAL: NEVER CANCEL long-running commands. Builds and tests may take several minutes.**

1. **Install Dependencies:**
   ```bash
   npm install
   ```
   - **NEVER CANCEL: Takes 8+ minutes to complete.** Set timeout to 15+ minutes.
   - Shows deprecated package warnings (this is normal)

2. **Build TypeScript Code:**
   ```bash
   npm run build
   ```
   - Fast: ~7 seconds
   - Should complete successfully

3. **Run Tests:**
   ```bash
   npm test
   ```
   - **NEVER CANCEL: Takes 3+ minutes to complete.** Set timeout to 10+ minutes.
   - Runs all 78 test files with 900+ tests using vitest
   - Should pass with only occasional flaky test failures

4. **Run Subset of Tests (CI Command):**
   ```bash
   npm test -- --run test/core/ test/cci/ test/web/controller/ test/app/zw/model/
   ```
   - Skips slow UI tests
   - This is the command used in CI (GitHub Actions)
   - Should pass consistently

4. **Lint Code:**
   ```bash
   npm run lint
   ```
   - Fast: ~8 seconds
   - **Currently has 1900+ linting errors** - this is known and expected
   - DO NOT attempt to fix all linting errors unless specifically asked
   - Linter exits successfully despite the errors

### Run the Applications

#### Support Node (CLI Application)
```bash
npm run start -- -w 1984 -t
```
- Runs a full Verity network node on port 1984
- Will show network connectivity warnings in sandboxed environments (normal)
- Use Ctrl+C to stop

#### Web Application Development Server
```bash
npm run server
```
- Runs webpack dev server on http://localhost:11984/
- Should serve content successfully
- Use Ctrl+C to stop

#### Web Application Build (HAS MINOR ISSUES)
```bash
npm run webpack
```
- **May have some TypeScript compilation issues with specific files**
- Generally works but may show errors for certain modules
- The development server (`npm run server`) is preferred for development
- Takes ~9 seconds to fail

## Validation Requirements

### Always Run These Validation Steps After Changes
1. **Build Check:** `npm run build` - should complete successfully
2. **Test Suite:** `npm test` - should pass with only occasional flaky test failures  
3. **Support Node:** `npm run start -- -w 1984 -t` - must start successfully and show ASCII art
4. **Development Server:** `npm run server` - should serve content successfully

### Manual Validation Scenarios
**Validate changes by:**
1. Running the support node and verifying it starts and displays the ASCII art logo
2. Running the development server and checking it serves content on http://localhost:11984/
   - **The web application should load successfully**
   - Application shows the basic Verity UI structure
   - Service worker registration succeeds
3. Running the full test suite and ensuring no new test failures beyond occasional flaky tests
4. Testing any cube operations, identity management, or networking features through the test suite

## Repository Structure and Key Locations

### Core Source Code (`/src/`)
- `src/core/` - Core cube storage, networking, and peer management
- `src/cci/` - Common Cube Interface (main API layer)
- `src/webui/` - Web UI components and controllers
- `src/app/zw/` - Microblogging application implementation
- `src/index.ts` - Main library exports

### Tests (`/test/`)
- `test/core/` - Core functionality tests
- `test/cci/` - CCI layer tests  
- `test/web/` - Web UI and controller tests
- `test/app/` - Application-specific tests

### Key Files
- `package.json` - Dependencies and scripts
- `tsconfig.json` / `tsconfig.build.json` - TypeScript configuration
- `vitest.config.ts` - Test configuration
- `webpack.base.mjs` / `webpack.config.mjs` - Webpack configuration (has issues)
- `eslint.config.mjs` - ESLint configuration
- `Dockerfile` - Container build configuration

## Common Development Tasks

### Testing Cube Operations
- Use test files in `test/cci/cube/` for cube creation, compilation, and validation
- Tests cover all cube types: PIC, MUC, PMUC with various field types

### Testing Identity Management
- Use test files in `test/cci/identity/` for identity creation and management
- Covers encryption, signatures, and identity store operations

### Testing Network Operations
- Use test files in `test/core/networking/` for peer connections and data sync
- Covers WebSocket transport, libp2p integration, and cube retrieval

### Making UI Changes
- Web UI tests are in `test/web/ui/` but may be slow
- Use the development server for rapid iteration
- Test identity login/logout workflows manually

## Critical Build Information

### Timing Expectations
- **npm install:** 8+ minutes - **NEVER CANCEL**
- **npm run build:** ~7 seconds (should complete successfully)
- **npm test:** 3+ minutes (should pass with only occasional flaky failures) - **NEVER CANCEL**  
- **npm run lint:** ~8 seconds (1900+ errors but exits successfully)
- **npm run server:** ~11 seconds to start (should serve successfully)
- **npm run webpack:** ~9 seconds (may have some compilation issues with specific modules)

### Known Issues
- **Some webpack compilation issues** may occur with specific TypeScript modules
- **1900+ linting errors** - do not attempt to fix unless specifically requested
- **Occasional flaky test failures** - these are expected and documented in test files
- **Network connectivity warnings** in sandboxed environments (normal for support node)

### Dependencies
- **Node.js 20+** required
- All required packages install automatically with `npm install`
- Uses libp2p, WebSockets, libsodium for cryptography
- Frontend uses Bootstrap, TypeScript, webpack

## Troubleshooting

### If TypeScript build fails:
- Check for missing dependencies or type compatibility issues
- Ensure all imports are correctly resolved
- The support node and tests should still work for most functionality

### If tests fail with occasional flaky failures:
- This is expected for some tests that have timing dependencies
- Look for "TODO FIXME" comments in failing tests
- Core functionality tests for cubes and identity should work consistently

### If webpack build shows TypeScript errors:
- The development server may still work despite compilation errors
- Use `npm run server` for development instead of building directly
- Focus testing on the support node and test suite

### If support node fails to start:
- Ensure port 1984 is available
- Network connectivity warnings are normal in sandboxed environments
- Should display ASCII art logo when starting successfully

**Always prioritize working functionality (support node, tests, development server, build) over any remaining minor issues.**

## Common Output Examples

### Expected npm install output (successful):
```
npm install
# Shows deprecation warnings, then:
added 1060 packages, and audited 1061 packages in 8m
found 0 vulnerabilities
```

### Expected npm run start output (successful):
```
npm run start -- -w 1984 -t
# Shows ASCII art logo, then:
[INFO]: Starting full node
[TRACE]: WebSocketServer: stated on :::1984
[DEBUG]: WebSocketServer: Server is listening on :::1984.
[WARN]: Error occurred while announcing... (network warnings are normal)
```

### Expected npm run server output (works despite errors):
```
npm run server
# Shows webpack compilation with 3 errors, then:
webpack 5.101.2 compiled with 3 errors in 11126 ms
# Server serves on http://localhost:11984/ - app loads and works
```