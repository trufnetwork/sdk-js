import * as esbuild from "esbuild";
import { glob } from "glob";
import { readFile, writeFile, rm, mkdir, copyFile } from "fs/promises";
import path from "path";

const DIST_DIR = "dist";

// List of Node.js built-in modules to mark as external
const NODE_BUILT_INS = [
  "crypto",
  "http",
  "https",
  "net",
  "tls",
  "events",
  "stream",
  "url",
  "zlib",
  "buffer",
];

// List of test-related packages to mark as external
const TEST_EXTERNALS = ["vitest", "chai", "loupe", "@vitest/utils"];

// Add build mode
const isProd = process.env.NODE_ENV === "production";

async function generateTypes() {
  const { exec } = await import("child_process");
  const { promisify } = await import("util");
  const execAsync = promisify(exec);

  console.log("Generating types...");

  try {
    await execAsync("tsc -p tsconfig.build.json");
  } catch (error) {
    console.error("Error generating types:", error);
    throw error;
  }
}

async function copyJsonFiles() {
  const jsonFiles = await glob("src/**/*.json");
  await Promise.all(
    jsonFiles.map(async (file) => {
      const relativePath = path.relative("src", file);
      const destinations = ["browser", "node", "cjs", "esm"].map((dir) =>
        path.join(DIST_DIR, dir, relativePath)
      );

      await Promise.all(
        destinations.map(async (dest) => {
          await mkdir(path.dirname(dest), { recursive: true });
          await copyFile(file, dest);
        })
      );
    })
  );
}

async function build() {
  try {
    // default to production
    process.env.NODE_ENV ||= "production";

    // Clean dist directory
    console.log("Cleaning dist directory...");
    await rm(DIST_DIR, { recursive: true, force: true });

    // Generate types
    await generateTypes();

    const entryPoints = await glob("src/**/*.{ts,tsx}");
    const pkg = JSON.parse(await readFile("package.json", "utf8"));

    // Get all dependencies to mark as external
    const external = [
      ...Object.keys(pkg.peerDependencies || {}),
      ...Object.keys(pkg.dependencies || {}),
      ...NODE_BUILT_INS,
      ...TEST_EXTERNALS,
    ];

    // Base build options
    const baseConfig: esbuild.BuildOptions = {
      entryPoints,
      bundle: true,
      sourcemap: true,
      minify: isProd,
      external,
      loader: { ".json": "json" },
      logLevel: "info",
    };

    console.log("Building for Node.js (ESM)...");
    await esbuild.build({
      ...baseConfig,
      entryPoints: ["src/index.node.ts"],
      outfile: `${DIST_DIR}/esm/index.js`,
      format: "esm",
      target: ["node18"],
      platform: "node",
    });

    console.log("Building for Node.js (CJS)...");
    await esbuild.build({
      ...baseConfig,
      entryPoints: ["src/index.node.ts"],
      outfile: `${DIST_DIR}/cjs/index.js`,
      format: "cjs",
      target: ["node18"],
      platform: "node",
    });

    console.log("Building for Browser (ESM)...");
    await esbuild.build({
      ...baseConfig,
      entryPoints: ["src/index.browser.ts"],
      outfile: `${DIST_DIR}/esm/index.browser.js`,
      format: "esm",
      target: ["es2020"],
      platform: "browser",
    });

    console.log("Building for Browser (CJS)...");
    await esbuild.build({
      ...baseConfig,
      entryPoints: ["src/index.browser.ts"],
      outfile: `${DIST_DIR}/cjs/index.browser.js`,
      format: "cjs",
      target: ["es2020"],
      platform: "browser",
    });

    console.log("Copying JSON files...");
    await copyJsonFiles();
  } catch (error) {
    console.error("Build failed:", error);
    throw error;
  }
}

build();
