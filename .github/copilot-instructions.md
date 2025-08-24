# Verity - Decentralized Data Storage Platform

Verity is a decentralized and censorship-resistant data storage and distribution platform built with TypeScript/Node.js. It uses unique "cube" structures (1kB data blocks) synchronized across peer-to-peer nodes. The project includes both a support node (CLI) and a web application demo.

**ALWAYS follow these instructions first and only fallback to search or bash commands when you encounter information that contradicts or is missing from these instructions.**

## Working Effectively
**You have a total runtime of 59 minutes per session, make the most of it. Only exit sessions early if your task is truly finished. If in doubt, utilize additional time for verification and further improvements.**

### Bootstrap and Build the Repository
**CRITICAL: NEVER CANCEL long-running commands. Builds and tests may take several minutes.**

1. **Install Dependencies:**
   ```bash
   npm install
   ```
   - **NEVER CANCEL: Takes 8+ minutes to complete.** Set timeout to 15+ minutes.
   - Should have been called by environment initialization

2. **Build TypeScript Code:**
   ```bash
   npm run build
   ```
   - Fast: ~10 seconds
   - Should complete successfully

3. **Run Node.js Tests:**
   ```bash
   npm run test -- --workers=4
   ```
   - **NEVER CANCEL: Takes 3+ minutes to complete.** Set timeout to 10+ minutes.
   - Runs all 80+ test files with 4500+ tests using vitest
   - This command is used in CI (GitHub Actions)
   - Should pass consistently

