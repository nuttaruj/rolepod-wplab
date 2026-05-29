import { z, ZodTypeAny } from "zod";

/**
 * Minimal Zod → JSON Schema converter for MCP tool definitions.
 *
 * MCP expects `inputSchema` to be a JSON Schema object. v0.0 ships its own
 * tiny converter to avoid pulling in `zod-to-json-schema` for the handful of
 * primitives we use. v0.1 will swap to the canonical lib if we hit edge cases.
 */
export function zodToJsonSchema(schema: ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, ZodTypeAny>;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(value);
      if (!isOptional(value)) required.push(key);
    }
    return {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    };
  }
  if (schema instanceof z.ZodString) return { type: "string" };
  if (schema instanceof z.ZodNumber) return { type: "number" };
  if (schema instanceof z.ZodBoolean) return { type: "boolean" };
  if (schema instanceof z.ZodArray) {
    return {
      type: "array",
      items: zodToJsonSchema(schema.element as ZodTypeAny),
    };
  }
  if (schema instanceof z.ZodEnum) {
    return { type: "string", enum: schema.options as string[] };
  }
  if (schema instanceof z.ZodOptional) {
    return zodToJsonSchema(schema.unwrap() as ZodTypeAny);
  }
  if (schema instanceof z.ZodDefault) {
    const inner = zodToJsonSchema(
      (schema._def as { innerType: ZodTypeAny }).innerType,
    );
    return {
      ...inner,
      default: (schema._def as { defaultValue: () => unknown }).defaultValue(),
    };
  }
  if (schema instanceof z.ZodNullable) {
    const inner = zodToJsonSchema(
      (schema._def as { innerType: ZodTypeAny }).innerType,
    );
    return { ...inner, nullable: true };
  }
  // refine()/transform() wrap the real schema in ZodEffects. The JSON shape is
  // unchanged by the effect, so unwrap to the inner schema. Without this the
  // tool's inputSchema collapses to `{}` (no `type`), and MCP clients that
  // validate tools/list reject the WHOLE list — silently dropping every tool
  // on the server.
  if (schema instanceof z.ZodEffects) {
    return zodToJsonSchema((schema._def as { schema: ZodTypeAny }).schema);
  }
  // discriminatedUnion has no single JSON-Schema `type`. MCP requires
  // inputSchema.type === "object", so flatten to one object: merge every
  // variant's properties, expose the discriminator as an enum of its literal
  // values, and require only the discriminator. Per-variant strictness is still
  // enforced by the Zod schema at parse time in the handler.
  if (schema instanceof z.ZodDiscriminatedUnion) {
    const discriminator = (schema._def as { discriminator: string }).discriminator;
    const properties: Record<string, unknown> = {};
    const discValues: unknown[] = [];
    for (const opt of schema.options as z.ZodObject<z.ZodRawShape>[]) {
      const converted = zodToJsonSchema(opt);
      Object.assign(properties, (converted["properties"] as Record<string, unknown>) ?? {});
      const discField = opt.shape[discriminator];
      const litVal = (discField?._def as { value?: unknown } | undefined)?.value;
      if (litVal !== undefined) discValues.push(litVal);
    }
    if (discValues.length > 0) {
      properties[discriminator] = { type: "string", enum: discValues };
    }
    return {
      type: "object",
      properties,
      required: [discriminator],
      additionalProperties: false,
    };
  }
  if (schema instanceof z.ZodLiteral) {
    const value = (schema._def as { value: unknown }).value;
    const type =
      typeof value === "number"
        ? "number"
        : typeof value === "boolean"
          ? "boolean"
          : "string";
    return { type, enum: [value] };
  }
  if (schema instanceof z.ZodUnknown || schema instanceof z.ZodAny) {
    return {};
  }
  return {};
}

function isOptional(schema: ZodTypeAny): boolean {
  return schema instanceof z.ZodOptional || schema instanceof z.ZodDefault;
}
