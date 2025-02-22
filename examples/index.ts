import {
    EthereumAddress,
    NodeTNClient,
    StreamId,
    type StreamLocator,
    StreamType,
} from "@trufnetwork/sdk-js";
import { Wallet } from "ethers";

// Helper: delay for a given number of milliseconds.
async function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Helper: retry any async operation up to `retries` times with a delay between attempts.
async function retryOperation<T>(
    operation: () => Promise<T>,
    retries = 3,
    delayMs = 5000
): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            // if the error is "dataset not found", we can ignore it and continue
            if (String(error).includes("dataset not found")) {
                console.log("Stream not found, ignoring error.");
                return;
            }

            console.log(
                `Attempt ${attempt} failed: ${error}. Retrying in ${delayMs / 1000} seconds...`
            );
            await delay(delayMs);
        }
    }
    throw lastError;
}

// Helper: destroy stream once and ignore "dataset not found" errors.
async function safeDestroy(client: NodeTNClient, streamId: StreamId) {
    try {
        await retryOperation(async () => {
            const tx_destroy = await client.destroyStream(streamId, true);
            console.log("Destroy transaction hash:", tx_destroy.data.tx_hash);
            // Wait for the transaction to be mined.
            await client.waitForTx(tx_destroy.data.tx_hash);
            console.log(`Stream ${streamId.getId()} destroyed successfully.`);
        });
    } catch (error) {
        throw error;
    }
}

(async function main() {
    const wallet = new Wallet(
        "0000000000000000000000000000000000000000000000000000000000000001"
    );
    const client = new NodeTNClient({
        chainId: "",
        endpoint: "http://localhost:8484",
        signerInfo: {
            address: wallet.address,
            signer: wallet,
        },
    });

    // Create a new stream ID.
    const streamIdNew = await StreamId.generate("new-stream-id");

    // Before testing: destroy the stream if it already exists.
    await safeDestroy(client, streamIdNew);

    const streamType = StreamType.Primitive;

    // Deploy the new stream with retry.
    const deployResponse = await retryOperation(() =>
        client.deployStream(streamIdNew, streamType, true, 2)
    );
    console.log("Deploy transaction hash:", deployResponse.data.tx_hash);

    // Wait for the transaction to be mined.
    await client.waitForTx(deployResponse.data.tx_hash);

    // Prepare the stream locator for the new stream.
    const streamLocatorNew: StreamLocator = {
        streamId: streamIdNew,
        dataProvider: EthereumAddress.fromString(wallet.address).throw(),
    };
    const streamApiNew = client.loadPrimitiveStream(streamLocatorNew);

    // Initialize the stream with retry.
    const initResponse = await retryOperation(() =>
        streamApiNew.initializeStream()
    );
    console.log("Initialize transaction hash:", initResponse.data.tx_hash);

    // Wait for the transaction to be mined.
    await client.waitForTx(initResponse.data.tx_hash);

    // Insert a new record into the stream with retry.
    const currentTimeUnix = Math.floor(Date.now() / 1000);
    const insertResponse = await retryOperation(() =>
        streamApiNew.insertRecords([
            {
                dateValue: currentTimeUnix,
                value: "1000",
            },
        ])
    );
    console.log("Insert transaction hash:", insertResponse.data.tx_hash);

    // Wait for the transaction to be mined.
    await client.waitForTx(insertResponse.data.tx_hash);

    // Fetch the record with retry.
    const resultNew = await retryOperation(() =>
        streamApiNew.getRecord({})
    );
    console.log("Fetched record:", resultNew);

    // After testing: destroy the stream.
    await safeDestroy(client, streamIdNew);
})();
