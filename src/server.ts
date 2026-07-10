import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadProfile } from "./profile/load.js";
import { ProdGuard } from "./safety/ProdGuard.js";
import { TargetRegistry } from "./target/TargetRegistry.js";
import { registerTools } from "./tools/registerTools.js";
import { log } from "./util/log.js";

export interface CreateServerOptions {
  /** Skip transport bind — useful for unit tests that just want a wired Server instance. */
  withoutTransport?: boolean;
}

export async function createServer(opts: CreateServerOptions = {}): Promise<{
  server: Server;
  registry: TargetRegistry;
  shutdown: () => Promise<void>;
}> {
  const profile = loadProfile();
  const prodGuard = new ProdGuard(profile.production_hosts);
  const registry = new TargetRegistry(undefined, prodGuard);

  log.info("rolepod-wplab boot", {
    version: "0.0.0",
    profile: profile.profile,
    production_hosts: profile.production_hosts,
    companion_required: profile.companion.require_installed,
  });

  const server = new Server(
    { name: "rolepod-wplab", version: "0.0.0" },
    { capabilities: { tools: {} } },
  );

  registerTools(server, { registry, prodGuard });

  if (!opts.withoutTransport) {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    log.info("MCP stdio transport ready");
  }

  const shutdown = async (): Promise<void> => {
    log.info("shutdown requested");
    await registry.closeAll();
  };

  return { server, registry, shutdown };
}
