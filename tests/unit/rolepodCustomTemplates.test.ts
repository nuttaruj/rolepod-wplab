import { describe, it, expect } from "vitest";
import {
  taskClassName,
  taskOptionKeyPart,
  renderTaskModulePhp,
} from "../../src/lib/rolepodCustomTemplates.js";

describe("taskClassName", () => {
  it("converts kebab-case to PascalCase + Task suffix", () => {
    expect(taskClassName("contact-snippet")).toBe("ContactSnippetTask");
    expect(taskClassName("multi-step-form")).toBe("MultiStepFormTask");
    expect(taskClassName("hero")).toBe("HeroTask");
    expect(taskClassName("with_underscore")).toBe("WithUnderscoreTask");
  });
  it("handles mixed-case inputs by lowercasing first", () => {
    expect(taskClassName("MY-Task")).toBe("MyTaskTask");
  });
});

describe("taskOptionKeyPart", () => {
  it("converts hyphens to underscores for valid WP option keys", () => {
    expect(taskOptionKeyPart("contact-snippet")).toBe("contact_snippet");
    expect(taskOptionKeyPart("multi-step-form")).toBe("multi_step_form");
  });
});

describe("renderTaskModulePhp", () => {
  it("renders a minimal task with no settings", () => {
    const php = renderTaskModulePhp({
      taskId: "hello-world",
      title: "Hello World",
      description: "A demo task.",
      settings: [],
      hooksBody: "if ( ! $this->is_enabled() ) return;\nadd_action('init', [$this, 'do_thing']);",
    });
    expect(php).toContain("namespace Rolepod\\Custom\\Modules");
    expect(php).toContain("final class HelloWorldTask extends BaseTask");
    expect(php).toContain("return 'hello-world';");
    expect(php).toContain("return 'Hello World';");
    expect(php).toContain("return 'A demo task.';");
    expect(php).toContain("if ( ! $this->is_enabled() ) return;");
    expect(php).toMatch(/return \[\s*\];/); // empty settings_schema
  });

  it("escapes single quotes in title/description", () => {
    const php = renderTaskModulePhp({
      taskId: "x",
      title: "User's Task",
      description: "Why's it here?",
      settings: [],
      hooksBody: "// noop",
    });
    expect(php).toContain("return 'User\\'s Task';");
    expect(php).toContain("return 'Why\\'s it here?';");
  });

  it("renders settings_schema for each field", () => {
    const php = renderTaskModulePhp({
      taskId: "contact",
      title: "Contact",
      description: "Contact info shortcode.",
      settings: [
        { key: "email", type: "email", label: "Email address", default: "hello@example.com" },
        { key: "show", type: "checkbox", label: "Show contact?", default: true },
        {
          key: "tone",
          type: "select",
          label: "Tone",
          default: "casual",
          options: { casual: "Casual", formal: "Formal" },
        },
      ],
      hooksBody: "add_shortcode('rc_contact', [$this, 'render']);",
    });
    expect(php).toContain("'email' =>");
    expect(php).toContain("'type' => 'email'");
    expect(php).toContain("'label' => 'Email address'");
    expect(php).toContain("'default' => 'hello@example.com'");
    expect(php).toContain("'show' =>");
    expect(php).toContain("'type' => 'checkbox'");
    expect(php).toContain("'default' => true");
    expect(php).toContain("'tone' =>");
    expect(php).toContain("'type' => 'select'");
    expect(php).toContain("'options' => ['casual' => 'Casual', 'formal' => 'Formal']");
    expect(php).toContain("add_shortcode('rc_contact', [$this, 'render']);");
  });

  it("appends extra_methods when provided", () => {
    const php = renderTaskModulePhp({
      taskId: "x",
      title: "X",
      description: "X",
      settings: [],
      hooksBody: "// noop",
      extraMethods: "\tpublic function render() { return 'hi'; }",
    });
    expect(php).toContain("public function render() { return 'hi'; }");
  });

  it("produces valid PHP open tag + declare strict_types", () => {
    const php = renderTaskModulePhp({
      taskId: "x",
      title: "X",
      description: "X",
      settings: [],
      hooksBody: "// noop",
    });
    expect(php.startsWith("<?php\ndeclare(strict_types=1);")).toBe(true);
  });
});
