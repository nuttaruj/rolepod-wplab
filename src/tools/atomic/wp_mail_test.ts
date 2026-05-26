import { CompanionBridge } from "../../companion/Bridge.js";
import {
  MailTestInputSchema,
  MailTestOutputSchema,
  type MailTestInput,
  type MailTestOutput,
} from "../../schema/tools.js";
import { WplabError } from "../../util/errors.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpMailTestToolDef = {
  name: "rolepod_wp_mail_test",
  description:
    "Send a test email via wp_mail(). Path 1: companion execute-php (preferred — gets real PHP wp_mail() with site SMTP plugins). Path 2: wp-cli `wp eval` shell-out for non-companion targets. Returns delivered=true if wp_mail() returned true. confirm=true required.",
  inputSchema: MailTestInputSchema,
};

const PHP_PAYLOAD = (to: string, subject: string, body: string): string =>
  `$to=${JSON.stringify(to)};$subject=${JSON.stringify(subject)};$body=${JSON.stringify(body)};return wp_mail($to,$subject,$body);`;

export async function wpMailTestHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<MailTestOutput> {
  const input: MailTestInput = MailTestInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const payload = PHP_PAYLOAD(input.to, input.subject, input.body);

  if (
    target.companion?.installed &&
    target.companion.enabled &&
    target.companion.capabilities.includes("execute_php")
  ) {
    const bridge = new CompanionBridge(target);
    await bridge.handshake();
    const res = await bridge.executePhp(payload, { timeoutMs: 10_000 });
    if (!res.ok) {
      throw new WplabError(
        "MAIL_TEST_PHP_FAILED",
        res.error_message ?? "execute-php failure",
        { audit_id: res.audit_id },
      );
    }
    return MailTestOutputSchema.parse({
      to: input.to,
      delivered: res.return_value === true,
      source: "companion_php",
      detail:
        res.return_value === true
          ? "wp_mail() returned true"
          : "wp_mail() returned false — check SMTP config",
    });
  }

  // No kind gate since v1.4 — RestTarget routes wp eval through the
  // companion's /wp-cli endpoint. If companion is missing, wpCli() itself
  // surfaces CompanionUnavailableError with install URL.
  const r = await target.wpCli(["eval", payload], {
    allowDestructive: true,
    timeoutMs: 15_000,
  });
  if (r.exitCode !== 0) {
    throw new WplabError("MAIL_TEST_CLI_FAILED", r.stderr.slice(0, 200), {
      exitCode: r.exitCode,
    });
  }
  const delivered = /^1?$/.test(r.stdout.trim())
    ? r.stdout.trim() === "1"
    : false;
  return MailTestOutputSchema.parse({
    to: input.to,
    delivered,
    source: "wp_cli_eval",
    detail: delivered
      ? "wp_mail() returned true"
      : `wp_mail() returned ${r.stdout.trim() || "false"}`,
  });
}
