import { NodeTNClient, StreamId, EthereumAddress } from "@trufnetwork/sdk-js";
import { Wallet } from "ethers";

const wallet = new Wallet("0000000000000000000000000000000000000000000000000000000000000001");

const client = new NodeTNClient({
    endpoint: "https://gateway.mainnet.truf.network",
    signerInfo: {
        address: wallet.address,
        signer: wallet,
    },
    chainId: "tn-v2.1",
    timeout: 30000,
});

// Create a stream locator for the AI Index
const aiIndexLocator = {
    streamId: StreamId.fromString("st527bf3897aa3d6f5ae15a0af846db6").throw(),
    dataProvider: EthereumAddress.fromString("0x4710a8d8f0d845da110086812a32de6d90d7ff5c").throw(),
};

// Load the action client
const stream = client.loadAction();

// Get the latest records
const records = await stream.getRecord({
    stream: aiIndexLocator,
});

console.log("AI Index records:", records);

// Example: Query recent taxonomies using the new taxonomy querying functionality
console.log("\n=== Taxonomy Querying Examples ===");

try {
    // Get recent taxonomies with the new SDK methods
    const recentTaxonomies = await client.listTaxonomiesByHeight({
        fromHeight: 180000,
        toHeight: 190000,
        limit: 5,
        latestOnly: true
    });
    
    console.log(`Found ${recentTaxonomies.length} recent taxonomies:`);
    recentTaxonomies.forEach((taxonomy, index) => {
        console.log(`${index + 1}. Stream: ${taxonomy.streamId.getId()}`);
        console.log(`   Child: ${taxonomy.childStreamId.getId()}`);
        console.log(`   Weight: ${taxonomy.weight}`);
        console.log(`   Block Height: ${taxonomy.createdAt}`);
    });

    // Example: Get taxonomies for specific streams (batch processing)
    console.log("\n--- Batch Processing Example ---");

    // Use first few unique streams from results
    const uniqueStreams = new Map();
    recentTaxonomies.forEach(t => {
        const key = `${t.dataProvider.getAddress()}_${t.streamId.getId()}`;
        if (!uniqueStreams.has(key)) {
            uniqueStreams.set(key, {
                dataProvider: t.dataProvider,
                streamId: t.streamId
            });
        }
    });

    const streamsToQuery = Array.from(uniqueStreams.values()).slice(0, 2);

    if (streamsToQuery.length > 0) {
        const batchResults = await client.getTaxonomiesForStreams({
            streams: streamsToQuery,
            latestOnly: true
        });

        console.log(`Batch query results for ${streamsToQuery.length} streams:`);
        batchResults.forEach((result) => {
            console.log(`- ${result.streamId.getId()} -> ${result.childStreamId.getId()} (${result.weight})`);
        });
    }
} catch (error) {
    console.log("Taxonomy querying example error (expected if no taxonomies exist):", error.message);
}