import * as esbuild from "esbuild";
import { Metafile } from "esbuild";
import { readFileSync, writeFileSync } from "fs";
import { copyFile, mkdir, readFile, rm } from "fs/promises";
import { glob } from "glob";
import path from "path";
import { esbuildPluginFilePathExtensions } from "./esbuild-plugin-file-path-extensions";

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
      const destinations = ["cjs", "esm"].map((dir) =>
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
    process.env.NODE_ENV ||= "production";

    console.log("Cleaning dist directory...");
    await rm(DIST_DIR, { recursive: true, force: true });

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
      loader: { ".json": "json" },
      logLevel: "info",
      outdir: DIST_DIR,
      external,
      plugins: [
        esbuildPluginFilePathExtensions(),
      ],
      treeShaking: true,
    };

    console.log("Building ESM version...");
    const esmResult = await esbuild.build({
      ...baseConfig,
      format: "esm",
      outdir: `${DIST_DIR}/esm`,
      outExtension: { ".js": ".mjs" },
      target: ["es2020"],
      metafile: true,
    });
    addWithAttributeToJson(esmResult.metafile);


    console.log("Building CJS version...");
    await esbuild.build({
      ...baseConfig,
      format: "cjs",
      outdir: `${DIST_DIR}/cjs`,
      outExtension: { ".js": ".cjs" },
      target: ["node18"],
    });

    console.log("Copying JSON files...");
    await copyJsonFiles();
  } catch (error) {
    console.error("Build failed:", error);
    throw error;
  }
}

const addWithAttributeToJson = (result: Metafile) => {
  // to support Deno, we must include the type attribute in the import

  // - read each path
  // - read imports
  // - if the import path ends with .json
  // - then we add with { type: "json" } to the import with regex
  Object.entries(result.outputs).forEach(([filePath, output]) => {
    output.imports.forEach((importObj) => {
      if (importObj.path.endsWith(".json")) {
        const contents = readFileSync(path.join(filePath), "utf8");
        const lines = contents.split("\n");
        const newLines = lines.map((line) => {
          // if it ends with `from ".+\.json";`,
          // we replace the last char by ` with { type: "json" };`
          if (line.endsWith('.json";')) {
            return line.slice(0, -1) + ' with { type: "json" };';
          }
          return line;
        });
        writeFileSync(path.join(filePath), newLines.join("\n"));
      }
    });
  });
};

build();