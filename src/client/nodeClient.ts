import { EnvironmentType } from "@kwilteam/kwil-js/dist/core/enums";
import { NodeKwil } from "@kwilteam/kwil-js";
import { BaseTNClient, TNClientOptions } from "./client";
import { Pool } from "pg";
export class NodeTNClient extends BaseTNClient<EnvironmentType.NODE> {
  constructor(options: TNClientOptions) {
    super(options);
    this.kwilClient = new NodeKwil({
      ...options,
      kwilProvider: options.endpoint,
    });
  }

  protected getPool(): Pool | undefined {
    if (this.neonConnectionString) {
      return new Pool({ connectionString: this.neonConnectionString });
    }
    return undefined;
  }
}

export default NodeTNClient;
