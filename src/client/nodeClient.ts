import { EnvironmentType, NodeKwil } from "@trufnetwork/kwil-js";
import { BaseTNClient, TNClientOptions } from "../internal";

export class NodeTNClient extends BaseTNClient<EnvironmentType.NODE> {
  constructor(options: TNClientOptions) {
    super(options);
    const { endpoint, signerInfo, ...kwilOptions } = options;
    this.kwilClient = new NodeKwil({
      ...kwilOptions,
      timeout: options.timeout ?? 30000,
      kwilProvider: endpoint,
    });
  }
}

export default NodeTNClient;
