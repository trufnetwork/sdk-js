import { EnvironmentType } from "@kwilteam/kwil-js/dist/core/enums";
import { WebKwil } from "@kwilteam/kwil-js";
import { BaseTNClient, TNClientOptions } from "./client";
import { type Pool } from "pg";

export class BrowserTNClient extends BaseTNClient<EnvironmentType.BROWSER> {
  constructor(options: TNClientOptions) {
    if (options.neonConnectionString) {
      console.warn("Neon connection string is not supported in browser environments. Database operations won't be performed.");
    }

    super(options);
    this.kwilClient = new WebKwil({
      ...options,
      kwilProvider: options.endpoint,
    });
  }

  protected getPool(): Pool | undefined {
    return undefined;
  }
}

export default BrowserTNClient;
