import { decodeMarketData } from "../../src/util/orderbookHelpers";
import { NodeTNClient } from "../../src/index.node";
import { Wallet } from "ethers";

async function main() {
    console.log("--- Prediction Market Decoding Example (Real Data JS) ---");

    const endpoint = "https://gateway.testnet.truf.network";
    const privateKey = "0x0000000000000000000000000000000000000000000000000000000000000001";
    const wallet = new Wallet(privateKey);

    console.log(`Endpoint:  ${endpoint}\n`);

    // 1. Initialize Client
    const client = new NodeTNClient({
        endpoint,
        signerInfo: {
            address: wallet.address,
            signer: wallet,
        }
    });

    // 2. Load Orderbook
    const orderbook = client.loadOrderbookAction();

    // 3. List Latest Markets
    console.log("Fetching latest markets...");
    const markets = await orderbook.listMarkets({
        limit: 3,
        offset: 0
    });

    console.log(`Found ${markets.length} latest markets. Decoding details...\n`);

    // 4. Fetch and Decode each market
    for (const m of markets) {
        console.log(`Processing Market ID: ${m.id}`);
        
        try {
            // Fetch full info (including queryComponents)
            const marketInfo = await orderbook.getMarketInfo(m.id);

            // Decode components
            const details = decodeMarketData(marketInfo.queryComponents);

            console.log(`  Market Type:   ${details.type}`);
            console.log(`  Thresholds:    ${details.thresholds.join(", ")}`);
            console.log(`  Action:        ${details.actionId}`);
            console.log(`  Stream:        ${details.streamId}\n`);
        } catch (e) {
            console.error(`  Error processing market ${m.id}:`, e);
        }
    }
}

main().catch(console.error);
