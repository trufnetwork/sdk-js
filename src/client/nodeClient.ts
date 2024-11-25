import { EnvironmentType } from "@kwilteam/kwil-js/dist/core/enums";
import { NodeKwil } from "@kwilteam/kwil-js";
import { BaseTNClient, TNClientOptions } from "./client";

export class NodeTNClient extends BaseTNClient<EnvironmentType.NODE> {
  constructor(options: TNClientOptions) {
    super(options);
    this.kwilClient = new NodeKwil({
      ...options,
      kwilProvider: options.endpoint,
    });
  }
}

export default NodeTNClient;
