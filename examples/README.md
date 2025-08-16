# Verity Examples

This directory contains example code that demonstrates how to build applications using Verity. These examples show the intended API usage patterns and best practices.

## Examples Included

1. **[Basic Usage](basic-usage.ts)** - Simple cube creation and retrieval
2. **[Identity Management](identity-example.ts)** - Creating and managing identities
3. **[Chat Application](chat-example.ts)** - Real-time messaging using notifications
4. **[File Sharing](file-sharing-example.ts)** - Sharing files across the network
5. **[Microblogging](microblog-example.ts)** - Twitter-like social posts

## Working Examples

The best working examples are the actual applications included with Verity:

- **Chat Application**: `src/app/chatApplication.ts`
- **File Application**: `src/app/fileApplication.ts`  
- **Microblogging (ZW)**: `src/app/zw/` directory

These are production applications that demonstrate real-world usage patterns.

## Running Examples

### Viewing the Included Applications

```bash
# Build the project
npm run build

# Run the microblogging web app
npm run server
# Then visit http://localhost:11984/

# Run a support node
npm run start -- -w 1984 -t
```

### Studying the Code

The example TypeScript files in this directory show the intended API patterns. To understand how they work in practice, examine:

1. **Test files**: `test/app/` and `test/cci/` directories
2. **Application implementations**: `src/app/` directory
3. **Working web application**: `src/app/zw/` and `src/webui/`

## Example Structure

Each example follows this pattern:

1. **Setup** - Create a Verity node and any required identities
2. **Demonstration** - Show the specific functionality
3. **Cleanup** - Properly shutdown resources

## Integration with Your Application

You can use these examples as reference for building your own applications. The examples are designed to be:

- **Educational** - Clear explanations of each step
- **Well-commented** - Detailed comments explaining the concepts
- **Realistic** - Based on actual application patterns
- **Modular** - Easy to extract specific functionality

## Notes

- Examples show intended API usage patterns
- For guaranteed working code, see the included applications
- Network connectivity warnings are normal in sandboxed environments  
- See the [Developer Guide](../doc/developer-guide.md) for more detailed explanations
- Refer to the [API Reference](../doc/api-reference.md) for complete method documentation