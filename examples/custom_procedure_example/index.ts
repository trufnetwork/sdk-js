import { NodeTNClient, StreamId, EthereumAddress } from "@trufnetwork/sdk-js";
import { Wallet } from "ethers";

// Example wallet – DO NOT use this key in production
const wallet = new Wallet(
  "0000000000000000000000000000000000000000000000000000000000000001",
);

// Initialize the client
const client = new NodeTNClient({
  endpoint: "https://gateway.mainnet.truf.network",
  signerInfo: {
    address: wallet.address,
    signer: wallet,
  },
  chainId: "tn-v2",
});

// Load the Action API
const action = client.loadAction();

// Invoke a custom stored procedure with named parameters
const result = await action.customProcedureWithArgs("get_divergence_index_change", {
  $from: Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 7, // 1 week ago
  $to: Math.floor(Date.now() / 1000), // now
  $frozen_at: null,
  $base_time: null,
  $time_interval: 31536000, // 1 year in seconds
});

console.log("Custom procedure result:", result); 