import { loadStandaloneConfig } from "./config";
import { startStandaloneServer } from "./StandaloneServer";

const config = loadStandaloneConfig();
const server = await startStandaloneServer(config);
console.log(`Last Line standalone server listening at ${server.origin}`);
console.log(`Persistent data: ${config.dataDirectory}`);

let shutdown: Promise<void> | null = null;
const stop = (signal: NodeJS.Signals): void => {
  if (shutdown) return;
  console.log(`Received ${signal}; checkpointing rooms and stopping`);
  shutdown = server.close()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error("Standalone shutdown failed", error);
      process.exit(1);
    });
};

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
