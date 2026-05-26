import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import Docker from "dockerode";
import { WplabError } from "../util/errors.js";
import { log } from "../util/log.js";
import type {
  CompanionStatus,
  FileWriteOpts,
  RestRequest,
  RestResponse,
  Target,
  WpCliOpts,
  WpCliResult,
} from "./Target.js";

export interface DockerTargetOptions {
  containerName: string;
  wpPath: string;
  /** Override default docker socket / host. Useful for remote docker. */
  dockerHost?: string;
  dockerSocketPath?: string;
}

/**
 * DockerTarget — WordPress running inside a docker container. Spawns
 * `docker exec` per wp-cli call. File ops via `docker cp` analogue (write a
 * tar stream to the container). REST not implemented here.
 */
export class DockerTarget implements Target {
  readonly id: string;
  readonly kind = "docker" as const;
  readonly siteurl: string;
  readonly wpVersion: string;
  readonly phpVersion?: string;
  readonly companion: CompanionStatus = null;

  private readonly _docker: Docker;
  private readonly _containerName: string;
  private readonly _wpPath: string;

  private constructor(args: {
    id: string;
    docker: Docker;
    containerName: string;
    wpPath: string;
    siteurl: string;
    wpVersion: string;
    phpVersion?: string;
  }) {
    this.id = args.id;
    this._docker = args.docker;
    this._containerName = args.containerName;
    this._wpPath = args.wpPath;
    this.siteurl = args.siteurl;
    this.wpVersion = args.wpVersion;
    if (args.phpVersion !== undefined) this.phpVersion = args.phpVersion;
  }

  static async open(opts: DockerTargetOptions): Promise<DockerTarget> {
    const dockerOpts: Docker.DockerOptions = {};
    if (opts.dockerSocketPath) dockerOpts.socketPath = opts.dockerSocketPath;
    if (opts.dockerHost) {
      const url = new URL(opts.dockerHost);
      dockerOpts.host = url.hostname;
      dockerOpts.port = url.port ? Number.parseInt(url.port, 10) : 2375;
    }
    const docker = new Docker(dockerOpts);

    // Probe container exists + wp version
    const container = docker.getContainer(opts.containerName);
    try {
      await container.inspect();
    } catch {
      throw new WplabError(
        "DOCKER_CONTAINER_NOT_FOUND",
        `Container ${opts.containerName} not found`,
        { container: opts.containerName },
      );
    }

    const version = await execInside(docker, opts.containerName, [
      "wp",
      `--path=${opts.wpPath}`,
      "--no-color",
      "core",
      "version",
    ]);
    if (version.exitCode !== 0) {
      throw new WplabError(
        "DOCKER_WP_PROBE_FAILED",
        `wp core version exit ${version.exitCode}: ${version.stderr.slice(0, 200)}`,
        { container: opts.containerName },
      );
    }
    const siteurl = await execInside(docker, opts.containerName, [
      "wp",
      `--path=${opts.wpPath}`,
      "--no-color",
      "option",
      "get",
      "siteurl",
    ]);

    log.info("DockerTarget opened", {
      container: opts.containerName,
      wpPath: opts.wpPath,
    });

    return new DockerTarget({
      id: makeTargetId(),
      docker,
      containerName: opts.containerName,
      wpPath: opts.wpPath,
      siteurl:
        siteurl.stdout.trim() || `docker://${opts.containerName}${opts.wpPath}`,
      wpVersion: version.stdout.trim(),
    });
  }

  rootPath(): string {
    return this._wpPath;
  }

  async wpCli(
    args: readonly string[],
    _opts?: WpCliOpts,
  ): Promise<WpCliResult> {
    const cmd = ["wp", `--path=${this._wpPath}`, "--no-color", ...args];
    const t0 = Date.now();
    const r = await execInside(this._docker, this._containerName, cmd);
    return {
      exitCode: r.exitCode,
      stdout: r.stdout,
      stderr: r.stderr,
      durationMs: Date.now() - t0,
    };
  }