4. **Run Playwright Tests:**
   ```bash
   npm run test:playwright -- --workers=4
   ```
   - **NEVER CANCEL: Takes 2+ minutes to complete.** Set timeout to 10+ minutes.
   - Runs all 35+ tests using playwright
   - This command is used in CI (GitHub Actions)
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
npm run start -- -w 1984
```
- Runs a full Verity network node on port 1984
- May not have connectivity to some trackers (normal)
- Use Ctrl+C to stop

#### Web Demo Application Development Server
```bash
npm run server
```
- Runs webpack dev server on http://localhost:11984/
- Should serve content successfully
- Use Ctrl+C to stop

#### Web Playwright Test Application Development Server
```bash
npm run server
```
- Runs webpack dev server on http://localhost:11985/
- Should serve Verity Chat Test Environment successfully
- Used as base for playwright tests
- Use Ctrl+C to stop

#### Web Demo Application Build
```bash
npm run webpack
```
- The development server (`npm run server`) is preferred for development
- Takes ~9 seconds to run

## Validation Requirements

### Always Run These Validation Steps After Changes
1. **Build Check:** `npm run build` - should complete successfully
2. **Test Suite:** `npm test` - should pass consistently
3. **Support Node:** `npm run start -- -w 1984` - must start successfully and show ASCII art
4. **Development Server:** `npm run server` - should serve content successfully

### Manual Validation Scenarios

Always act in good faith, be completely objective and answer honestly.
If 13 out of 30 tests fail:
- Do not state: "30 tests executing."
- Instead state clearly "Out of 30 tests, 13 fail and 17 pass."

You sometimes will be in a situation where you can't finish the goal in one go. If this happens, provide a clear explanation of what was implemented and what tasks still remain. You're doing this for your future self to have any easier time picking up the work again. In the same spirit you may also provide additonal technical comments on your findings that will help in future analysis.

**Validate changes by:**
1. Running the support node and verifying it starts and displays the ASCII art logo
2. Running the development server and checking it serves content on http://localhost:11984/
   - **The web application should load successfully**
   - Application shows the basic Verity UI structure
   - Service worker registration succeeds
3. Running the full test suite and ensuring no new test failures
4. Testing any cube operations, identity management, or networking features through the test suite

## Committing and merging
- Commit message style: When appropriate, prefix your commit messages with the name of the changed component. This could be a class name (e.g. "CubeStore: ..."), a class and method name (e.g. "Cube.Create(): ...", or even the name of a collection of functions and the one you changed (e.g. "AsyncGenerator helper parallelMap(): ..."). When the changed component is part of a larger unit of components, e.g. the WebUI, prefix as appropriate, e.g. "WebUI IdentityController: Refactor initialiseIdentity()".
- Commit squashing: Unless semantically meaningful, no more than a single commit should be merged into main per pull request. You can and should squash your commits once your work is otherwise complete. Do not merge non-descript commits like "Initial plan" into main.

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
- **npm test:** 3+ minutes (should pass consistently) - **NEVER CANCEL**
- **npm run test\:playwright\:** 2+ minutes (should pass consistently) - **NEVER CANCEL**
- **npm run lint:** ~8 seconds (1900+ errors but exits successfully)
- **npm run server:** ~15 seconds to start (should serve successfully)
- **npm run test\:server\:** ~15 seconds to start (should serve successfully)
- **npm run webpack:** ~9 seconds (may have some compilation issues with specific modules)

### Known Issues
- **1900+ linting errors** - do not attempt to fix unless specifically requested

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

### If webpack build shows TypeScript errors:
- The development server may still work despite compilation errors
- Use `npm run server` for development instead of building directly
- Focus testing on the support node and test suite

### If support node fails to start:
- Ensure port 1984 is available
- Should display ASCII art logo when starting successfully

**Always prioritize working functionality (support node, tests, development server, build) over any remaining minor issues.**

## Critical Testing and Development Guidelines

### Test-First Development Approach
**CRITICAL: All functionality changes MUST be thoroughly tested with comprehensive end-to-end workflows before considering them complete.**

1. **Complete Workflow Testing:** When working on P2P or networking features, ALWAYS test the complete offline → connect → upload → disconnect → reconnect → retrieve workflow. Partial testing is insufficient.

2. **Cross-Browser P2P Validation:** For any P2P functionality:
   - Test with multiple browser instances connecting to the same node
   - Verify cube synchronization works across disconnections and reconnections
   - Manually validate the exact scenario: Browser1 creates cube → disconnects → Browser2 connects → retrieves cube

3. **Never Trust Surface-Level Success:** If UI shows "success" but core functionality fails, investigate deeper. Status indicators must reflect actual system state, not optimistic assumptions.

### Manual Testing Requirements

**MANDATORY before declaring any P2P feature complete:**
1. Start support node: `npm run start -- -w 1984`
2. Open Browser 1, connect to support node, create/send content
3. Disconnect Browser 1
4. Open Browser 2, connect to same support node
5. Verify Browser 2 retrieves content from Browser 1
6. Test UI consistency - status should accurately reflect connection state

### Test Coverage Standards

**Playwright tests MUST cover:**
- Complete user workflows, not just individual operations  
- UI state consistency (peer counts, connection status, etc.)
- Cross-browser synchronization scenarios
- Proper error handling and recovery
- Both light node and full node behaviors appropriately

**Tests should FAIL immediately when:**
- Core P2P functionality breaks
- Status displays become inconsistent with actual state
- Cross-browser cube synchronization fails
- Node types behave incorrectly (light nodes downloading everything)

### Development Iteration Protocol

1. **Start with manual testing** of the complete workflow
2. **Write failing tests** that demonstrate the issue
3. **Implement fixes** incrementally
4. **Re-test manually** after each change
5. **Verify automated tests** catch the original issue
6. **Only proceed** when both manual and automated validation pass

## File Management and Git Best Practices

### Files That Should NEVER Be Committed
- **Playwright generated files**: `playwright-report/`, `test-results/`
- **Build artifacts**: `dist/`, `build/`, `coverage/`
- **Dependencies**: `node_modules/`
- **IDE files**: `.vscode/`, `.idea/`
- **Temporary files**: `/tmp/` contents, any temporary scripts created during development

### Repository File Guidelines
- Only commit source code, configuration files, and documentation that belong to the repository
- Generated test reports and artifacts are excluded by `.gitignore` and should not be committed
- Use `git status` to verify only intended files are staged before committing
- If accidentally committed, use `git rm` to remove them and include the removal in the commit

### Using testCoreOptions for Performance
When creating tests that use CoreNode or CubeStore instances:
- Import `testCoreOptions` from `test/core/testcore.definition.ts`
- Use `{...testCoreOptions, ...specificOptions}` when creating CoreNode or CubeStore instances
- For browser tests, use the optimized `initializeVerityInBrowser()` function which automatically applies test optimizations
- testCoreOptions provide faster execution with `inMemory: true`, `requiredDifficulty: 0`, `networkTimeoutMillis: 100`, and other performance settings

## Environment and Tools

### Environment Runtime
**Each session of your Linux VM environment lasts 59 minutes — use the full time. Only end early if the task is fully complete; otherwise, use remaining time for checks and improvements.**

### Bash Tool
- Your bash tool has a limited execution time of 600 seconds (10 minutes).
- After the timeout, it detaches to background. Use `read_bash` to re-attach and continue working, or `stop_bash` to abort.
- After 'stop_bash', processes may be left in background, blocking network ports.

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
