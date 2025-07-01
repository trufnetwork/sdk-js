import { EnvironmentType } from "@trufnetwork/kwil-js/dist/core/enums";
import { NodeKwil } from "@trufnetwork/kwil-js";
import { BaseTNClient, TNClientOptions } from "./client";

export class NodeTNClient extends BaseTNClient<EnvironmentType.NODE> {
  constructor(options: TNClientOptions) {
    super(options);
    this.kwilClient = new NodeKwil({
      ...options,
      timeout: options.timeout ?? 30000,
      kwilProvider: options.endpoint,
    });
  }
}

export default NodeTNClient;
