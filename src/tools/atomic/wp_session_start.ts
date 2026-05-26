import { randomBytes } from "node:crypto";
import { z } from "zod";

export const SessionStartInputSchema = z.object({
  label: z.string().optional(),
});

export const wpSessionStartToolDef = {
  name: "rolepod_wp_session_start",
  description:
    "Issue a fresh session_id for correlating a group of AI-issued writes in the Change Ledger. All subsequent writer tools that opt into the ledger (post_create / post_update / option_set / file_write / etc.) tag their rows with this id via env ROLEPOD_WPLAB_SESSION. Query the ledger with `source_session: <id>` to revert the whole group atomically with `rolepod_wp_changes_toggle_bulk`.",
  inputSchema: SessionStartInputSchema,
};

export async function wpSessionStartHandler(
  _registry: unknown,
  raw: unknown,
): Promise<{ session_id: string; env_var: string; label?: string }> {
  const input = SessionStartInputSchema.parse(raw);
  const sessionId = `sess_${randomBytes(8).toString("hex")}`;
  process.env["ROLEPOD_WPLAB_SESSION"] = sessionId;
  const out: { session_id: string; env_var: string; label?: string } = {
    session_id: sessionId,
    env_var: "ROLEPOD_WPLAB_SESSION",
  };
  if (input.label !== undefined) out.label = input.label;
  return out;
}
