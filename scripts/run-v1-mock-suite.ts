/**
 * Run the v1 integration suite against the in-memory mock API.
 *
 * `tests/integration/v1Client.test.ts` is opt-in on `TEST_V1_BASE_URL` so it
 * skips when no deployment is available. This script starts the mock
 * (`tests/integration/mockV1Api.ts`), exports its URL as `TEST_V1_BASE_URL`,
 * runs that one file in a child process, and exits with vitest's code. The
 * suite therefore executes instead of skipping, against a real HTTP server.
 *
 * It also exports `TEST_V1_ORIGIN`, so the client mints the public preset and
 * the credential-gated reads run rather than skip. The mock enforces the same
 * gate as the real router, so a missing credential would fail rather than
 * silently pass. `TEST_V1_WRITE=1` opts the write tests in: the mock accepts
 * `prepare`/`broadcast` and keeps a receipt, so a trade runs end to end here.
 * `TEST_V1_MOCK=1` lets a test also check the mock's seeded rows exactly.
 *
 *   npm run test:v1:mock
 *
 * This is a harness, not part of the published artifact: `scripts/` is outside
 * the bundler's `src/**` glob.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";

import { startMockV1Api } from "../tests/integration/mockV1Api";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const vitestBin = fileURLToPath(
  new URL("../node_modules/vitest/vitest.mjs", import.meta.url),
);

function runVitest(baseUrl: string, network: string): Promise<number> {
  const child = spawn(
    process.execPath,
    [vitestBin, "run", "tests/integration/v1Client.test.ts"],
    {
      cwd: projectRoot,
      stdio: "inherit",
      env: {
        ...process.env,
        TEST_V1_BASE_URL: baseUrl,
        TEST_V1_NETWORK: network,
        TEST_V1_ORIGIN: process.env.TEST_V1_ORIGIN ?? "http://localhost",
        TEST_V1_WRITE: "1",
        TEST_V1_MOCK: "1",
      },
    },
  );

  return new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal !== null) {
        reject(new Error(`vitest exited via signal ${signal}`));
        return;
      }
      resolve(code ?? 1);
    });
  });
}

async function main(): Promise<number> {
  const mock = await startMockV1Api();
  console.info(
    `mock v1 API listening at ${mock.baseUrl} (network ${mock.network})`,
  );
  try {
    return await runVitest(mock.baseUrl, mock.network);
  } finally {
    await mock.close();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
