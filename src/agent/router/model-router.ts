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

/** Get the client for a specific provider */
export function getProviderClient(provider: string): ModelClient {
  switch (provider) {
    case "groq":
      return groqClient;
    case "deepseek":
      return deepseekClient;
    case "gemini":
      return geminiClient;
    case "openai":
      return openaiClient;
    case "anthropic":
      return anthropicClient;
    case "cerebras":
      return cerebrasClient;
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

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

/** Placeholder clients - implement with actual SDKs */
const groqClient: ModelClient = createPlaceholderClient("groq");
const deepseekClient: ModelClient = createPlaceholderClient("deepseek");
const geminiClient: ModelClient = createPlaceholderClient("gemini");
const openaiClient: ModelClient = createPlaceholderClient("openai");
const anthropicClient: ModelClient = createPlaceholderClient("anthropic");
const cerebrasClient: ModelClient = createPlaceholderClient("cerebras");

function createPlaceholderClient(provider: string): ModelClient {
  return {
    async chat() {
      throw new Error(`${provider} client not implemented yet`);
    },
    async *streamChat() {
      throw new Error(`${provider} client not implemented yet`);
    },
  };
}
