import { EnvironmentType, WebKwil } from "@trufnetwork/kwil-js";
import { BaseTNClient, TNClientOptions } from "../internal";

export class BrowserTNClient extends BaseTNClient<EnvironmentType.BROWSER> {
  constructor(options: TNClientOptions) {
    super(options);
    const { endpoint, signerInfo, ...kwilOptions } = options;
    this.kwilClient = new WebKwil({
      ...kwilOptions,
      timeout: options.timeout ?? 30000,
      kwilProvider: endpoint,
    });
  }
}

export default BrowserTNClient;
