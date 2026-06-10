import type { KnownBlock, ActionsBlock, ContextBlock } from "@slack/types";

/** Build a section block with markdown text */
export function section(text: string, blockId?: string): KnownBlock {
  return {
    type: "section",
    text: { type: "mrkdwn", text },
    ...(blockId && { block_id: blockId }),
  };
}

/** Build a context block (small gray text) */
export function context(...elements: string[]): KnownBlock {
  return {
    type: "context",
    elements: elements.map((e) => ({ type: "mrkdwn" as const, text: e })),
  } as ContextBlock;
}

/** Build a divider */
export function divider(): KnownBlock {
  return { type: "divider" };
}

/** Build an actions block with buttons */
export function actions(elements: any[], blockId?: string): KnownBlock {
  return {
    type: "actions",
    elements,
    ...(blockId && { block_id: blockId }),
  } as ActionsBlock;
}

/** Build a button element */
export function button(
  text: string,
  actionId: string,
  style?: "primary" | "danger",
  value?: string
): any {
  return {
    type: "button",
    text: { type: "plain_text", text, emoji: true },
    action_id: actionId,
    ...(style && { style }),
    ...(value && { value }),
  };
}

/** Build a select menu (static options) */
export function selectMenu(
  placeholder: string,
  actionId: string,
  options: { text: string; value: string }[],
  initialOption?: string
): any {
  return {
    type: "static_select",
    placeholder: { type: "plain_text", text: placeholder },
    action_id: actionId,
    options: options.map((o) => ({
      text: { type: "plain_text" as const, text: o.text },
      value: o.value,
    })),
    ...(initialOption && {
      initial_option: { text: { type: "plain_text" as const, text: initialOption }, value: initialOption },
    }),
  };
}

/** Build a markdown code block */
export function codeBlock(code: string, language = ""): string {
  return `\`\`\`${language}\n${code}\n\`\`\``;
}

/** Build a rich message with header, sections, actions */
export function richMessage(
  header: string,
  sections: string[],
  actionElements?: any[],
  contextText?: string
): KnownBlock[] {
  const blocks: KnownBlock[] = [
    { type: "header", text: { type: "plain_text", text: header } },
    divider(),
    ...sections.map((s) => section(s)),
  ];
  if (actionElements && actionElements.length > 0) blocks.push(actions(actionElements));
  if (contextText) blocks.push(context(contextText));
  return blocks;
}

/** Build a task status message */
export function taskStatusMessage(
  taskId: string,
  status: "pending" | "running" | "completed" | "failed",
  details: string,
  actionElements?: any[]
): KnownBlock[] {
  const emoji = { pending: "⏳", running: "🔄", completed: "✅", failed: "❌" }[status];
  return richMessage(
    `${emoji} Task ${status}`,
    [`*Task ID:* \`${taskId}\``, details],
    actionElements,
    `Updated ${new Date().toLocaleTimeString()}`
  );
}

/** Build a memory search result message */
export function memoryResultMessage(
  query: string,
  results: { content: string; score: number; metadata?: Record<string, unknown> }[]
): KnownBlock[] {
  if (results.length === 0) {
    return [
      section(`🔍 No memories found for: *${query}*`),
      context("Try a broader search or add relevant memories first."),
    ];
  }
  return [
    section(`🔍 *${results.length}* memories for: *${query}*`),
    divider(),
    ...results.map((r, i) =>
      section(
        `${i + 1}. ${r.content.slice(0, 300)}${r.content.length > 300 ? "..." : ""}\n> Score: ${(r.score * 100).toFixed(1)}%`
      )
    ),
  ];
}

/** Build a model selection message */
export function modelSelectionMessage(
  taskType: string,
  selectedModel: string,
  reason: string
): KnownBlock[] {
  return [
    section(`🧠 *Model Selected* for \`${taskType}\``),
    section(`*Model:* \`${selectedModel}\``),
    section(`*Reason:* ${reason}`),
    context("Model routing policy applied automatically."),
  ];
}
