import { LocalTarget } from "./LocalTarget.js";
import { RestTarget } from "./RestTarget.js";
import { SshTarget, type SshTargetOptions } from "./SshTarget.js";
import { DockerTarget, type DockerTargetOptions } from "./DockerTarget.js";
import type { Target } from "./Target.js";
import type { Credential } from "../credentials/types.js";

export type ConnectInput =
  | { kind: "local"; path: string }
  | { kind: "rest"; url: string; credential: Credential }
  | { kind: "ssh"; options: SshTargetOptions }
  | { kind: "docker"; options: DockerTargetOptions };

export async function openTarget(input: ConnectInput): Promise<Target> {
  switch (input.kind) {
    case "local":
      return LocalTarget.open(input.path);
    case "rest":
      return RestTarget.open({ url: input.url, credential: input.credential });
    case "ssh":
      return SshTarget.open(input.options);
    case "docker":
      return DockerTarget.open(input.options);
    default: {
      const exhaustive: never = input;
      throw new Error(`Unsupported target kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}
