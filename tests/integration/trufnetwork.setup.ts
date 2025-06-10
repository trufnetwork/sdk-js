import { beforeAll, afterAll } from "vitest";
import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import process from "node:process";
import { Wallet } from "ethers";

const exec = promisify(execCb);

interface ContainerSpec {
  name: string;
  image: string;
  tmpfsPath?: string;
  envVars?: string[];
  ports?: Record<string, string>;
  entrypoint?: string;
  args?: string[];
}

const NETWORK_NAME = "truf-test-network";
const KWIL_PROVIDER_URL = "http://localhost:8484";
const DB_PRIVATE_KEY = "0000000000000000000000000000000000000000000000000000000000000001";

// Use a distinct manager wallet for role-management tests.
export const MANAGER_PRIVATE_KEY = "0x1111111111111111111111111111111111111111111111111111111111111111";

const POSTGRES_CONTAINER: ContainerSpec = {
  name: "test-kwil-postgres",
  image: "kwildb/postgres:latest",
  tmpfsPath: "/var/lib/postgresql/data",
  envVars: ["POSTGRES_HOST_AUTH_METHOD=trust"],
  ports: { "5432": "5432" },
};

const TN_DB_CONTAINER: ContainerSpec = {
  name: "test-tn-db",
  image: "tn-db:local",
  tmpfsPath: "/root/.kwild",
  entrypoint: "/app/kwild",
  args: [
    "start",
    "--autogen",
    "--root",
    "/root/.kwild",
    "--db-owner",
    "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf",
    "--db.host",
    "test-kwil-postgres",
    "--consensus.propose-timeout",
    "500ms",
    "--consensus.empty-block-timeout",
    "30s",
  ],
  envVars: [
    "CONFIG_PATH=/root/.kwild",
    "KWILD_APP_HOSTNAME=test-tn-db",
    "KWILD_APP_PG_DB_HOST=test-kwil-postgres",
    "KWILD_APP_PG_DB_PORT=5432",
    "KWILD_APP_PG_DB_USER=postgres",
    "KWILD_APP_PG_DB_PASSWORD=",
    "KWILD_APP_PG_DB_NAME=postgres",
    "KWILD_CHAIN_P2P_EXTERNAL_ADDRESS=http://test-tn-db:26656",
  ],
  ports: { "8080": "8080", "8484": "8484", "26656": "26656" },
};

async function runDockerCommand(args: string[], check = false) {
  const command = `docker ${args.join(" ")}`;
  try {
    const { stdout, stderr } = await exec(command);
    if (stderr) {
      console.debug(stderr);
    }
    return { stdout, stderr };
  } catch (error: any) {
    if (check) {
      throw new Error(error.stderr || error.message);
    }
    return { stdout: error.stdout || "", stderr: error.stderr || error.message };
  }
}

async function startContainer(spec: ContainerSpec, network: string) {
  // Remove existing container if any
  await runDockerCommand(["rm", "-f", spec.name]);

  const args: string[] = [
    "run",
    "--rm",
    "--name",
    spec.name,
    "--network",
    network,
    "-d",
  ];

  if (spec.tmpfsPath) {
    args.push("--tmpfs", spec.tmpfsPath);
  }

  spec.envVars?.forEach((env) => {
    args.push("-e", env);
  });

  Object.entries(spec.ports ?? {}).forEach(([hostPort, containerPort]) => {
    args.push("-p", `${hostPort}:${containerPort}`);
  });

  if (spec.entrypoint) {
    args.push("--entrypoint", spec.entrypoint);
  }

  args.push(spec.image);

  if (spec.args?.length) {
    args.push(...spec.args);
  }

  await runDockerCommand(args, true);
}

async function stopContainer(name: string) {
  await runDockerCommand(["stop", name]);
}

async function waitForPostgresHealth(maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await runDockerCommand([
        "exec",
        POSTGRES_CONTAINER.name,
        "pg_isready",
        "-U",
        "postgres",
      ]);
      if (res.stdout.includes("accepting connections")) {
        console.info(`Postgres healthy after ${i + 1} attempts`);
        return true;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function waitForTnHealth(maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch("http://localhost:8484/api/v1/health");
      if (response.ok) {
        const data: any = await response.json();
        if (data?.healthy && data?.services?.user?.block_height >= 1) {
          console.info(`TN-DB healthy after ${i + 1} attempts`);
          return true;
        }
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function runMigrationTask() {
  const nodeRepoDir = process.env.NODE_REPO_DIR;
  if (!nodeRepoDir) {
    console.warn("NODE_REPO_DIR not set; skipping migration task");
    return true; // Skip instead of fail in JS tests
  }
  const providerArg = `PROVIDER=${KWIL_PROVIDER_URL}`;
  const privateKeyArg = `PRIVATE_KEY=${DB_PRIVATE_KEY}`;
  // Ensure the admin wallet used in migrations matches the test "manager" wallet.
  // The wallet address is derived from the same hard-coded DB_PRIVATE_KEY.
  const adminWalletAddress = new Wallet(MANAGER_PRIVATE_KEY).address.toLowerCase();
  const adminWalletArg = `ADMIN_WALLET=${adminWalletAddress}`;
  try {
    await exec(`task action:migrate ${providerArg} ${privateKeyArg} ${adminWalletArg}`, {
      cwd: nodeRepoDir,
    });
    console.info("Migration task completed successfully");
    return true;
  } catch (error: any) {
    console.error("Migration task failed", error.stderr || error.message);
    return false;
  }
}

async function createDockerNetwork() {
  // Remove existing network (ignore errors)
  await runDockerCommand(["network", "rm", NETWORK_NAME]);
  // Create network
  await runDockerCommand(["network", "create", NETWORK_NAME], true);
}

async function removeDockerNetwork() {
  await runDockerCommand(["network", "rm", NETWORK_NAME]);
}

// ------------------- Helper -------------------

let referenceCount = 0;
let containersStarted = false;

export function setupTrufNetwork() {
  // Ensure this function can be called multiple times safely from different test files.

  beforeAll(async () => {
    referenceCount += 1;
    if (containersStarted) return;

    console.info("Setting up TrufNetwork test environment...");
    await createDockerNetwork();

    console.info("Starting Postgres container...");
    await startContainer(POSTGRES_CONTAINER, NETWORK_NAME);
    const pgHealthy = await waitForPostgresHealth();
    if (!pgHealthy) {
      throw new Error("Postgres failed to become healthy");
    }

    console.info("Starting TN-DB container...");
    await startContainer(TN_DB_CONTAINER, NETWORK_NAME);
    const tnHealthy = await waitForTnHealth();
    if (!tnHealthy) {
      throw new Error("TN-DB failed to become healthy");
    }

    const migrated = await runMigrationTask();
    if (!migrated) {
      throw new Error("Migration task failed");
    }

    containersStarted = true;
  });

  afterAll(async () => {
    referenceCount -= 1;
    if (referenceCount === 0 && containersStarted) {
      console.info("Tearing down TrufNetwork test environment...");
      await stopContainer(TN_DB_CONTAINER.name);
      await stopContainer(POSTGRES_CONTAINER.name);
      await removeDockerNetwork();
      containersStarted = false;
    }
  });
} 