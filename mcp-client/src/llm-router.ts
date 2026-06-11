/**
 * LLM Router — routes chat completions to configured providers.
 * Supports: Groq, DeepSeek, OpenAI, Anthropic, Gemini, Cerebras
 *
 * All OpenAI-compatible providers use the same code path.
 * Anthropic uses its native Messages API.
 */
import type { ChatMessage, LLMResponse, ToolCall } from "./types.js";

interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
  format: "openai" | "anthropic";
}

interface LLMTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

// ─── Model catalog ───────────────────────────────────────────────────────────

const MODEL_CATALOG: Record<string, { provider: string; model: string; label: string }> = {
  "groq:openai/gpt-oss-20b": { provider: "groq", model: "openai/gpt-oss-20b", label: "GPT-OSS 20B (Groq, free)" },
  "groq:llama-3.3-70b-versatile": { provider: "groq", model: "llama-3.3-70b-versatile", label: "Llama 3.3 70B (Groq, free)" },
  "groq:llama-3.1-8b-instant": { provider: "groq", model: "llama-3.1-8b-instant", label: "Llama 3.1 8B (Groq, fast)" },
  "deepseek:deepseek-chat": { provider: "deepseek", model: "deepseek-chat", label: "DeepSeek Chat ($0.14/M)" },
  "openai:gpt-4o-mini": { provider: "openai", model: "gpt-4o-mini", label: "GPT-4o Mini ($0.15/M)" },
  "openai:gpt-4o": { provider: "openai", model: "gpt-4o", label: "GPT-4o ($2.50/M)" },
  "anthropic:claude-sonnet-4-20250514": { provider: "anthropic", model: "claude-sonnet-4-20250514", label: "Claude Sonnet 4 ($3/M)" },
  "gemini:gemini-2.5-flash-preview-05-20": { provider: "gemini", model: "gemini-2.5-flash-preview-05-20", label: "Gemini 2.5 Flash ($0.15/M)" },
  "cerebras:llama-4-scout-17b-16e-instruct": { provider: "cerebras", model: "llama-4-scout-17b-16e-instruct", label: "Llama 4 Scout (Cerebras, free)" },
  // GitHub Models (uses GitHub PAT, OpenAI-compatible)
  "github:gpt-4o-mini": { provider: "github", model: "gpt-4o-mini", label: "GPT-4o Mini (GitHub)" },
  "github:gpt-4o": { provider: "github", model: "gpt-4o", label: "GPT-4o (GitHub)" },
  // Mistral
  "mistral:mistral-large-latest": { provider: "mistral", model: "mistral-large-latest", label: "Mistral Large ($2/M)" },
  "mistral:mistral-small-latest": { provider: "mistral", model: "mistral-small-latest", label: "Mistral Small ($0.10/M)" },
  "mistral:codestral-latest": { provider: "mistral", model: "codestral-latest", label: "Codestral ($0.30/M)" },
  // Cohere
  "cohere:command-a-03-2025": { provider: "cohere", model: "command-a-03-2025", label: "Command A ($2.50/M)" },
  "cohere:command-r-plus-08-2024": { provider: "cohere", model: "command-r-plus-08-2024", label: "Command R+ ($2.50/M)" },
  // OpenRouter (pass-through to any model)
  "openrouter:google/gemini-2.5-flash-preview": { provider: "openrouter", model: "google/gemini-2.5-flash-preview", label: "Gemini 2.5 Flash (OpenRouter)" },
  "openrouter:anthropic/claude-sonnet-4": { provider: "openrouter", model: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4 (OpenRouter)" },
  "openrouter:meta-llama/llama-4-maverick": { provider: "openrouter", model: "meta-llama/llama-4-maverick", label: "Llama 4 Maverick (OpenRouter)" },
  // Moonshot / Kimi
  "moonshot:kimi-latest": { provider: "moonshot", model: "kimi-latest", label: "Kimi Latest (Moonshot)" },
  "moonshot:moonshot-v1-128k": { provider: "moonshot", model: "moonshot-v1-128k", label: "Moonshot 128k" },
  // Kilo AI
  "kilo:kilo-coder": { provider: "kilo", model: "kilo-coder", label: "Kilo Coder" },
};

export class LLMRouter {
  private providers: Map<string, ProviderConfig> = new Map();

  constructor() {
    this.detectProviders();
  }

  private detectProviders(): void {
    const providerDefs: { name: string; envKey: string; baseUrl: string; format: "openai" | "anthropic" }[] = [
      { name: "groq", envKey: "GROQ_API_KEY", baseUrl: "https://api.groq.com/openai/v1", format: "openai" },
      { name: "deepseek", envKey: "DEEPSEEK_API_KEY", baseUrl: "https://api.deepseek.com/v1", format: "openai" },
      { name: "openai", envKey: "OPENAI_API_KEY", baseUrl: "https://api.openai.com/v1", format: "openai" },
      { name: "anthropic", envKey: "ANTHROPIC_API_KEY", baseUrl: "https://api.anthropic.com", format: "anthropic" },
      { name: "gemini", envKey: "GEMINI_API_KEY", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", format: "openai" },
      { name: "cerebras", envKey: "CEREBRAS_API_KEY", baseUrl: "https://api.cerebras.ai/v1", format: "openai" },
      { name: "github", envKey: "GITHUB_TOKEN", baseUrl: "https://models.inference.ai.azure.com", format: "openai" },
      { name: "mistral", envKey: "MISTRAL_API_KEY", baseUrl: "https://api.mistral.ai/v1", format: "openai" },
      { name: "cohere", envKey: "COHERE_API_KEY", baseUrl: "https://api.cohere.com/compatibility/v1", format: "openai" },
      { name: "openrouter", envKey: "OPENROUTER_API_KEY", baseUrl: "https://openrouter.ai/api/v1", format: "openai" },
      { name: "moonshot", envKey: "MOONSHOT_API_KEY", baseUrl: "https://api.moonshot.cn/v1", format: "openai" },
      { name: "kilo", envKey: "KILO_API_KEY", baseUrl: "https://api.kilo-ai.com/v1", format: "openai" },
    ];

    for (const def of providerDefs) {
      const key = process.env[def.envKey];
      if (key) {
        this.providers.set(def.name, { baseUrl: def.baseUrl, apiKey: key, format: def.format });
        console.log(`  ✅ ${def.name} provider configured`);
      }
    }
  }

  getAvailableProviders(): string[] {
    return [...this.providers.keys()];
  }

  getAvailableModels(): { key: string; label: string; available: boolean }[] {
    return Object.entries(MODEL_CATALOG).map(([key, info]) => ({
      key,
      label: info.label,
      available: this.providers.has(info.provider),
    }));
  }

  async chat(modelKey: string, messages: ChatMessage[], tools: LLMTool[]): Promise<LLMResponse> {
    const modelInfo = MODEL_CATALOG[modelKey];
    if (!modelInfo) throw new Error(`Unknown model: ${modelKey}`);

    const provider = this.providers.get(modelInfo.provider);
    if (!provider) throw new Error(`Provider "${modelInfo.provider}" not configured. Set the API key.`);

    if (provider.format === "anthropic") {
      return this.chatAnthropic(provider, modelInfo.model, messages, tools);
    }
    return this.chatOpenAI(provider, modelInfo.model, messages, tools);
  }

  // ── OpenAI-compatible (Groq, DeepSeek, OpenAI, Gemini, Cerebras) ────────

  private async chatOpenAI(
    provider: ProviderConfig,
    model: string,
    messages: ChatMessage[],
    tools: LLMTool[]
  ): Promise<LLMResponse> {
    // Convert messages to OpenAI format
    const oaiMessages = messages.map((m) => {
      if (m.role === "tool") {
        return { role: "tool" as const, content: m.content, tool_call_id: m.toolCallId || "" };
      }
      if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
        return {
          role: "assistant" as const,
          content: m.content || null,
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.name, arguments: JSON.stringify(tc.args) },
          })),
        };
      }
      return { role: m.role, content: m.content };
    });

    const body: Record<string, unknown> = {
      model,
      messages: oaiMessages,
    };

    if (tools.length > 0) {
      body.tools = tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }

    const res = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`LLM API error (${res.status}): ${errBody.slice(0, 500)}`);
    }

    const data = (await res.json()) as {
      choices: {
        message: {
          content?: string | null;
          tool_calls?: { id: string; function: { name: string; arguments: string } }[];
        };
      }[];
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };

    const choice = data.choices?.[0]?.message;
    const toolCalls: ToolCall[] = (choice?.tool_calls || []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      args: safeJsonParse(tc.function.arguments),
    }));

    return {
      content: choice?.content || null,
      toolCalls,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          }
        : undefined,
    };
  }

  // ── Anthropic Messages API ──────────────────────────────────────────────

  private async chatAnthropic(
    provider: ProviderConfig,
    model: string,
    messages: ChatMessage[],
    tools: LLMTool[]
  ): Promise<LLMResponse> {
    // Extract system message
    let system = "";
    const convMessages: ChatMessage[] = [];
    for (const m of messages) {
      if (m.role === "system") {
        system += (system ? "\n" : "") + m.content;
      } else {
        convMessages.push(m);
      }
    }

    // Convert to Anthropic format
    const anthropicMessages = convMessages.map((m) => {
      if (m.role === "tool") {
        return {
          role: "user" as const,
          content: [{
            type: "tool_result" as const,
            tool_use_id: m.toolCallId || "",
            content: m.content,
          }],
        };
      }
      if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
        const content: unknown[] = [];
        if (m.content) content.push({ type: "text", text: m.content });
        for (const tc of m.toolCalls) {
          content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.args });
        }
        return { role: "assistant" as const, content };
      }
      return { role: m.role as "user" | "assistant", content: m.content };
    });

    const body: Record<string, unknown> = {
      model,
      max_tokens: 4096,
      messages: anthropicMessages,
    };
    if (system) body.system = system;

    if (tools.length > 0) {
      body.tools = tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }

    const res = await fetch(`${provider.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": provider.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Anthropic API error (${res.status}): ${errBody.slice(0, 500)}`);
    }

    const data = (await res.json()) as {
      content: ({ type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> })[];
      usage?: { input_tokens: number; output_tokens: number };
    };

    let content = "";
    const toolCalls: ToolCall[] = [];

    for (const block of data.content || []) {
      if (block.type === "text") {
        content += block.text;
      } else if (block.type === "tool_use") {
        toolCalls.push({ id: block.id, name: block.name, args: block.input });
      }
    }

    return {
      content: content || null,
      toolCalls,
      usage: data.usage
        ? {
            promptTokens: data.usage.input_tokens,
            completionTokens: data.usage.output_tokens,
            totalTokens: data.usage.input_tokens + data.usage.output_tokens,
          }
        : undefined,
    };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeJsonParse(str: string): Record<string, unknown> {
  try {
    return JSON.parse(str);
  } catch {
    return { raw: str };
  }
}
