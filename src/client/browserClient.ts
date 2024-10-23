import { EnvironmentType } from "@kwilteam/kwil-js/dist/core/enums";
import { WebKwil } from "@kwilteam/kwil-js";
import { BaseTSNClient, TSNClientOptions } from "./client";

export class BrowserTSNClient extends BaseTSNClient<EnvironmentType.BROWSER> {
  constructor(options: TSNClientOptions) {
    super(options);
    this.kwilClient = new WebKwil({
      ...options,
      kwilProvider: options.endpoint,
    });
  }
}

export default BrowserTSNClient;
