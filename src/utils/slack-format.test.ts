import { describe, it, expect } from "vitest";
import { section, context, divider, actions, button, richMessage, taskStatusMessage, codeBlock } from "./slack-format";

describe("Slack formatting", () => {
  it("section creates section block", () => {
    const block = section("Hello *world*");
    expect(block.type).toBe("section");
    expect(block.text.type).toBe("mrkdwn");
    expect(block.text.text).toBe("Hello *world*");
  });

  it("context creates context block", () => {
    const block = context("Item 1", "Item 2");
    expect(block.type).toBe("context");
    expect(block.elements).toHaveLength(2);
  });

  it("divider creates divider block", () => {
    const block = divider();
    expect(block.type).toBe("divider");
  });

  it("actions creates actions block", () => {
    const block = actions([button("Click", "action_1")]);
    expect(block.type).toBe("actions");
    expect(block.elements).toHaveLength(1);
  });

  it("button creates button element", () => {
    const btn = button("Click me", "action_1", "primary", "value_1");
    expect(btn.type).toBe("button");
    expect(btn.text.text).toBe("Click me");
    expect(btn.action_id).toBe("action_1");
    expect(btn.style).toBe("primary");
    expect(btn.value).toBe("value_1");
  });

  it("richMessage creates complete message", () => {
    const blocks = richMessage("Title", ["Section 1", "Section 2"], [button("Action", "act")], "Context text");
    expect(blocks.length).toBe(5); // header, divider, 2 sections, actions, context
    expect(blocks[0].type).toBe("header");
    expect(blocks[1].type).toBe("divider");
  });

  it("taskStatusMessage creates status blocks", () => {
    const blocks = taskStatusMessage("task_123", "running", "Processing...");
    expect(blocks[0].type).toBe("header");
    expect(blocks[0].text.text).toContain("🔄");
  });

  it("codeBlock formats code", () => {
    const code = codeBlock("const x = 1", "typescript");
    expect(code).toBe("```typescript\nconst x = 1\n```");
  });
});
