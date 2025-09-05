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
    prefix: "truflation_"
});

console.log("Truflation AI Index records:", records);