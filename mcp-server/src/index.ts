/**
 * Agent-Core MCP Server
 *
 * Exposes all agent-core tools via Model Context Protocol (MCP).
 * Transport: Streamable HTTP (POST /mcp for requests, GET /mcp for SSE stream)
 * Auth: Bearer token (MCP_API_KEY)
 * Deploy: Fly.io
 */
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getAllTools } from "./tools.js";

// ─── Config ──────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || "8080", 10);
const MCP_API_KEY = process.env.MCP_API_KEY;
const SERVER_NAME = "agent-core-mcp";
const SERVER_VERSION = "1.0.0";

// ─── Auth middleware ─────────────────────────────────────────────────────────

function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Health check doesn't need auth
  if (req.path === "/health" || req.path === "/") {
    next();
    return;
  }

  if (!MCP_API_KEY) {
    // No key configured — allow all (dev mode)
    next();
    return;
  }

  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ") || auth.slice(7) !== MCP_API_KEY) {
    res.status(401).json({ error: "Unauthorized — provide Bearer token in Authorization header" });
    return;
  }
  next();
}

// ─── Server setup ────────────────────────────────────────────────────────────

async function main() {
  const app = express();

  app.use(authMiddleware);

  // Health check
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      server: SERVER_NAME,
      version: SERVER_VERSION,
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/", (_req, res) => {
    res.json({
      name: SERVER_NAME,
      version: SERVER_VERSION,
      protocol: "MCP",
      transport: "Streamable HTTP",
      endpoint: "/mcp",
      docs: "https://modelcontextprotocol.io",
    });
  });

  // Track transports by session for resumability
  const transports = new Map<string, StreamableHTTPServerTransport>();

  // Handle MCP requests (POST /mcp)
  app.post("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports.has(sessionId)) {
      // Existing session
      transport = transports.get(sessionId)!;
    } else if (!sessionId) {
      // New session — create server + transport
      const server = createMcpServer();
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          transports.set(sid, transport);
        },
      });

      transport.onclose = () => {
        const sid = (transport as any).sessionId;
        if (sid) transports.delete(sid);
      };

      await server.connect(transport);
    } else {
      // Session ID provided but not found
      res.status(400).json({ error: "Invalid session ID. Start a new session without mcp-session-id header." });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  });

  // Handle SSE stream (GET /mcp) for server-initiated messages
  app.get("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).json({ error: "Invalid or missing session ID" });
      return;
    }
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res);
  });

  // Handle DELETE for session cleanup
  app.delete("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (sessionId && transports.has(sessionId)) {
      const transport = transports.get(sessionId)!;
      await transport.close();
      transports.delete(sessionId);
    }
    res.status(200).json({ ok: true });
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 ${SERVER_NAME} v${SERVER_VERSION} running on port ${PORT}`);
    console.log(`   Transport: Streamable HTTP`);
    console.log(`   Endpoint:  POST/GET /mcp`);
    console.log(`   Health:    GET /health`);
    console.log(`   Auth:      ${MCP_API_KEY ? "API Key (Bearer)" : "OPEN (dev mode)"}`);
  });
}

// ─── MCP Server factory ─────────────────────────────────────────────────────

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  const tools = getAllTools();

  // Register all tools with Zod shape schemas
  for (const [name, def] of Object.entries(tools)) {
    server.tool(name, def.description, def.shape, async (args) => {
      try {
        const result = await def.handler(args as Record<string, unknown>);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: msg }) }],
          isError: true,
        };
      }
    });
  }

  // Register prompts — useful prompt templates
  server.prompt(
    "analyze-memories",
    "Analyze and summarize agent memories on a topic",
    { topic: z.string().describe("Topic to analyze") },
    async ({ topic }) => ({
      messages: [{
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `Search the agent's memory for information about "${topic}". Use the memory_search tool with this query, then provide a comprehensive summary of what the agent knows about this topic, including key facts, related context, and any gaps in knowledge.`,
        },
      }],
    })
  );

  server.prompt(
    "system-health",
    "Check agent system health and recent activity",
    async () => ({
      messages: [{
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `Run a health check on the agent system:
1. Use log_search to find recent errors (level: "error", limit: 10)
2. Use model_usage_summary to check recent model costs
3. Summarize the system's health: any errors, cost trends, and recommendations.`,
        },
      }],
    })
  );

  return server;
}

// ─── Start ───────────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
