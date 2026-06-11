/**
 * Agent-Core MCP Client — Backend Server
 *
 * Express server that:
 * 1. Serves the chat UI (public/)
 * 2. Proxies chat messages through LLM providers
 * 3. Connects to the MCP server and executes tool calls
 * 4. Streams responses back to the UI via SSE
 */
import "dotenv/config";
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { McpClient } from "./mcp-client.js";
import { LLMRouter } from "./llm-router.js";
import type { ChatMessage, ToolCall } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || "3100", 10);

// ─── Config ──────────────────────────────────────────────────────────────────

const MCP_SERVER_URL = process.env.MCP_SERVER_URL || "http://localhost:8080/mcp";
const MCP_API_KEY = process.env.MCP_API_KEY || "";
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || "groq:openai/gpt-oss-20b";
const MAX_TOOL_ROUNDS = parseInt(process.env.MAX_TOOL_ROUNDS || "10", 10);

// ─── App Setup ───────────────────────────────────────────────────────────────

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(join(__dirname, "..", "public")));

const mcpClient = new McpClient(MCP_SERVER_URL, MCP_API_KEY);
const llmRouter = new LLMRouter();

// ─── API Routes ──────────────────────────────────────────────────────────────

/** Health check */
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    mcpConnected: mcpClient.isConnected(),
    mcpServerUrl: MCP_SERVER_URL,
    defaultModel: DEFAULT_MODEL,
    availableProviders: llmRouter.getAvailableProviders(),
  });
});

/** Connect to MCP server and list available tools */
app.post("/api/connect", async (_req, res) => {
  try {
    await mcpClient.connect();
    const tools = mcpClient.getTools();
    const prompts = mcpClient.getPrompts();
    res.json({
      connected: true,
      tools: tools.map((t) => ({ name: t.name, description: t.description })),
      prompts: prompts.map((p) => ({ name: p.name, description: p.description })),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: `Failed to connect: ${msg}` });
  }
});

/** Disconnect from MCP server */
app.post("/api/disconnect", async (_req, res) => {
  await mcpClient.disconnect();
  res.json({ disconnected: true });
});

/** Get available models */
app.get("/api/models", (_req, res) => {
  res.json({ models: llmRouter.getAvailableModels(), default: DEFAULT_MODEL });
});

/** Stream a chat completion with tool calling */
app.post("/api/chat", async (req, res) => {
  const { messages, model, systemPrompt } = req.body as {
    messages: ChatMessage[];
    model?: string;
    systemPrompt?: string;
  };

  if (!messages || !Array.isArray(messages)) {
    res.status(400).json({ error: "messages array required" });
    return;
  }

  // Set up SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const selectedModel = model || DEFAULT_MODEL;
    const tools = mcpClient.isConnected() ? mcpClient.getToolsForLLM() : [];

    // Build system prompt with tool awareness
    const system = buildSystemPrompt(systemPrompt, tools);

    let conversationMessages: ChatMessage[] = [
      { role: "system", content: system },
      ...messages,
    ];

    let round = 0;

    // Tool-calling loop
    while (round < MAX_TOOL_ROUNDS) {
      round++;
      send("status", { round, status: "thinking" });

      const response = await llmRouter.chat(selectedModel, conversationMessages, tools);

      // Stream text content
      if (response.content) {
        send("text", { content: response.content });
      }

      // Check for tool calls
      if (!response.toolCalls || response.toolCalls.length === 0) {
        break; // No more tool calls — done
      }

      // Execute each tool call
      send("status", { round, status: "calling_tools", count: response.toolCalls.length });

      // Add assistant message with tool calls
      conversationMessages.push({
        role: "assistant",
        content: response.content || "",
        toolCalls: response.toolCalls,
      });

      for (const tc of response.toolCalls) {
        send("tool_call", { id: tc.id, name: tc.name, args: tc.args });

        try {
          const result = await mcpClient.callTool(tc.name, tc.args);
          send("tool_result", { id: tc.id, name: tc.name, result });

          conversationMessages.push({
            role: "tool",
            content: typeof result === "string" ? result : JSON.stringify(result),
            toolCallId: tc.id,
          });
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          send("tool_error", { id: tc.id, name: tc.name, error: errMsg });

          conversationMessages.push({
            role: "tool",
            content: JSON.stringify({ error: errMsg }),
            toolCallId: tc.id,
          });
        }
      }
    }

    if (round >= MAX_TOOL_ROUNDS) {
      send("warning", { message: `Reached max tool rounds (${MAX_TOOL_ROUNDS})` });
    }

    send("done", { rounds: round });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    send("error", { message: msg });
  } finally {
    res.end();
  }
});

/** Execute a single tool directly (for debugging) */
app.post("/api/tool", async (req, res) => {
  const { name, args } = req.body as { name: string; args: Record<string, unknown> };
  if (!name) {
    res.status(400).json({ error: "tool name required" });
    return;
  }

  try {
    const result = await mcpClient.callTool(name, args || {});
    res.json({ result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: msg });
  }
});

/** Get a prompt template */
app.post("/api/prompt", async (req, res) => {
  const { name, args } = req.body as { name: string; args?: Record<string, string> };
  if (!name) {
    res.status(400).json({ error: "prompt name required" });
    return;
  }

  try {
    const result = await mcpClient.getPrompt(name, args || {});
    res.json({ prompt: result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: msg });
  }
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildSystemPrompt(
  custom: string | undefined,
  tools: { name: string; description: string }[]
): string {
  const base = custom || `You are Agent-Core, an intelligent AI assistant with access to powerful tools.
You can store and search memories, manage tasks, analyze data, track costs, and more.
When a user asks something that would benefit from a tool, use it. Be concise and helpful.
Always explain what you're doing when using tools.`;

  if (tools.length === 0) return base;

  const toolList = tools.map((t) => `  - ${t.name}: ${t.description}`).join("\n");
  return `${base}\n\nYou have access to the following tools:\n${toolList}`;
}

// ─── Start ───────────────────────────────────────────────────────────────────

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🖥️  Agent-Core MCP Client running on http://localhost:${PORT}`);
  console.log(`   MCP Server: ${MCP_SERVER_URL}`);
  console.log(`   Default Model: ${DEFAULT_MODEL}`);
  console.log(`   Providers: ${llmRouter.getAvailableProviders().join(", ") || "none configured"}`);
});
