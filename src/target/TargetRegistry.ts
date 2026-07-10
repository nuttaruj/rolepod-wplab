import { TargetNotFoundError } from "../util/errors.js";
import { log } from "../util/log.js";
import { guardTarget } from "../runtime/wpCliGuard.js";
import type { Target } from "../runtime/Target.js";

const DEFAULT_IDLE_MS = 10 * 60 * 1000;

interface RegistryEntry {
  target: Target;
  lastTouch: number;
  timer: NodeJS.Timeout;
}

export class TargetRegistry {
  private readonly entries = new Map<string, RegistryEntry>();
  private readonly idleMs: number;

  constructor(idleMs?: number) {
    const envIdle = process.env["ROLEPOD_WPLAB_IDLE_TIMEOUT_MS"];
    const parsed = envIdle ? Number.parseInt(envIdle, 10) : NaN;
    this.idleMs =
      idleMs ??
      (Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_IDLE_MS);
  }

  register(target: Target): void {
    if (this.entries.has(target.id)) {
      throw new Error(`target_id collision: ${target.id}`);
    }
    // Every Target reaches the tool layer through get()/list(), so guarding it
    // here covers every caller and every target kind.
    const entry: RegistryEntry = {
      target: guardTarget(target),
      lastTouch: Date.now(),
      timer: this.armTimer(target.id),
    };
    this.entries.set(target.id, entry);
    log.debug("target registered", { id: target.id, idleMs: this.idleMs });
  }

  get(id: string): Target {
    const entry = this.entries.get(id);
    if (!entry) throw new TargetNotFoundError(id);
    entry.lastTouch = Date.now();
    clearTimeout(entry.timer);
    entry.timer = this.armTimer(id);
    return entry.target;
  }

  list(): readonly Target[] {
    return Array.from(this.entries.values(), (e) => e.target);
  }

  async closeAll(): Promise<void> {
    const all = Array.from(this.entries.values());
    this.entries.clear();
    await Promise.all(
      all.map(async (entry) => {
        clearTimeout(entry.timer);
        try {
          await entry.target.close();
        } catch (err) {
          log.warn("target close failed", {
            id: entry.target.id,
            err: (err as Error).message,
          });
        }
      }),
    );
  }

  async disconnect(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) throw new TargetNotFoundError(id);
    this.entries.delete(id);
    clearTimeout(entry.timer);
    await entry.target.close();
  }

  private armTimer(id: string): NodeJS.Timeout {
    return setTimeout(() => {
      const entry = this.entries.get(id);
      if (!entry) return;
      this.entries.delete(id);
      log.info("target idle-closed", { id });
      entry.target.close().catch((err: unknown) => {
        log.warn("idle close failed", { id, err: (err as Error).message });
      });
    }, this.idleMs).unref();
  }
}
