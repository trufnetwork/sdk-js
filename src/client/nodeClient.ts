import { EnvironmentType } from "@kwilteam/kwil-js/dist/core/enums";
import { NodeKwil } from "@kwilteam/kwil-js";
import { BaseTSNClient, TSNClientOptions } from "./client";

export class NodeTSNClient extends BaseTSNClient<EnvironmentType.NODE> {
  constructor(options: TSNClientOptions) {
    super(options);
    this.kwilClient = new NodeKwil({
      ...options,
      kwilProvider: options.endpoint,
    });
  }
}

export default NodeTSNClient;
