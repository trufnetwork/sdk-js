import { NodeTNClient, StreamId, StreamType } from "@trufnetwork/sdk-js";
import { Wallet } from "ethers";

/**
 * Transaction Lifecycle Best Practices Demo
 * 
 * This example demonstrates proper async transaction handling patterns
 * to avoid race conditions in sequential workflows.
 * 
 * Key Learning Points:
 * - Transaction operations return success when entering mempool, NOT when executed on-chain
 * - Use waitForTx() for operations where order matters
 * - Always check transaction results and handle errors properly
 */

// Use environment variable or hardcode for demo (never use hardcoded keys in production!)
const PRIVATE_KEY = process.env.PRIVATE_KEY || "<YOUR_PRIVATE_KEY";
const ENDPOINT = process.env.TN_ENDPOINT || "https://gateway.mainnet.truf.network";

const wallet = new Wallet(PRIVATE_KEY);
const client = new NodeTNClient({
    endpoint: ENDPOINT,
    signerInfo: {
        address: wallet.address,
        signer: wallet,
    },
    chainId: "tn-v2.1",
    timeout: 30000,
});

/**
 * Safely deploy a stream with proper transaction confirmation
 */
async function deployStreamSafely(streamId: StreamId, streamType: StreamType): Promise<void> {
    console.log(`📝 Deploying ${streamType === StreamType.Primitive ? 'primitive' : 'composed'} stream...`);
    
    try {
        // Step 1: Submit deployment transaction
        const deployResult = await client.deployStream(streamId, streamType);
        if (!deployResult.data) {
            throw new Error('Deploy transaction submission failed');
        }
        console.log(`   Deployment submitted: ${deployResult.data.tx_hash}`);
        
        // Step 2: Wait for deployment to be mined
        console.log("⏳ Waiting for deployment to be mined...");
        await client.waitForTx(deployResult.data.tx_hash);
        
        console.log("✅ Stream deployed and confirmed on-chain");
    } catch (error) {
        console.error(`❌ Deployment failed: ${error}`);
        throw error;
    }
}

/**
 * Safely destroy a stream with proper transaction confirmation
 */
async function destroyStreamSafely(streamId: StreamId): Promise<void> {
    console.log("🗑️  Destroying stream...");
    
    try {
        // Step 1: Submit destruction transaction
        const destroyResult = await client.destroyStream(client.ownStreamLocator(streamId));
        if (!destroyResult.data) {
            throw new Error('Destroy transaction submission failed');
        }
        console.log(`   Destruction submitted: ${destroyResult.data.tx_hash}`);
        
        // Step 2: Wait for destruction to be mined
        console.log("⏳ Waiting for destruction to be mined...");
        await client.waitForTx(destroyResult.data.tx_hash);
        
        console.log("✅ Stream destroyed and confirmed on-chain");
    } catch (error) {
        console.error(`❌ Destruction failed: ${error}`);
        throw error;
    }
}

/**
 * Insert a record with optional transaction confirmation
 */
async function insertRecordWithConfirmation(
    streamId: StreamId, 
    value: string, 
    waitForConfirmation: boolean = false
): Promise<void> {
    const primitiveAction = client.loadPrimitiveAction();
    
    const insertResult = await primitiveAction.insertRecord({
        stream: client.ownStreamLocator(streamId),
        eventTime: Math.floor(Date.now() / 1000),
        value: value,
    });
    
    if (!insertResult.data) {
        throw new Error('Insert transaction submission failed');
    }
    
    if (waitForConfirmation) {
        console.log(`   ⏳ Waiting for record insertion to be mined...`);
        await client.waitForTx(insertResult.data.tx_hash);
        console.log(`   ✅ Record inserted and confirmed: ${value}`);
    } else {
        console.log(`   ⚡ Record submitted (async): ${value} - TX: ${insertResult.data.tx_hash}`);
    }
}

