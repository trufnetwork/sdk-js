/**
 * EthSigner interface required by TNClient
 * We define it here to avoid importing from @trufnetwork/kwil-js
 * This demonstrates that ANY service can implement this interface
 */
interface EthSigner {
  signMessage: (message: string | Uint8Array) => Promise<string>;
}

/**
 * ConnectedWalletSigner - A signer implementation that can work with any wallet service
 * that provides a signMessage function.
 * 
 * This adapter allows using connected wallets (MetaMask, WalletConnect, viem, wagmi, etc.) 
 * with TNClient without exposing private keys.
 */
export class ConnectedWalletSigner implements EthSigner {
  private walletService: any;
  private address: string;

  /**
   * @param walletService - Any wallet service that has a signMessage method
   *                        (e.g., viem WalletClient, wagmi client, ethers Signer)
   * @param address - The wallet address
   */
  constructor(walletService: any, address: string) {
    if (!walletService || typeof walletService.signMessage !== 'function') {
      throw new Error('Wallet service must have a signMessage method');
    }
    this.walletService = walletService;
    this.address = address;
  }

  /**
   * Sign a message using the connected wallet
   * @param message - The message to sign (string or Uint8Array)
   * @returns Promise<string> - The signature
   */
  async signMessage(message: string | Uint8Array): Promise<string> {
    // Convert Uint8Array to string if needed
    const messageToSign = typeof message === 'string' 
      ? message 
      : new TextDecoder().decode(message);

    try {
      // Check if this is a viem wallet client
      if (this.walletService.account && this.walletService.signMessage) {
        // For viem wallet clients, we need to pass the message differently
        const signature = await this.walletService.signMessage({
          account: this.walletService.account,
          message: messageToSign,
        });
        return signature;
      } else {
        // For other wallet services (ethers, mock, etc.)
        const signature = await this.walletService.signMessage(messageToSign);
        return signature;
      }
    } catch (error) {
      console.error('Error signing message with connected wallet:', error);
      throw new Error(`Failed to sign message: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get the address of the connected wallet
   */
  getAddress(): string {
    return this.address;
  }
}

/**
 * Mock wallet service for demonstration purposes
 * This simulates a connected wallet service like MetaMask or WalletConnect
 */
export class MockWalletService {
  private signer: any;

  constructor(signer: any) {
    this.signer = signer;
  }

  async signMessage(message: string): Promise<string> {
    // In a real implementation, this would trigger the wallet UI for user approval
    console.log('Mock wallet service: Requesting signature for message:', message);
    
    // Simulate user approval delay
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Use the underlying signer to actually sign
    return this.signer.signMessage(message);
  }
}

export { EthSigner };