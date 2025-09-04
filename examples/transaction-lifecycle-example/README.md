# Transaction Lifecycle Example

This example demonstrates proper async transaction handling patterns to avoid race conditions in sequential workflows with the TN SDK.

## Key Learning Points

- **Critical Understanding**: TN operations return success when transactions enter the mempool, NOT when they're executed on-chain
- Use `waitForTx()` for operations where order matters (deployments, deletions, dependent operations)
- Balance between safety (`waitForTx`) and performance (async) based on your use case
- Always check transaction results and handle errors properly

## What This Example Demonstrates

### 1. Safe Stream Deployment
Shows proper pattern for deploying streams and waiting for confirmation before dependent operations.

### 2. Sequential Operation Patterns
Compares fire-and-forget (async) vs confirmed (synchronous) record insertion patterns.

### 3. Stream Destruction with Verification
Demonstrates safe stream destruction and verification that operations fail after destruction.

### 4. Error Handling and Race Condition Detection
Shows how to detect and handle race conditions that can occur with async operations.

## Running the Example

### Prerequisites
- Node.js 18 or later
- Valid Ethereum private key
- Access to TN network (mainnet or local node)

### Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set environment variables (optional):**
   ```bash
   export PRIVATE_KEY="your-private-key-here"
   export TN_ENDPOINT="https://gateway.mainnet.truf.network"  # or your local endpoint
   ```

3. **Run the example:**
   ```bash
   npm start
   ```

### Alternative: Run with parameters
```bash
PRIVATE_KEY="your-key" TN_ENDPOINT="https://gateway.mainnet.truf.network" npm start
```

## Expected Output

The example will:
1. ✅ Deploy a stream and wait for confirmation
2. ⚡ Insert records using both async and sync patterns
3. 📊 Verify records were inserted correctly
4. 🗑️ Destroy the stream and wait for confirmation
5. 🧪 Test that operations fail after destruction (as expected)
6. 📚 Display key takeaways and best practices

## What You'll Learn

### Safe Patterns ✅
```typescript
// Deploy and wait before dependent operations
const deployResult = await client.deployStream(streamId, StreamType.Primitive);
await client.waitForTx(deployResult.data.tx_hash);
// Now safe to insert records

// Destroy and verify before cleanup
const destroyResult = await client.destroyStream(streamLocator);
await client.waitForTx(destroyResult.data.tx_hash);
// Now safe to verify destruction
```

### Dangerous Patterns ❌
```typescript
// DON'T: Race conditions possible
await client.deployStream(streamId, StreamType.Primitive);
await primitiveAction.insertRecord(...); // Might fail - stream not ready!

await client.destroyStream(streamLocator);
await primitiveAction.insertRecord(...); // Might succeed - stream not destroyed!
```

### When to Use Each Pattern

**Use Transaction Confirmation (`waitForTx`):**
- ✅ Stream deployment before data insertion
- ✅ Stream deletion before cleanup verification  
- ✅ Sequential operations with dependencies
- ✅ Testing and development scenarios

**Async is OK:**
- ⚡ Independent record insertions (high throughput)
- ⚡ Fire-and-forget operations (with proper error handling)

## Troubleshooting

### Common Issues

1. **"Deploy transaction submission failed"**
   - Check your private key and network connection
   - Ensure you have sufficient balance for gas fees

2. **"Stream not found" after operations**
   - This is expected behavior after stream destruction
   - Indicates proper cleanup occurred

3. **Records still accessible after destruction**
   - Possible race condition - increase wait times
   - Check network congestion

4. **Transaction timeouts**
   - Increase client timeout in configuration
   - Check network status

### Local Node Testing

For testing with a local node:
```bash
TN_ENDPOINT="http://localhost:8484" npm start
```

## Additional Resources

- [TN SDK Documentation](../../README.md)
- [API Reference](../../docs/api-reference.md)
- [Core Concepts](../../docs/core-concepts.md)
- [Other Examples](../)

This example provides the foundation for building robust applications that handle TN transactions safely and efficiently.