import { pgTable, uuid, text, timestamp, jsonb, index, boolean, integer } from "drizzle-orm/pg-core";

/** Slack user mapping and roles */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slackId: text("slack_id").notNull().unique(),
    slackTeamId: text("slack_team_id").notNull(),
    username: text("username"),
    displayName: text("display_name"),
    realName: text("real_name"),
    email: text("email"),
    avatarUrl: text("avatar_url"),
    isBot: boolean("is_bot").default(false),
    isAdmin: boolean("is_admin").default(false),
    isOwner: boolean("is_owner").default(false),
    roles: text("roles").array().default([]), // ["admin", "premium", "developer"]
    permissions: jsonb("permissions").$type<Record<string, boolean>>().default({}),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    lastActive: timestamp("last_active", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    slackIdIdx: index("users_slack_id_idx").on(table.slackId),
    teamIdx: index("users_team_idx").on(table.slackTeamId),
  })
);

/** Slack installations (for multi-workspace support) */
export const installations = pgTable(
  "installations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: text("team_id").notNull().unique(),
    teamName: text("team_name"),
    botToken: text("bot_token").notNull(), // Encrypted
    botUserId: text("bot_user_id").notNull(),
    botScopes: text("bot_scopes").array().default([]),
    installerId: text("installer_id").notNull(),
    installerUsername: text("installer_username"),
    enterpriseId: text("enterprise_id"),
    enterpriseName: text("enterprise_name"),
    isEnterpriseInstall: boolean("is_enterprise_install").default(false),
    tokenType: text("token_type").default("bot"),
    installedAt: timestamp("installed_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  }
);

/** OAuth states for Slack install flow */
export const oauthStates = pgTable(
  "oauth_states",
  {
    state: text("state").primaryKey(),
    teamId: text("team_id"),
    redirectUrl: text("redirect_url"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  }
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Installation = typeof installations.$inferSelect;
export type OAuthState = typeof oauthStates.$inferSelect;