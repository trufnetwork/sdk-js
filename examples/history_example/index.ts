import { NodeTNClient } from "../../src/index.node";
import { Wallet } from "ethers";
import dotenv from "dotenv";

dotenv.config();

async function main() {
    const privateKey = process.env.TN_PRIVATE_KEY || "0000000000000000000000000000000000000000000000000000000000000001";
    const endpoint = process.env.TN_GATEWAY_URL || "https://gateway.testnet.truf.network";
    const wallet = new Wallet(privateKey);

    const client = new NodeTNClient({
        endpoint: endpoint,
        signerInfo: {
            address: wallet.address,
            signer: wallet,
        },
        chainId: "testnet-v1",
        timeout: 30000,
    });

    console.log("🔄 Transaction History Demo (JS)");
    console.log("===============================");
    console.log(`Endpoint: ${endpoint}`);
    console.log(`Wallet:   ${wallet.address}\n`);

    const bridgeId = "hoodi_tt2";
    const targetWallet = "0xc11Ff6d3cC60823EcDCAB1089F1A4336053851EF";
    const limit = 10;
    const offset = 0;

    console.log(`📋 Fetching history for bridge '${bridgeId}'...`);
    console.log(`   Wallet: ${targetWallet}`);
    console.log(`   Limit:  ${limit}`);
    console.log(`   Offset: ${offset}`);
    console.log("-".repeat(60));

    try {
        const history = await client.getHistory(bridgeId, targetWallet, limit, offset);

        if (history.length === 0) {
            console.log("No history records found.");
            return;
        }

        // Helper to format/shorten
        const formatShort = (val: string | null): string => {
            if (!val) return "null";
            
            let s = val;
            // Check if it's Base64 (Kwil default) or already Hex
            if (!s.startsWith("0x")) {
                try {
                    const buffer = Buffer.from(s, 'base64');
                    // Check if it looks like a hash/address (20 or 32 bytes)
                    if (buffer.length === 20 || buffer.length === 32) {
                         s = "0x" + buffer.toString('hex');
                    }
                } catch (e) {
                    // Not base64, keep as is
                }
            }
            
            if (s.length > 12) {
                return s.substring(0, 10) + "...";
            }
            return s;
        };

        // Print Header
        console.log(
            "TYPE".padEnd(12) + 
            "AMOUNT".padEnd(22) + 
            "FROM".padEnd(14) + 
            "TO".padEnd(14) + 
            "INT TX".padEnd(14) + 
            "EXT TX".padEnd(14) + 
            "STATUS".padEnd(12) + 
            "BLOCK".padEnd(8) + 
            "TIMESTAMP"
        );
        console.log(
            "-".repeat(12) + " " + 
            "-".repeat(22) + " " + 
            "-".repeat(14) + " " + 
            "-".repeat(14) + " " + 
            "-".repeat(14) + " " + 
            "-".repeat(14) + " " + 
            "-".repeat(12) + " " + 
            "-".repeat(8) + " " + 
            "-".repeat(20)
        );

        for (const rec of history) {
            const date = new Date(rec.block_timestamp * 1000).toISOString();
            
            console.log(
                rec.type.padEnd(12) + 
                rec.amount.toString().padEnd(22) + 
                formatShort(rec.from_address).padEnd(14) + 
                formatShort(rec.to_address).padEnd(14) + 
                formatShort(rec.internal_tx_hash).padEnd(14) + 
                formatShort(rec.external_tx_hash).padEnd(14) + 
                rec.status.padEnd(12) + 
                rec.block_height.toString().padEnd(8) + 
                date
            );
        }

        console.log(`\n✅ Successfully retrieved ${history.length} records.`);
        console.log("\nNote: 'completed' means credited (deposits) or ready to claim (withdrawals). 'claimed' means withdrawn on Ethereum.");

    } catch (error) {
        console.error("❌ Failed to fetch history:", error);
    }
}

main();
