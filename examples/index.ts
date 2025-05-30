import {
    EthereumAddress,
    NodeTNClient,
    StreamId,
    type StreamLocator,
    StreamType,
} from "../src"
import { Wallet } from "ethers";
import * as dotenv from 'dotenv';

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
                return {} as T; // Return an empty object or handle it as needed
            }

            console.log(
                `Attempt ${attempt} failed: ${error}. Retrying in ${delayMs / 1000} seconds...`
            );
            await delay(delayMs);
        }
    }
    throw lastError;
}

// Helper: destroy stream once and ignore "stream does not exist" errors.
async function safeDestroy(client: NodeTNClient, streamId: StreamId) {
    try {
        await retryOperation(async () => {
            const tx_destroy = await client.destroyStream(
                { streamId, dataProvider: client.address() }, true);
            console.log("Destroy transaction hash:", tx_destroy.data?.tx_hash);
            // Wait for the transaction to be mined.
            await client.waitForTx(tx_destroy.data?.tx_hash!);
            console.log(`Stream ${streamId.getId()} destroyed successfully.`);
        });
    } catch (error) {
        console.log(error);
        if (
            error instanceof Error &&
            error.message.includes("not exist")
        ) {
            console.warn(`[TN SDK] Stream ${streamId.getId()} does not exist, skipping destroy.`);
            return;
        }

        throw error;
    }
}

(async function main() {
    const wallet = new Wallet(
        "0000000000000000000000000000000000000000000000000000000000000001"
    );

    // get the connection string from the environment variable
    dotenv.config();
    const neonConnectionString = process.env.NEON_CONNECTION_STRING;
    if (!neonConnectionString) {
        console.log("No connection string provided, will not doing explorer-related operations");
    }

    const client = new NodeTNClient({
        chainId: "tn-v2",
        endpoint: "https://gateway.mainnet.truf.network",
        signerInfo: {
            address: wallet.address,
            signer: wallet,
        },
        neonConnectionString: neonConnectionString, // Optional, for explorer-related operations
        timeout: 30000, //Optional, default is 10 seconds
    });

    // Example of using the client to get the last transactions.
    const lastTransactions = await client.getLastTransactions({
        dataProvider: undefined,
        limitSize: 6,
    });
    console.log("Last transactions:", lastTransactions);

    return;
    // Create a new stream ID.
    const streamIdNew = await StreamId.generate("new-stream-id");

    // Before testing: destroy the stream if it already exists.
    await safeDestroy(client, streamIdNew);

    const streamType = StreamType.Primitive;

    // Deploy the new stream with retry.
    const deployResponse = await retryOperation(() =>
        client.deployStream(streamIdNew, streamType, true)
    );
    console.log("Deploy transaction hash:", deployResponse.data?.tx_hash);

    // Wait for the transaction to be mined.
    await client.waitForTx(deployResponse.data?.tx_hash!);

    // Prepare the stream locator for the new stream.
    const streamLocatorNew: StreamLocator = {
        streamId: streamIdNew,
        dataProvider: EthereumAddress.fromString(wallet.address).throw(),
    };
    const streamApiNew = client.loadPrimitiveAction();

    // Insert a new record into the stream with retry.
    const currentTimeUnix = Math.floor(Date.now() / 1000);
    const insertResponse = await retryOperation(() =>
        streamApiNew.insertRecords([
            {
                stream: streamLocatorNew,
                eventTime: currentTimeUnix,
                value: "1000",
            },
        ])
    );
    console.log("Insert transaction hash:", insertResponse.data?.tx_hash);

    // Wait for the transaction to be mined.
    await client.waitForTx(insertResponse.data?.tx_hash!);

    // Fetch the record with retry.
    const resultNew = await retryOperation(() =>
        streamApiNew.getRecord({
            stream: streamLocatorNew,
        })
    );
    console.log("Fetched record:", resultNew);

    // Example of deploying composed stream
    const streamIdComposed = await StreamId.generate("composed-stream-id");
    // Before testing: destroy the stream if it already exists.
    await safeDestroy(client, streamIdComposed);

    const deployResponseComposed = await retryOperation(() =>
        client.deployStream(streamIdComposed, StreamType.Composed, true)
    );
    console.log("Deploy transaction hash:", deployResponseComposed.data?.tx_hash);
    // Wait for the transaction to be mined.
    await client.waitForTx(deployResponseComposed.data?.tx_hash!);

    // Prepare the stream locator for the new stream.
    const streamLocatorComposed: StreamLocator = {
        streamId: streamIdComposed,
        dataProvider: EthereumAddress.fromString(wallet.address).throw(),
    };
    const streamApiComposed = client.loadComposedAction();

    // Set the taxonomy with retry.
    const setTaxonomyResponse = await retryOperation(() =>
        streamApiComposed.setTaxonomy({
            stream: streamLocatorComposed,
            taxonomyItems: [
                {
                    childStream: {
                        streamId: streamIdNew,
                        dataProvider: EthereumAddress.fromString(wallet.address).throw(),
                    },
                    weight: "1",
                },
            ],
            startDate: 0,
        })
    );
    console.log("Set taxonomy transaction hash:", setTaxonomyResponse.data?.tx_hash);

    // Wait for the transaction to be mined.
    await client.waitForTx(setTaxonomyResponse.data?.tx_hash!);

    // Fetch the taxonomy with retry.
    const resultComposed = await retryOperation(() =>
        streamApiComposed.describeTaxonomies({
            stream: streamLocatorComposed,
            latestGroupSequence: true
        })
    )
    console.log("Fetched taxonomy items:", resultComposed[0].taxonomyItems);
    console.log("Fetched taxonomy start date:", resultComposed[0].startDate);

    // Fetch the record with retry.
    const resultComposedRecord = await retryOperation(() =>
        streamApiComposed.getRecord({
            stream: streamLocatorComposed,
        })
    );
    console.log("Fetched record:", resultComposedRecord);

    // After testing: destroy the stream.
    await safeDestroy(client, streamIdComposed);
    await safeDestroy(client, streamIdNew);
})();
