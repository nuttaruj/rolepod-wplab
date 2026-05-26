import { randomBytes } from "node:crypto";

/**
 * Generates a `wplab_YYYYMMDDTHHMMSS_<8-char-hex>` run id (sortable + unique).
 */
export function makeRunId(): string {
  const d = new Date();
  const ts =
    d.getUTCFullYear().toString().padStart(4, "0") +
    (d.getUTCMonth() + 1).toString().padStart(2, "0") +
    d.getUTCDate().toString().padStart(2, "0") +
    "T" +
    d.getUTCHours().toString().padStart(2, "0") +
    d.getUTCMinutes().toString().padStart(2, "0") +
    d.getUTCSeconds().toString().padStart(2, "0");
  return `wplab_${ts}_${randomBytes(4).toString("hex")}`;
}
