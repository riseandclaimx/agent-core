import policiesConfig from "./policies.json" with { type: "json" };
import { logger } from "../../obs/logger";
import { METRICS } from "../../obs/metrics";
import { generateId } from "../../utils/id";

export interface ModelConfig {
  provider: string;
  model: string;
  capabilities: string[];
  contextWindow: number;
  costPer1MIn: number;
  costPer1MOut: number;
  speed: "very_fast" | "fast" | "medium" | "slow" | "fastest";
  quality: "medium" | "high" | "very_high" | "highest";
  freeTier: boolean;
}

export interface RoutingRule {
  name: string;
  conditions: {
    taskTypes?: string[];
    minComplexity?: "low" | "medium" | "high";
    maxComplexity?: "low" | "medium" | "high";
    requiresTools?: boolean;
    requiresVision?: boolean;
    minContextTokens?: number;
    premium?: boolean;
  };
  model: string;
  fallback: string[];
}

export interface RoutingContext {
  taskType: string;
  complexity: "low" | "medium" | "high";
  requiresTools: boolean;
  requiresVision: boolean;
  estimatedContextTokens: number;
  userId?: string;
  premium?: boolean;
  preferredModel?: string;
}

export interface RoutingResult {
  model: string;
  provider: string;
  modelId: string;
  reason: string;
  fallbackChain: string[];
  estimatedCost: number;
}

interface PoliciesConfig {
  version: string;
  defaultModel: string;
  models: Record<string, ModelConfig>;
  routingRules: RoutingRule[];
  costLimits: {
    perRequestUsd: number;
    perUserDailyUsd: number;
    perTeamDailyUsd: number;
  };
}

const POLICIES = policiesConfig as PoliciesConfig;

export class ModelRouter {
  private models = POLICIES.models;
  private rules = POLICIES.routingRules;
  private defaultModel = POLICIES.defaultModel;
  private costLimits = POLICIES.costLimits;

  /** Select the best model for a given context */
  selectModel(context: RoutingContext): RoutingResult {
    // 1. Check explicit preference
    if (context.preferredModel && this.models[context.preferredModel]) {
      return this.buildResult(context.preferredModel, "User-preferred model", []);
    }

    // 2. Match routing rules in order
    for (const rule of this.rules) {
      if (this.matchesRule(rule, context)) {
        const modelKey = rule.model;
        if (this.models[modelKey]) {
          return this.buildResult(modelKey, `Matched rule: ${rule.name}`, rule.fallback);
        }
      }
    }

    // 3. Default model
    return this.buildResult(this.defaultModel, "Default model", []);
  }

  private matchesRule(rule: RoutingRule, context: RoutingContext): boolean {
    const c = rule.conditions;

    if (c.taskTypes && !c.taskTypes.includes(context.taskType)) return false;
    if (c.requiresTools !== undefined && c.requiresTools !== context.requiresTools) return false;
    if (c.requiresVision !== undefined && c.requiresVision !== context.requiresVision) return false;
    if (c.premium !== undefined && c.premium !== context.premium) return false;

    if (c.minComplexity && this.compareComplexity(context.complexity, c.minComplexity) < 0) return false;
    if (c.maxComplexity && this.compareComplexity(context.complexity, c.maxComplexity) > 0) return false;
    if (c.minContextTokens && context.estimatedContextTokens < c.minContextTokens) return false;

    return true;
  }

  private compareComplexity(a: "low" | "medium" | "high", b: "low" | "medium" | "high"): number {
    const order = { low: 0, medium: 1, high: 2 };
    return order[a] - order[b];
  }

  private buildResult(modelKey: string, reason: string, fallback: string[]): RoutingResult {
    const model = this.models[modelKey];
    const fallbackChain = fallback.filter((f) => this.models[f]);

    return {
      model: modelKey,
      provider: model!.provider,
      modelId: model!.model,
      reason,
      fallbackChain,
      estimatedCost: 0, // Calculated at call time
    };
  }

  /** Get model config by key */
  getModel(modelKey: string): ModelConfig | undefined {
    return this.models[modelKey];
  }

