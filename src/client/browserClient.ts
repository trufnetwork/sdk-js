import { EnvironmentType } from "@trufnetwork/kwil-js/dist/core/enums";
import { WebKwil } from "@trufnetwork/kwil-js";
import { BaseTNClient, TNClientOptions } from "./client";

export class BrowserTNClient extends BaseTNClient<EnvironmentType.BROWSER> {
  constructor(options: TNClientOptions) {
    super(options);
    this.kwilClient = new WebKwil({
      ...options,
      timeout: options.timeout ?? 30000,
      kwilProvider: options.endpoint,
    });
  }
}

export default BrowserTNClient;
