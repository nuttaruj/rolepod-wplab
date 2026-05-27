import { z } from "zod";
import { bridgeFor } from "../../companion/Bridge.js";
import { recordChange } from "../../companion/ledger.js";
import { WplabError } from "../../util/errors.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const Cf7FormCreateInputSchema = z.object({
  target_id: z.string(),
  title: z.string().min(1),
  form_markup: z
    .string()
    .min(1)
    .describe(
      "The CF7 form template body (the field-tag markup, NOT including the wrapping form element). Standard CF7 syntax.",
    ),
  mail_recipient: z.string().email(),
  mail_subject: z.string().default("Website contact"),
  mail_body: z.string().optional(),
  mail_from: z.string().optional(),
});

export const wpCf7FormCreateToolDef = {
  name: "rolepod_wp_cf7_form_create",
  description:
    "Create a Contact Form 7 form (wpcf7_contact_form CPT). Configures _form markup + _mail recipient/subject/body. Returns form id + ready-to-paste shortcode. Refuses if CF7 plugin not active. Auto-ledgered.",
  inputSchema: Cf7FormCreateInputSchema,
};

export async function wpCf7FormCreateHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<unknown> {
  const input = Cf7FormCreateInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  if (!target.companion?.enabled) {
    throw new WplabError(
      "COMPANION_REQUIRED",
      "wp_cf7_form_create requires the rolepod-wp companion.",
      { targetId: input.target_id },
    );
  }
  const bridge = await bridgeFor(target);

  const mailBody =
    input.mail_body ??
    "From: [your-name] <[your-email]>\nSubject: [your-subject]\n\n[your-message]";
  const mailFrom =
    input.mail_from ?? "[your-name] <noreply@${siteurl-domain}>";

  const mail = {
    subject: input.mail_subject,
    sender: mailFrom,
    body: mailBody,
    recipient: input.mail_recipient,
    additional_headers: "Reply-To: [your-email]",
    attachments: "",
    use_html: false,
    exclude_blank: false,
  };

  const messages = {
    mail_sent_ok: "Thanks — we got your message.",
    mail_sent_ng: "There was an error sending the message. Please try again.",
    validation_error: "Please check the fields below.",
    spam: "Sorry, your message looks like spam.",
    accept_terms: "You must accept the terms to send.",
    invalid_required: "Required field.",
    invalid_too_long: "Too long.",
    invalid_too_short: "Too short.",
  };

  const payload = `if (!class_exists('WPCF7') && !post_type_exists('wpcf7_contact_form')) {
  return ['error' => 'CF7_NOT_ACTIVE', 'detail' => 'Install + activate Contact Form 7 before using this tool.'];
}
$form_id = wp_insert_post([
  'post_title' => ${JSON.stringify(input.title)},
  'post_status' => 'publish',
  'post_type' => 'wpcf7_contact_form',
  'post_content' => '',
]);
if (is_wp_error($form_id) || !$form_id) return ['error' => 'INSERT_FAILED'];
update_post_meta($form_id, '_form', ${JSON.stringify(input.form_markup)});
update_post_meta($form_id, '_mail', ${JSON.stringify(JSON.stringify(mail))});
$mail_decoded = json_decode(${JSON.stringify(JSON.stringify(mail))}, true);
update_post_meta($form_id, '_mail', $mail_decoded);
$messages_decoded = json_decode(${JSON.stringify(JSON.stringify(messages))}, true);
update_post_meta($form_id, '_messages', $messages_decoded);
update_post_meta($form_id, '_mail_2', ['active' => false, 'subject' => '', 'sender' => '', 'body' => '', 'recipient' => '', 'additional_headers' => '', 'attachments' => '', 'use_html' => false, 'exclude_blank' => false]);
update_post_meta($form_id, '_additional_settings', '');
return ['form_id' => (int) $form_id, 'shortcode' => '[contact-form-7 id="' . $form_id . '" title="' . esc_attr(${JSON.stringify(input.title)}) . '"]'];`;

  const result = await bridge.executePhp(payload);
  if (!result.ok) {
    throw new WplabError(
      result.error_code ?? "CF7_FORM_CREATE_FAILED",
      result.error_message ?? "wp_cf7_form_create execute-php failed",
      { result },
    );
  }
  const rv = (result.return_value ?? {}) as {
    form_id?: number;
    shortcode?: string;
    error?: string;
    detail?: string;
  };
  if (rv.error) {
    throw new WplabError(rv.error, rv.detail ?? rv.error, {});
  }
  await recordChange(target, {
    category: "post",
    subcategory: `cf7-form:${rv.form_id}`,
    targetDescriptor: `CF7 form "${input.title}" created`,
    beforeState: null,
    afterState: { form_id: rv.form_id, title: input.title, recipient: input.mail_recipient },
    reversible: true,
    sourceTool: "wp_cf7_form_create",
  });
  return rv;
}