  /** Get all available models */
  getAllModels(): Record<string, ModelConfig> {
    return this.models;
  }

  /** Estimate cost for a model call */
  estimateCost(modelKey: string, promptTokens: number, completionTokens: number): number {
    const model = this.models[modelKey];
    if (!model) return 0;
    return (promptTokens / 1_000_000) * model.costPer1MIn + (completionTokens / 1_000_000) * model.costPer1MOut;
  }

  /** Check if request is within cost limits */
  async checkCostLimits(
    userId: string,
    estimatedCost: number
  ): Promise<{ allowed: boolean; reason?: string }> {
    // In production, check against Redis counters
    // For now, just check per-request limit
    if (estimatedCost > this.costLimits.perRequestUsd) {
      return { allowed: false, reason: `Estimated cost $${estimatedCost.toFixed(4)} exceeds per-request limit $${this.costLimits.perRequestUsd}` };
    }
    return { allowed: true };
  }
}

export const modelRouter = new ModelRouter();

/** Unified model client interface */
export interface ModelClient {
  chat(completion: ChatCompletionRequest): Promise<ChatCompletionResponse>;
  streamChat(completion: ChatCompletionRequest): AsyncIterable<ChatCompletionChunk>;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  toolChoice?: "auto" | "none" | { type: "function"; function: { name: string } };
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stream?: boolean;
  metadata?: Record<string, unknown>;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ChatContentPart[];
  name?: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ChatContentPart {
  type: "text" | "image_url";
  text?: string;
  imageUrl?: { url: string; detail?: "low" | "high" | "auto" };
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatCompletionResponse {
  id: string;
  model: string;
  choices: ChatChoice[];
  usage: TokenUsage;
  created: number;
}

export interface ChatChoice {
  index: number;
  message: ChatMessage;
  finishReason: "stop" | "length" | "tool_calls" | "content_filter" | "error";
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatCompletionChunk {
  id: string;
  model: string;
  choices: ChatChunkChoice[];
  usage?: TokenUsage;
}

export interface ChatChunkChoice {
  index: number;
  delta: Partial<ChatMessage>;
  finishReason: ChatChoice["finishReason"] | null;
}

// ── Provider configurations ──────────────────────────────────────────────────
// Most providers expose an OpenAI-compatible /chat/completions endpoint.

interface ProviderConfig {
  baseUrl: string;
  envKey: string; // name of the env var holding the API key
  /** Optional: transform the model name before sending to the API */
  modelTransform?: (model: string) => string;
}

const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    envKey: "GROQ_API_KEY",
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com/v1",
    envKey: "DEEPSEEK_API_KEY",
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    envKey: "OPENAI_API_KEY",
  },
  anthropic: {
    // Use Anthropic's Messages API via OpenAI-compat proxy, or native
    baseUrl: "https://api.anthropic.com/v1",
    envKey: "ANTHROPIC_API_KEY",
  },
  gemini: {
    // Gemini via Google's OpenAI-compatible endpoint
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    envKey: "GEMINI_API_KEY",
  },
  cerebras: {
    baseUrl: "https://api.cerebras.ai/v1",
    envKey: "CEREBRAS_API_KEY",
  },
  github: {
    // GitHub Models — OpenAI-compatible, uses GitHub PAT as the key
    baseUrl: "https://models.inference.ai.azure.com",
    envKey: "GITHUB_TOKEN",
  },
  mistral: {
    baseUrl: "https://api.mistral.ai/v1",
    envKey: "MISTRAL_API_KEY",
  },
  cohere: {
    // Cohere Chat via OpenAI-compatible endpoint
    baseUrl: "https://api.cohere.com/compatibility/v1",
    envKey: "COHERE_API_KEY",
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    envKey: "OPENROUTER_API_KEY",
  },
  moonshot: {
    // MoonshotAI / Kimi — OpenAI-compatible
    baseUrl: "https://api.moonshot.cn/v1",
    envKey: "MOONSHOT_API_KEY",
  },
  kilo: {
    // Kilo AI Gateway — OpenAI-compatible, routes to hundreds of models
    baseUrl: "https://api.kilo.ai/api/gateway",
    envKey: "KILO_API_KEY",
  },
};

// ── OpenAI-compatible client factory ─────────────────────────────────────────

function formatMessages(messages: ChatMessage[]): any[] {
  return messages.map((m) => {
    const msg: any = { role: m.role };
    if (typeof m.content === "string") {
      msg.content = m.content;
    } else if (Array.isArray(m.content)) {
      msg.content = m.content.map((part) => {
        if (part.type === "text") return { type: "text", text: part.text };
        if (part.type === "image_url") return { type: "image_url", image_url: part.imageUrl };
        return part;
      });
    }
    if (m.name) msg.name = m.name;
    if (m.toolCallId) msg.tool_call_id = m.toolCallId;
    if (m.toolCalls) msg.tool_calls = m.toolCalls;
    return msg;
  });
}

function parseResponse(raw: any): ChatCompletionResponse {
  return {
    id: raw.id ?? "",
    model: raw.model ?? "",
    created: raw.created ?? Math.floor(Date.now() / 1000),
    choices: (raw.choices ?? []).map((c: any, i: number) => ({
      index: c.index ?? i,
      message: {
        role: c.message?.role ?? "assistant",
        content: c.message?.content ?? "",
        toolCalls: c.message?.tool_calls?.map((tc: any) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
      },
      finishReason: mapFinishReason(c.finish_reason),
    })),
    usage: {
      promptTokens: raw.usage?.prompt_tokens ?? 0,
      completionTokens: raw.usage?.completion_tokens ?? 0,
      totalTokens: raw.usage?.total_tokens ?? 0,
    },
  };
}

function mapFinishReason(reason: string | null | undefined): ChatChoice["finishReason"] {
  switch (reason) {
    case "stop": return "stop";
    case "length": return "length";
    case "tool_calls": return "tool_calls";
    case "content_filter": return "content_filter";
    default: return "stop";
  }
}

function createOpenAICompatibleClient(provider: string): ModelClient {
  const config = PROVIDER_CONFIGS[provider];
  if (!config) throw new Error(`Unknown provider: ${provider}`);

  return {
    async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
      const apiKey = process.env[config.envKey];
      if (!apiKey) throw new Error(`${config.envKey} env var not set`);

      const model = config.modelTransform?.(request.model) ?? request.model;

      const body: any = {
        model,
        messages: formatMessages(request.messages),
      };
      if (request.tools && request.tools.length > 0) body.tools = request.tools;
      if (request.toolChoice) body.tool_choice = request.toolChoice;
      if (request.temperature !== undefined) body.temperature = request.temperature;
      if (request.maxTokens) body.max_tokens = request.maxTokens;
      if (request.topP !== undefined) body.top_p = request.topP;

      const res = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errorBody = await res.text();
        throw new Error(`${provider} API error (${res.status}): ${errorBody}`);
      }

      const raw = await res.json();
      return parseResponse(raw);
    },

    async *streamChat(request: ChatCompletionRequest): AsyncIterable<ChatCompletionChunk> {
      const apiKey = process.env[config.envKey];
      if (!apiKey) throw new Error(`${config.envKey} env var not set`);

      const model = config.modelTransform?.(request.model) ?? request.model;

      const body: any = {
        model,
        messages: formatMessages(request.messages),
        stream: true,
      };
      if (request.tools && request.tools.length > 0) body.tools = request.tools;
      if (request.toolChoice) body.tool_choice = request.toolChoice;
      if (request.temperature !== undefined) body.temperature = request.temperature;
      if (request.maxTokens) body.max_tokens = request.maxTokens;
      if (request.topP !== undefined) body.top_p = request.topP;

      const res = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errorBody = await res.text();
        throw new Error(`${provider} streaming API error (${res.status}): ${errorBody}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6);
          if (data === "[DONE]") return;

          try {
            const raw = JSON.parse(data);
            yield {
              id: raw.id ?? "",
              model: raw.model ?? "",
              choices: (raw.choices ?? []).map((c: any, i: number) => ({
                index: c.index ?? i,
                delta: {
                  role: c.delta?.role,
                  content: c.delta?.content,
                  toolCalls: c.delta?.tool_calls,
                },
                finishReason: mapFinishReason(c.finish_reason),
              })),
              usage: raw.usage ? {
                promptTokens: raw.usage.prompt_tokens ?? 0,
                completionTokens: raw.usage.completion_tokens ?? 0,
                totalTokens: raw.usage.total_tokens ?? 0,
              } : undefined,
            };
          } catch {
            // Skip malformed SSE lines
          }
        }
      }
    },
  };
}

// ── Anthropic native client (Messages API, not OpenAI-compatible) ────────────

function createAnthropicClient(): ModelClient {
  return {
    async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error("ANTHROPIC_API_KEY env var not set");

      // Extract system message
      const systemMsg = request.messages.find((m) => m.role === "system");
      const nonSystemMsgs = request.messages.filter((m) => m.role !== "system");

      const body: any = {
        model: request.model,
        max_tokens: request.maxTokens ?? 4096,
        messages: nonSystemMsgs.map((m) => ({
          role: m.role === "tool" ? "user" : m.role,
          content: typeof m.content === "string" ? m.content : m.content?.map((p) => {
            if (p.type === "text") return { type: "text", text: p.text };
            if (p.type === "image_url") return { type: "image", source: { type: "url", url: p.imageUrl?.url } };
            return p;
          }),
          ...(m.toolCallId && { tool_use_id: m.toolCallId }),
        })),
      };
      if (systemMsg) body.system = typeof systemMsg.content === "string" ? systemMsg.content : "";
      if (request.tools?.length) {
        body.tools = request.tools.map((t) => ({
          name: t.function.name,
          description: t.function.description,
          input_schema: t.function.parameters,
        }));
      }
      if (request.temperature !== undefined) body.temperature = request.temperature;
      if (request.topP !== undefined) body.top_p = request.topP;

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errorBody = await res.text();
        throw new Error(`Anthropic API error (${res.status}): ${errorBody}`);
      }

      const raw: any = await res.json();

      // Map Anthropic response → unified format
      let textContent = "";
      const toolCalls: ToolCall[] = [];

      for (const block of raw.content ?? []) {
        if (block.type === "text") textContent += block.text;
        if (block.type === "tool_use") {
          toolCalls.push({
            id: block.id,
            type: "function",
            function: { name: block.name, arguments: JSON.stringify(block.input) },
          });
        }
      }

      return {
        id: raw.id ?? "",
        model: raw.model ?? request.model,
        created: Math.floor(Date.now() / 1000),
        choices: [{
          index: 0,
          message: {
            role: "assistant",
            content: textContent,
            ...(toolCalls.length > 0 && { toolCalls }),
          },
          finishReason: raw.stop_reason === "tool_use" ? "tool_calls" : "stop",
        }],
        usage: {
          promptTokens: raw.usage?.input_tokens ?? 0,
          completionTokens: raw.usage?.output_tokens ?? 0,
          totalTokens: (raw.usage?.input_tokens ?? 0) + (raw.usage?.output_tokens ?? 0),
        },
      };
    },

    async *streamChat(request: ChatCompletionRequest): AsyncIterable<ChatCompletionChunk> {
      // For now, fall back to non-streaming and yield the full result
      const response = await this.chat(request);
      yield {
        id: response.id,
        model: response.model,
        choices: response.choices.map((c) => ({
          index: c.index,
          delta: c.message,
          finishReason: c.finishReason,
        })),
        usage: response.usage,
      };
    },
  };
}

// ── Client instances (lazy via getProviderClient) ────────────────────────────

const clientCache = new Map<string, ModelClient>();

/** Get the client for a specific provider */
export function getProviderClient(provider: string): ModelClient {
  let client = clientCache.get(provider);
  if (client) return client;

  if (provider === "anthropic") {
    client = createAnthropicClient();
  } else if (PROVIDER_CONFIGS[provider]) {
    client = createOpenAICompatibleClient(provider);
  } else {
    throw new Error(`Unknown provider: ${provider}`);
  }

  clientCache.set(provider, client);
  return client;
}
