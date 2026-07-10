import { openTarget } from "../../runtime/factory.js";
import type { DockerTargetOptions } from "../../runtime/DockerTarget.js";
import {
  ConnectDockerInputSchema,
  ConnectDockerOutputSchema,
  type ConnectDockerInput,
  type ConnectDockerOutput,
} from "../../schema/tools.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpConnectDockerToolDef = {
  name: "rolepod_wp_connect_docker",
  description:
    "Open a target against a WordPress running inside a docker container (v0.3). Each tool call spawns a fresh `docker exec`. Default docker socket; override via docker_host or docker_socket_path. REST not bound here — use connect_rest if you need it.",
  inputSchema: ConnectDockerInputSchema,
};

export async function wpConnectDockerHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<ConnectDockerOutput> {
  const input: ConnectDockerInput = ConnectDockerInputSchema.parse(raw);
  const opts: DockerTargetOptions = {
    containerName: input.container_name,
    wpPath: input.wp_path,
  };
  if (input.docker_host !== undefined) opts.dockerHost = input.docker_host;
  if (input.docker_socket_path !== undefined)
    opts.dockerSocketPath = input.docker_socket_path;

  const target = await openTarget({ kind: "docker", options: opts });
  const prodGuard = await registry.register(target);

  return ConnectDockerOutputSchema.parse({
    target_id: target.id,
    siteurl: target.siteurl,
    wp_version: target.wpVersion,
    ...(prodGuard ? { prod_guard: prodGuard } : {}),
  });
}
