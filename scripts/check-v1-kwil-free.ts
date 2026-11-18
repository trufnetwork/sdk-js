/**
 * AC1 proof: the `@trufnetwork/sdk-js/v1` entry must be kwil-free.
 *
 * A one-time review cannot keep a criterion true; this check can. It bundles the
 * v1 entry for the browser and fails closed if the module graph reaches
 * `@trufnetwork/kwil-js`, `ethers`, `pg`, or a `node:` builtin. A node-only import
 * breaks a front-end exactly as a kwil import does, so all four are fatal.
 *
 * Run with `npm run check:v1`.
 */

import * as esbuild from "esbuild";

const ENTRY = "src/v1/index.ts";
const FORBIDDEN_PACKAGES = ["@trufnetwork/kwil-js", "ethers", "pg"];

function isForbiddenPackagePath(path: string): string | null {
  for (const pkg of FORBIDDEN_PACKAGES) {
    if (
      path === pkg ||
      path.startsWith(`${pkg}/`) ||
      path.includes(`node_modules/${pkg}/`)
    ) {
      return pkg;
    }
  }
  return null;
}

async function main(): Promise<void> {
  const result = await esbuild.build({
    entryPoints: [ENTRY],
    bundle: true,
    write: false,
    metafile: true,
    format: "esm",
    platform: "browser",
    target: ["es2020"],
    minify: true,
    logLevel: "silent",
  });

  const metafile = result.metafile;
  if (metafile === undefined) {
    throw new Error("esbuild produced no metafile");
  }

  const problems: string[] = [];
  const inputs = Object.keys(metafile.inputs);
  for (const input of inputs) {
    if (input.startsWith("node:")) {
      problems.push(`Node builtin in the graph: ${input}`);
      continue;
    }
    const forbidden = isForbiddenPackagePath(input);
    if (forbidden !== null) {
      problems.push(`forbidden package "${forbidden}" in the graph: ${input}`);
    }
  }

  for (const output of Object.values(metafile.outputs)) {
    for (const imported of output.imports) {
      if (imported.path.startsWith("node:")) {
        problems.push(`Node builtin imported by the bundle: ${imported.path}`);
        continue;
      }
      const forbidden = isForbiddenPackagePath(imported.path);
      if (forbidden !== null) {
        problems.push(
          `bundle imports forbidden package "${forbidden}": ${imported.path}`,
        );
      }
    }
  }

  if (problems.length > 0) {
    console.error("check:v1 FAILED — the v1 entry is not kwil-free:");
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }

  const outputBytes = Object.values(metafile.outputs).reduce(
    (total, output) => total + output.bytes,
    0,
  );
  const sizeKb = (outputBytes / 1024).toFixed(1);

  console.log(
    `check:v1 OK — bundled ${inputs.length} module(s) for the browser with no ` +
      `@trufnetwork/kwil-js, ethers, pg, or node: builtins ` +
      `(${sizeKb} kB minified, ${outputBytes} bytes).`,
  );
}

main().catch((error) => {
  console.error(
    "check:v1 FAILED — could not bundle the v1 entry for the browser:",
  );
  console.error(error);
  process.exit(1);
});
