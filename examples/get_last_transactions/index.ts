import { NodeTNClient } from "../../src/index";
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

console.log("Testing getLastTransactions with single API call optimization...\n");

(async () => {
    try {
        const startTime = Date.now();
        const lastTransactions = await client.getLastTransactions({});
        const endTime = Date.now();

        console.log(`✅ Success! Fetched ${lastTransactions.length} transactions in ${endTime - startTime}ms\n`);
        console.log("Results:");
        console.log(JSON.stringify(lastTransactions, null, 2));
    } catch (error) {
        console.error("❌ Error:", error.message);
        console.error(error);
    }
})();
