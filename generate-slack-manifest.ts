#!/usr/bin/env tsx

/** Generate Slack App Manifest for easy setup */

const manifest = {
  display_information: {
    name: "Agent",
    description: "Autonomous agent with memory, tools, and multi-model reasoning",
    background_color: "#4A154B",
  },
  features: {
    bot_user: {
      display_name: "Agent",
      always_online: true,
    },
    slash_commands: [
      { command: "/agent", description: "Ask the agent anything", usage_hint: "<your request>" },
      { command: "/ask", description: "Alias for /agent", usage_hint: "<your request>" },
      { command: "/task", description: "Manage tasks", usage_hint: "create|status|cancel|list" },
      { command: "/tasks", description: "List your tasks" },
      { command: "/memory", description: "Memory operations", usage_hint: "search|write|list" },
      { command: "/remember", description: "Quick save to memory", usage_hint: "<content>" },
      { command: "/recall", description: "Quick memory search", usage_hint: "<query>" },
      { command: "/agent-status", description: "Show system status" },
      { command: "/agent-help", description: "Show help" },
    ],
    shortcuts: [
      { name: "Create Task", type: "global", callback_id: "create_task", description: "Create a new task" },
      { name: "Search Memories", type: "global", callback_id: "search_memory", description: "Search your memories" },
      { name: "Agent Help", type: "global", callback_id: "agent_help", description: "Show help" },
      { name: "Summarize Thread", type: "message", callback_id: "summarize_thread", description: "Summarize this thread" },
      { name: "Create Task from Message", type: "message", callback_id: "create_task_from_msg", description: "Turn message into task" },
      { name: "Remember Message", type: "message", callback_id: "remember_message", description: "Save message to memory" },
    ],
    unfurl_domains: [],
  },
  oauth_config: {
    redirect_urls: ["https://your-worker.your-subdomain.workers.dev/slack/oauth/callback"],
    scopes: {
      bot: [
        "app_mentions:read",
        "channels:history",
        "channels:read",
        "chat:write",
        "chat:write.public",
        "commands",
        "files:read",
        "files:write",
        "groups:history",
        "groups:read",
        "im:history",
        "im:read",
        "im:write",
        "mpim:history",
        "mpim:read",
        "mpim:write",
        "reactions:read",
        "reactions:write",
        "shortcuts:read",
        "shortcuts:write",
        "team:read",
        "users:read",
        "users:read.email",
      ],
    },
  },
  settings: {
    event_subscriptions: {
      request_url: "https://your-worker.your-subdomain.workers.dev/slack/events",
      bot_events: [
        "app_mention",
        "file_shared",
        "message.channels",
        "message.groups",
        "message.im",
        "message.mpim",
        "reaction_added",
        "member_joined_channel",
      ],
    },
    interactivity: {
      is_enabled: true,
      request_url: "https://your-worker.your-subdomain.workers.dev/slack/interactions",
    },
    org_deploy_enabled: false,
    socket_mode_enabled: true,
    token_rotation_enabled: true,
  },
};

console.log(JSON.stringify(manifest, null, 2));