async function main() {
    // Use a fixed stream ID for predictable testing
    const streamId = StreamId.fromString("st123456789012345678901234567890").throw();
    
    console.log("🔄 Transaction Lifecycle Best Practices Demo");
    console.log("=============================================");
    console.log(`Stream ID: ${streamId.getId()}`);
    console.log(`Endpoint: ${ENDPOINT}`);
    console.log(`Wallet: ${wallet.address}\n`);
    
    try {
        // ========================================
        // EXAMPLE 1: Safe Stream Deployment
        // ========================================
        console.log("📋 EXAMPLE 1: Safe Stream Deployment");
        console.log("-------------------------------------");
        await deployStreamSafely(streamId, StreamType.Primitive);
        console.log("");
        
        // ========================================
        // EXAMPLE 2: Safe Sequential Operations
        // ========================================
        console.log("📋 EXAMPLE 2: Sequential Record Insertion Patterns");
        console.log("--------------------------------------------------");
        
        console.log("🅰️  Method A: Fire-and-forget (async) insertion");
        await insertRecordWithConfirmation(streamId, "123.45", false);
        
        console.log("🅱️  Method B: Confirmed (synchronous) insertion");
        await insertRecordWithConfirmation(streamId, "456.78", true);
        console.log("");
        
        // ========================================
        // EXAMPLE 3: Verify Records After Operations
        // ========================================
        console.log("📋 EXAMPLE 3: Verify Records After Operations");
        console.log("---------------------------------------------");
        
        // Small delay to let async operations complete
        console.log("   ⏳ Waiting a moment for async operations to complete...");
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const streamAction = client.loadAction();
        const records = await streamAction.getRecord({
            stream: client.ownStreamLocator(streamId)
        });
        
        console.log(`✅ Retrieved ${records.length} records from stream:`);
        records.forEach((record: any, index: number) => {
            console.log(`   Record ${index + 1}: ${record.value} (Time: ${record.eventTime})`);
        });
        console.log("");
        
        // ========================================
        // EXAMPLE 4: Safe Stream Destruction with Verification
        // ========================================
        console.log("📋 EXAMPLE 4: Safe Stream Destruction with Verification");
        console.log("--------------------------------------------------------");
        await destroyStreamSafely(streamId);
        
        // Verify destruction by trying to insert (should fail)
        console.log("🧪 Testing insertion after destruction...");
        try {
            await insertRecordWithConfirmation(streamId, "789.01", true);
            console.log("⚠️  WARNING: Insertion succeeded after destruction!");
            console.log("   This indicates a race condition - stream destruction wasn't complete");
        } catch (error) {
            console.log("✅ PERFECT: Insertion failed as expected after destruction");
            console.log(`   Error: ${error.message}`);
        }
        
        // Try to retrieve records (should also fail)
        console.log("🧪 Testing record retrieval after destruction...");
        try {
            const recordsAfterDestruction = await streamAction.getRecord({
                stream: client.ownStreamLocator(streamId)
            });
            if (recordsAfterDestruction.length > 0) {
                console.log("⚠️  WARNING: Records still accessible after destruction");
                recordsAfterDestruction.forEach((record: any, index: number) => {
                    console.log(`   Record ${index + 1}: ${record.value} (Time: ${record.eventTime})`);
                });
            } else {
                console.log("✅ No records found after destruction, as expected");
            }
        } catch (error) {
            console.log("✅ PERFECT: Record retrieval failed as expected");
            console.log(`   Error: ${error.message}`);
        }
        
        // ========================================
        // Key Takeaways
        // ========================================
        console.log("\n" + "=".repeat(60));
        console.log("📚 KEY TAKEAWAYS:");
        console.log("=".repeat(60));
        console.log("✅ Use waitForTx() for deployStream() and destroyStream()");
        console.log("✅ Use waitForTx() for insertRecord() when order matters");
        console.log("✅ Always check transaction results and handle errors");
        console.log("✅ Verify operations completed before proceeding with dependent actions");
        console.log("⚠️  Async operations can cause race conditions in sequential workflows");
        console.log("💡 Balance between safety (waitForTx) and performance (async) based on your use case");
    } catch (error) {
        console.error("❌ Demo failed:", error);
        
        // Attempt cleanup on error
        try {
            console.log("🧹 Attempting cleanup...");
            await destroyStreamSafely(streamId);
        } catch (cleanupError) {
            console.error("❌ Cleanup also failed:", cleanupError);
        }
    }
}

// Run the demo
main().catch(console.error);