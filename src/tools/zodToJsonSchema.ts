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
  if (schema instanceof z.ZodUnknown || schema instanceof z.ZodAny) {
    return {};
  }
  return {};
}

function isOptional(schema: ZodTypeAny): boolean {
  return schema instanceof z.ZodOptional || schema instanceof z.ZodDefault;
}
