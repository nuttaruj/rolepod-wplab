import { describe, expect, it } from "vitest";
import { z } from "zod";
import { zodToJsonSchema } from "../../src/tools/zodToJsonSchema.js";
import {
  TargetAliasInputSchema,
  SkillEditInputSchema,
} from "../../src/schema/tools.js";

describe("zodToJsonSchema", () => {
  it("converts a plain object to type:object", () => {
    const s = zodToJsonSchema(z.object({ a: z.string(), b: z.number().optional() }));
    expect(s["type"]).toBe("object");
    expect((s["required"] as string[])).toEqual(["a"]);
  });

  it("unwraps refine()/ZodEffects to the inner object (not {})", () => {
    const s = zodToJsonSchema(
      z.object({ a: z.string() }).refine(() => true, { message: "x" }),
    );
    expect(s["type"]).toBe("object");
    expect(Object.keys(s["properties"] as object)).toContain("a");
  });

  it("flattens discriminatedUnion to type:object with a discriminator enum", () => {
    const s = zodToJsonSchema(
      z.discriminatedUnion("action", [
        z.object({ action: z.literal("set"), v: z.string() }),
        z.object({ action: z.literal("get"), n: z.number() }),
      ]),
    );
    expect(s["type"]).toBe("object");
    expect(s["required"]).toEqual(["action"]);
    const props = s["properties"] as Record<string, { enum?: unknown[] }>;
    expect(props["action"]?.enum).toEqual(["set", "get"]);
    expect(Object.keys(props)).toEqual(expect.arrayContaining(["v", "n"]));
  });

  it("converts a literal to an enum", () => {
    expect(zodToJsonSchema(z.literal("set"))).toEqual({ type: "string", enum: ["set"] });
    expect(zodToJsonSchema(z.literal(5))).toEqual({ type: "number", enum: [5] });
  });

  // Regression: these two real tool schemas previously collapsed to `{}`
  // (no `type`), which made MCP clients reject the ENTIRE tools/list — every
  // wplab tool silently failed to register in Claude Code.
  it("real tool schemas that use refine/discriminatedUnion are valid MCP objects", () => {
    expect(zodToJsonSchema(TargetAliasInputSchema)["type"]).toBe("object");
    expect(zodToJsonSchema(SkillEditInputSchema)["type"]).toBe("object");
  });
});
