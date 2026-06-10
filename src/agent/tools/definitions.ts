import { z } from "zod";

/** All tool definitions - organized by namespace */
export const toolDefinitions = {
  // ==================== MEMORY ====================
  "memory.write": {
    description: "Store a long-term memory",
    parameters: z.object({
      content: z.string().describe("Memory content to store"),
      scope: z.enum(["global", "user", "channel"]).default("global").describe("Memory scope"),
      scopeId: z.string().optional().describe("User ID or channel ID for scoped memories"),
      tags: z.array(z.string()).default([]).describe("Tags for categorization"),
      importance: z.number().min(1).max(10).default(5).describe("Importance 1-10"),
      metadata: z.record(z.unknown()).default({}).describe("Additional metadata"),
    }),
  },

  "memory.read": {
    description: "Retrieve a specific memory by ID",
    parameters: z.object({
      id: z.string().describe("Memory ID"),
    }),
  },

  "memory.search": {
    description: "Semantic search over memories",
    parameters: z.object({
      query: z.string().describe("Search query"),
      scope: z.enum(["global", "user", "channel"]).default("global").describe("Search scope"),
      scopeId: z.string().optional().describe("User/channel ID for scoped search"),
      tags: z.array(z.string()).optional().describe("Filter by tags"),
      minImportance: z.number().min(1).max(10).default(1).describe("Minimum importance"),
      limit: z.number().min(1).max(20).default(5).describe("Max results"),
      similarityThreshold: z.number().min(0).max(1).default(0.72).describe("Similarity threshold"),
    }),
  },

  "memory.embed": {
    description: "Generate embedding for text",
    parameters: z.object({
      text: z.string().describe("Text to embed"),
    }),
  },

  // ==================== AUTH ====================
  "auth.verify_user": {
    description: "Verify Slack user identity and permissions",
    parameters: z.object({
      userId: z.string().describe("Slack user ID"),
      teamId: z.string().optional().describe("Slack team ID"),
    }),
  },

  "auth.get_user_roles": {
    description: "Get user roles and permissions",
    parameters: z.object({
      userId: z.string().describe("Slack user ID"),
    }),
  },

  "auth.set_user_roles": {
    description: "Set user roles (admin only)",
    parameters: z.object({
      userId: z.string().describe("Slack user ID"),
      roles: z.array(z.string()).describe("Roles to assign"),
    }),
  },

  // ==================== TASKS ====================
  "task.enqueue": {
    description: "Enqueue a background task",
    parameters: z.object({
      name: z.string().describe("Task name"),
      payload: z.record(z.unknown()).describe("Task payload"),
      priority: z.number().min(1).max(10).default(5).describe("Priority 1-10"),
      scheduledFor: z.string().datetime().optional().describe("ISO timestamp to run"),
      maxRetries: z.number().min(0).max(10).default(3).describe("Max retries"),
      tags: z.array(z.string()).default([]).describe("Tags"),
    }),
  },

  "task.status": {
    description: "Get task status",
    parameters: z.object({
      taskId: z.string().describe("Task ID"),
    }),
  },

  "task.cancel": {
    description: "Cancel a pending/running task",
    parameters: z.object({
      taskId: z.string().describe("Task ID"),
    }),
  },

  // ==================== LOGGING ====================
  "log.write": {
    description: "Write a structured log entry",
    parameters: z.object({
      level: z.enum(["debug", "info", "warn", "error", "fatal"]).default("info"),
      message: z.string().describe("Log message"),
      metadata: z.record(z.unknown()).default({}).describe("Additional context"),
    }),
  },

  "log.search": {
    description: "Search logs",
    parameters: z.object({
      query: z.string().optional().describe("Search query"),
      level: z.enum(["debug", "info", "warn", "error", "fatal"]).optional(),
      toolName: z.string().optional(),
      userId: z.string().optional(),
      traceId: z.string().optional(),
      since: z.string().datetime().optional(),
      limit: z.number().min(1).max(100).default(20),
    }),
  },

  "analytics.track_event": {
    description: "Track an analytics event",
    parameters: z.object({
      eventName: z.string().describe("Event name"),
      properties: z.record(z.unknown()).default({}).describe("Event properties"),
      metrics: z.record(z.number()).default({}).describe("Numeric metrics"),
    }),
  },

  // ==================== EMAIL ====================
  "email.send": {
    description: "Send an email",
    parameters: z.object({
      to: z.string().email().describe("Recipient email"),
      subject: z.string().describe("Email subject"),
      html: z.string().optional().describe("HTML body"),
      text: z.string().optional().describe("Text body"),
      templateId: z.string().optional().describe("Template ID"),
      templateData: z.record(z.unknown()).optional().describe("Template data"),
    }),
  },

  "email.get_status": {
    description: "Get email delivery status",
    parameters: z.object({
      messageId: z.string().describe("Message ID"),
    }),
  },

  // ==================== SMS ====================
  "sms.send": {
    description: "Send an SMS",
    parameters: z.object({
      to: z.string().describe("Phone number (E.164)"),
      body: z.string().describe("Message body"),
      from: z.string().optional().describe("From number"),
    }),
  },

  "sms.verify_code": {
    description: "Verify an SMS code",
    parameters: z.object({
      phone: z.string().describe("Phone number"),
      code: z.string().describe("Verification code"),
    }),
  },

  // ==================== STORAGE ====================
  "storage.upload": {
    description: "Upload a file to storage",
    parameters: z.object({
      key: z.string().describe("Storage key"),
      content: z.string().describe("Base64 encoded content"),
      contentType: z.string().describe("MIME type"),
      metadata: z.record(z.string()).optional(),
    }),
  },

  "storage.download": {
    description: "Download a file from storage",
    parameters: z.object({
      key: z.string().describe("Storage key"),
    }),
  },

  "storage.list": {
    description: "List files in storage",
    parameters: z.object({
      prefix: z.string().optional().describe("Key prefix"),
      limit: z.number().min(1).max(1000).default(100),
    }),
  },

  // ==================== WEB ====================
  "web.fetch": {
    description: "Fetch a URL (GET)",
    parameters: z.object({
      url: z.string().url().describe("URL to fetch"),
      headers: z.record(z.string()).optional(),
      timeout: z.number().min(1000).max(60000).default(10000),
    }),
  },

  "web.scrape": {
    description: "Scrape a webpage",
    parameters: z.object({
      url: z.string().url().describe("URL to scrape"),
      selector: z.string().optional().describe("CSS selector"),
      waitFor: z.string().optional().describe("Wait for selector"),
    }),
  },

  // ==================== BUSINESS LOGIC ====================
  "business.calculate_commission": {
    description: "Calculate commission for a deal",
    parameters: z.object({
      amount: z.number().describe("Deal amount"),
      tier: z.string().describe("Commission tier"),
      productType: z.string().optional(),
    }),
  },

  "business.generate_invoice_data": {
    description: "Generate invoice data",
    parameters: z.object({
      customerId: z.string().describe("Customer ID"),
      items: z.array(z.object({
        description: z.string(),
        quantity: z.number(),
        unitPrice: z.number(),
      })),
      metadata: z.record(z.unknown()).optional(),
    }),
  },

  "business.assign_lead": {
    description: "Assign a lead to a rep",
    parameters: z.object({
      leadId: z.string().describe("Lead ID"),
      repId: z.string().optional().describe("Rep ID (auto-assign if omitted)"),
      criteria: z.record(z.unknown()).optional(),
    }),
  },

  // ==================== SECURITY ====================
  "security.sanitize_input": {
    description: "Sanitize user input",
    parameters: z.object({
      input: z.string().describe("Input to sanitize"),
      policy: z.enum(["strict", "moderate", "lenient"]).default("moderate"),
    }),
  },

  "security.check_permissions": {
    description: "Check if user has permission",
    parameters: z.object({
      userId: z.string().describe("User ID"),
      resource: z.string().describe("Resource"),
      action: z.string().describe("Action"),
    }),
  },

  "security.audit_log": {
    description: "Write audit log entry",
    parameters: z.object({
      userId: z.string().describe("User ID"),
      action: z.string().describe("Action performed"),
      resource: z.string().describe("Resource"),
      result: z.enum(["success", "failure", "denied"]),
      metadata: z.record(z.unknown()).optional(),
    }),
  },

  // ==================== ROUTING ====================
  "router.select_model": {
    description: "Select optimal model for a task",
    parameters: z.object({
      taskType: z.string().describe("Task type"),
      complexity: z.enum(["low", "medium", "high"]).default("medium"),
      requiresTools: z.boolean().default(false),
      requiresVision: z.boolean().default(false),
      estimatedContextTokens: z.number().default(0),
      preferredModel: z.string().optional(),
    }),
  },

  "router.select_tool": {
    description: "Select best tool for a task",
    parameters: z.object({
      task: z.string().describe("Task description"),
      availableTools: z.array(z.string()).describe("Available tool names"),
    }),
  },

  "router.evaluate_cost": {
    description: "Evaluate cost of model/tool selection",
    parameters: z.object({
      model: z.string().describe("Model key"),
      promptTokens: z.number(),
      completionTokens: z.number(),
      toolCalls: z.number().default(0),
    }),
  },
} as const;

export type ToolName = keyof typeof toolDefinitions;
export type ToolParameters<T extends ToolName> = z.infer<typeof toolDefinitions[T]["parameters"]>;
export type ToolResult<T extends ToolName> = unknown; // Defined per tool

/** Get tool schema for OpenAI function calling format */
export function getToolSchema(name: ToolName) {
  const def = toolDefinitions[name];
  return {
    type: "function" as const,
    function: {
      name,
      description: def.description,
      parameters: def.parameters,
    },
  };
}

/** Get all tool schemas */
export function getAllToolSchemas() {
  return (Object.keys(toolDefinitions) as ToolName[]).map((n) => getToolSchema(n));
}

/** Get tools by namespace */
export function getToolsByNamespace(namespace: string) {
  const prefix = `${namespace}.`;
  return (Object.keys(toolDefinitions) as ToolName[])
    .filter((k) => k.startsWith(prefix))
    .map(getToolSchema);
}