  async rest(_req: RestRequest): Promise<RestResponse> {
    throw new WplabError(
      "NOT_IMPLEMENTED",
      "DockerTarget.rest() not implemented — use RestTarget for HTTP+App Password",
      {},
    );
  }

  async fileRead(
    path: string,
  ): Promise<{ content: string; bytes: number; absolutePath: string }> {
    const abs = `${this._wpPath}/${path}`;
    const r = await execInside(this._docker, this._containerName, ["cat", abs]);
    if (r.exitCode !== 0) {
      throw new WplabError(
        "FILE_READ_FAILED",
        `cat ${abs} exit ${r.exitCode}`,
        {},
      );
    }
    return {
      content: r.stdout,
      bytes: Buffer.byteLength(r.stdout, "utf8"),
      absolutePath: abs,
    };
  }

  async fileWrite(
    path: string,
    content: string,
    _opts: FileWriteOpts = {},
  ): Promise<{
    bytesWritten: number;
    backupPath: string | null;
    absolutePath: string;
  }> {
    const abs = `${this._wpPath}/${path}`;
    // Write via a heredoc-style exec: tee.
    // Note: large binary content not supported by this path; v0.3 ships
    // text-only file writes for docker.
    const r = await execInside(
      this._docker,
      this._containerName,
      [
        "sh",
        "-c",
        `mkdir -p "$(dirname ${shQuote(abs)})" && cat > ${shQuote(abs)}`,
      ],
      content,
    );
    if (r.exitCode !== 0) {
      throw new WplabError(
        "FILE_WRITE_FAILED",
        `tee ${abs} exit ${r.exitCode}`,
        {},
      );
    }
    return {
      bytesWritten: Buffer.byteLength(content, "utf8"),
      backupPath: null,
      absolutePath: abs,
    };
  }

  async fileExists(path: string): Promise<boolean> {
    const r = await execInside(this._docker, this._containerName, [
      "test",
      "-f",
      `${this._wpPath}/${path}`,
    ]);
    return r.exitCode === 0;
  }

  async close(): Promise<void> {
    log.info("DockerTarget closed", { id: this.id });
  }
}

interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function execInside(
  docker: Docker,
  containerName: string,
  cmd: string[],
  stdin?: string,
): Promise<ExecResult> {
  const container = docker.getContainer(containerName);
  const exec = await container.exec({
    Cmd: cmd,
    AttachStdout: true,
    AttachStderr: true,
    AttachStdin: stdin !== undefined,
  });
  const stream = await exec.start({
    hijack: stdin !== undefined,
    stdin: stdin !== undefined,
  });

  let stdout = "";
  let stderr = "";

  if (stdin !== undefined) {
    Readable.from([stdin]).pipe(stream as unknown as NodeJS.WritableStream);
  }

  // dockerode multiplexed stream: write to passthrough buffers.
  await new Promise<void>((resolve, reject) => {
    const outBuf: Buffer[] = [];
    const errBuf: Buffer[] = [];
    // Demux is via header. Simplification: collect all to one buffer.
    stream.on("data", (chunk: Buffer) => {
      // Docker stream header: 8 bytes — stream type (1 = stdout, 2 = stderr) + 7 bytes
      let i = 0;
      while (i < chunk.length) {
        if (i + 8 > chunk.length) break;
        const streamType = chunk[i]!;
        const size = chunk.readUInt32BE(i + 4);
        const payload = chunk.subarray(i + 8, i + 8 + size);
        if (streamType === 1) outBuf.push(payload);
        else if (streamType === 2) errBuf.push(payload);
        i += 8 + size;
      }
    });
    stream.on("end", () => {
      stdout = Buffer.concat(outBuf).toString("utf8");
      stderr = Buffer.concat(errBuf).toString("utf8");
      resolve();
    });
    stream.on("error", reject);
  });

  const inspect = await exec.inspect();
  return { exitCode: inspect.ExitCode ?? -1, stdout, stderr };
}

function makeTargetId(): string {
  return `tgt_${randomBytes(6).toString("hex")}`;
}

function shQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
