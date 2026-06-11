/**
 * MCP Client — connects to the agent-core MCP server
 * Uses the MCP SDK's StreamableHTTP client transport.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { MCPTool, MCPPrompt } from "./types.js";

export class McpClient {
  private serverUrl: string;
  private apiKey: string;
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;
  private tools: MCPTool[] = [];
  private prompts: MCPPrompt[] = [];

  constructor(serverUrl: string, apiKey: string) {
    this.serverUrl = serverUrl;
    this.apiKey = apiKey;
  }

  isConnected(): boolean {
    return this.client !== null;
  }

  async connect(): Promise<void> {
    if (this.client) {
      await this.disconnect();
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    this.transport = new StreamableHTTPClientTransport(
      new URL(this.serverUrl),
      { requestInit: { headers } }
    );

    this.client = new Client({
      name: "agent-core-mcp-client",
      version: "1.0.0",
    });

    await this.client.connect(this.transport);

    // Fetch available tools
    try {
      const toolsResult = await this.client.listTools();
      this.tools = (toolsResult.tools || []).map((t) => ({
        name: t.name,
        description: t.description || "",
        inputSchema: t.inputSchema as Record<string, unknown>,
      }));
      console.log(`📦 Loaded ${this.tools.length} tools from MCP server`);
    } catch (e) {
      console.warn("Could not list tools:", e);
    }

    // Fetch available prompts
    try {
      const promptsResult = await this.client.listPrompts();
      this.prompts = (promptsResult.prompts || []).map((p) => ({
        name: p.name,
        description: p.description || "",
        arguments: p.arguments,
      }));
      console.log(`📝 Loaded ${this.prompts.length} prompts from MCP server`);
    } catch (e) {
      console.warn("Could not list prompts:", e);
    }
  }

  async disconnect(): Promise<void> {
    if (this.transport) {
      try { await this.transport.close(); } catch { /* ignore */ }
    }
    this.client = null;
    this.transport = null;
    this.tools = [];
    this.prompts = [];
  }

  getTools(): MCPTool[] {
    return this.tools;
  }

  getPrompts(): MCPPrompt[] {
    return this.prompts;
  }

  /** Get tools formatted for LLM function calling (OpenAI-compatible) */
  getToolsForLLM(): { name: string; description: string; parameters: Record<string, unknown> }[] {
    return this.tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: sanitizeSchemaForLLM(t.inputSchema),
    }));
  }

  /** Call an MCP tool */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.client) throw new Error("Not connected to MCP server");

    const result = await this.client.callTool({ name, arguments: args });

    // Parse the text content from MCP response
    if (result.content && Array.isArray(result.content)) {
      const texts = result.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text);

      if (texts.length === 1) {
        try { return JSON.parse(texts[0]); } catch { return texts[0]; }
      }
      if (texts.length > 1) {
        return texts.join("\n");
      }
    }

    return result;
  }

  /** Get a prompt template */
  async getPrompt(name: string, args: Record<string, string>): Promise<unknown> {
    if (!this.client) throw new Error("Not connected to MCP server");
    return await this.client.getPrompt({ name, arguments: args });
  }
}

/**
 * Sanitize JSON Schema for LLM providers that don't handle nullable types well.
 *
 * Problem: Zod's .nullish() produces {"type": ["string", "null"]} or
 * {"anyOf": [{type: string}, {type: null}]} in JSON Schema. Some providers
 * (notably Groq) don't properly validate against these patterns — the LLM
 * generates null values that then fail strict validation.
 *
 * Fix: Convert nullable types to simple types. The field stays optional
 * (not in "required"), so the LLM can simply omit it instead of sending null.
 */
function sanitizeSchemaForLLM(schema: Record<string, unknown>): Record<string, unknown> {
  if (!schema || typeof schema !== "object") return schema;

  const result = { ...schema };

  // Handle "type": ["string", "null"] → "type": "string"
  if (Array.isArray(result.type)) {
    const nonNullTypes = (result.type as string[]).filter((t) => t !== "null");
    result.type = nonNullTypes.length === 1 ? nonNullTypes[0] : nonNullTypes;
  }

  // Handle "anyOf": [{type: "string"}, {type: "null"}] → unwrap to the non-null schema
  if (Array.isArray(result.anyOf)) {
    const nonNull = (result.anyOf as Record<string, unknown>[]).filter(
      (s) => !(s.type === "null" || (Array.isArray(s.type) && s.type.length === 1 && s.type[0] === "null"))
    );
    if (nonNull.length === 1) {
      // Replace anyOf with the single non-null schema
      delete result.anyOf;
      Object.assign(result, sanitizeSchemaForLLM(nonNull[0]));
      return result;
    }
  }

  // Recurse into properties
  if (result.properties && typeof result.properties === "object") {
    const sanitizedProps: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(result.properties as Record<string, unknown>)) {
      sanitizedProps[key] = sanitizeSchemaForLLM(value as Record<string, unknown>);
    }
    result.properties = sanitizedProps;
  }

  // Recurse into items (for arrays)
  if (result.items && typeof result.items === "object") {
    result.items = sanitizeSchemaForLLM(result.items as Record<string, unknown>);
  }

  return result;
}
