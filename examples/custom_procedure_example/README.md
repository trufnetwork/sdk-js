# Custom Procedure Example

This example demonstrates how to invoke a **custom stored procedure** in TRUF.NETWORK using the JavaScript SDK.

The script shows how to:

1. Initialise `NodeTNClient` with a signer (ethers `Wallet`).
2. Call `customProcedureWithArgs()` with a procedure name and a set of named parameters.

## Running the example

From the project root:

```bash
# Install dependencies (if you haven't already)
pnpm install

# Execute the script with tsx
pnpm start
```

The script will output the procedure result to the console. 