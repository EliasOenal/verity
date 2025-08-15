# Build Performance Optimization Guide

This document provides guidance on optimizing build and dependency installation performance for the Verity project.

## NPM Install Optimization

### Quick Install Commands
For fastest dependency installation, use these commands:

```bash
# First-time install or after package.json changes
npm ci --no-audit --no-fund

# Regular development (when package-lock.json exists)
npm ci
```

**Why `npm ci` instead of `npm install`?**
- `npm ci` is 2-3x faster than `npm install`
- Uses package-lock.json for reproducible builds
- Skips unnecessary dependency resolution
- Used by GitHub Actions CI

### Performance Settings
The project includes a `.npmrc` file with optimized settings:
- `audit=false` - Skips security audit during install (run `npm audit` separately if needed)
- `fund=false` - Disables funding messages
- `maxsockets=10` - Enables parallel downloading
- `prefer-offline=true` - Uses local cache when available
- `progress=false` - Disables progress bars for cleaner CI output

### Dependency Optimization
Recent optimizations removed unused dependencies:
- Removed `@types/eslint__js` (not used in source)
- Removed `@types/ws` (not used in source)  
- Removed `libsodium-wrappers` (redundant with `libsodium-wrappers-sumo`)
- Removed `@libp2p/mplex` (using `@chainsafe/libp2p-yamux` instead)
- Removed `@types/libsodium-wrappers` (redundant with sumo types)

This reduced total dependencies from 57 to 52 packages.

## Build Performance

### Recommended Build Sequence
```bash
# Install dependencies (3-4 minutes first time)
npm ci

# Build TypeScript (7 seconds) 
npm run build

# Run tests (3-4 minutes)
npm test

# Start development server (11 seconds)
npm run server
```

### Caching Strategy

#### For GitHub Actions/CI
The project's CI workflow uses:
```yaml
- name: Use Node.js
  uses: actions/setup-node@v4
  with:
    node-version: 24
    cache: 'npm'  # Automatic npm cache

- name: Install Dependencies  
  run: npm ci
```

#### For Local Development
Consider using npm cache and package caching:
```bash
# Check npm cache location
npm config get cache

# Clean cache if needed
npm cache clean --force

# Verify cache
npm cache verify
```

## Performance Benchmarks

| Operation | Time | Notes |
|-----------|------|--------|
| `npm ci` (first time) | ~4 minutes | Downloads 1122+ packages (420MB) |
| `npm ci` (cached) | ~30-60 seconds | Uses local cache |
| `npm run build` | ~7 seconds | TypeScript compilation |
| `npm test` | ~3-4 minutes | Runs 900+ tests |
| `npm run server` | ~11 seconds | Webpack dev server startup |

## Troubleshooting

### Slow Install Issues
1. **Use `npm ci` instead of `npm install`**
2. **Clear cache**: `npm cache clean --force`
3. **Check network**: Slow networks affect download times
4. **Use .npmrc settings**: Ensure `.npmrc` optimizations are applied
5. **Check Node version**: Use Node.js 24+ as specified in `.nvmrc`

### Memory Issues
If builds fail with memory issues:
```bash
# Increase Node.js memory limit
export NODE_OPTIONS="--max-old-space-size=4096"
npm run build
```

### CI/CD Optimization
For GitHub Actions or other CI systems:
- Use `npm ci` for reproducible builds
- Enable dependency caching
- Set appropriate timeouts (2-5 minutes for install)
- Use parallel job execution where possible

## Additional Tips

1. **Keep package-lock.json**: Always commit `package-lock.json` for reproducible builds
2. **Regular dependency updates**: Use `npm update` periodically to get performance improvements
3. **Monitor bundle size**: Use `npm run webpack` to check build output size
4. **Profile builds**: Use `npm run build -- --verbose` for detailed build timing