CREATE TABLE IF NOT EXISTS "conversation_contexts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" text NOT NULL,
	"thread_ts" text,
	"user_id" text NOT NULL,
	"summary" text,
	"key_points" text[] DEFAULT '{}',
	"active_topics" text[] DEFAULT '{}',
	"message_count" integer DEFAULT 0,
	"token_estimate" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"embedding" vector(1536),
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"scope" text DEFAULT 'global' NOT NULL,
	"scope_id" text,
	"tags" text[] DEFAULT '{}',
	"importance" integer DEFAULT 5,
	"access_count" integer DEFAULT 0,
	"last_accessed" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "memories_content_hash_unique" UNIQUE("content_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_memory_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"preferences" jsonb DEFAULT '{}'::jsonb,
	"summary" text,
	"total_memories" integer DEFAULT 0,
	"last_updated" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scheduled_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"cron_expression" text NOT NULL,
	"task_template" jsonb NOT NULL,
	"enabled" boolean DEFAULT true,
	"last_run" timestamp with time zone,
	"next_run" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "scheduled_tasks_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"step_number" integer NOT NULL,
	"name" text NOT NULL,
	"tool_name" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"priority" integer DEFAULT 5,
	"payload" jsonb NOT NULL,
	"result" jsonb,
	"error" text,
	"retry_count" integer DEFAULT 0,
	"max_retries" integer DEFAULT 3,
	"scheduled_for" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"channel_id" text,
	"thread_ts" text,
	"trace_id" text,
	"tags" text[] DEFAULT '{}',
	"progress" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" text NOT NULL,
	"team_name" text,
	"bot_token" text NOT NULL,
	"bot_user_id" text NOT NULL,
	"bot_scopes" text[] DEFAULT '{}',
	"installer_id" text NOT NULL,
	"installer_username" text,
	"enterprise_id" text,
	"enterprise_name" text,
	"is_enterprise_install" boolean DEFAULT false,
	"token_type" text DEFAULT 'bot',
	"installed_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "installations_team_id_unique" UNIQUE("team_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_states" (
	"state" text PRIMARY KEY NOT NULL,
	"team_id" text,
	"redirect_url" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slack_id" text NOT NULL,
	"slack_team_id" text NOT NULL,
	"username" text,
	"display_name" text,
	"real_name" text,
	"email" text,
	"avatar_url" text,
	"is_bot" boolean DEFAULT false,
	"is_admin" boolean DEFAULT false,
	"is_owner" boolean DEFAULT false,
	"roles" text[] DEFAULT '{}',
	"permissions" jsonb DEFAULT '{}'::jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"last_active" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "users_slack_id_unique" UNIQUE("slack_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "analytics_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_name" text NOT NULL,
	"user_id" text,
	"channel_id" text,
	"thread_ts" text,
	"properties" jsonb DEFAULT '{}'::jsonb,
	"metrics" jsonb DEFAULT '{}'::jsonb,
	"trace_id" text,
	"session_id" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"level" text NOT NULL,
	"message" text NOT NULL,
	"service" text DEFAULT 'agent-core' NOT NULL,
	"trace_id" text,
	"span_id" text,
	"user_id" text,
	"channel_id" text,
	"thread_ts" text,
	"tool_name" text,
	"model" text,
	"step" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"error" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "model_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model" text NOT NULL,
	"task_type" text,
	"prompt_tokens" integer NOT NULL,
	"completion_tokens" integer NOT NULL,
	"total_tokens" integer NOT NULL,
	"latency_ms" integer NOT NULL,
	"cost_usd" text,
	"success" boolean DEFAULT true,
	"error" text,
	"user_id" text,
	"trace_id" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task_steps" ADD CONSTRAINT "task_steps_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conv_ctx_channel_thread_idx" ON "conversation_contexts" USING btree ("channel_id","thread_ts");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conv_ctx_user_idx" ON "conversation_contexts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memories_scope_idx" ON "memories" USING btree ("scope","scope_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memories_tags_idx" ON "memories" USING btree ("tags");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memories_importance_idx" ON "memories" USING btree ("importance");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memories_created_at_idx" ON "memories" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memories_embedding_idx" ON "memories" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_steps_task_step_idx" ON "task_steps" USING btree ("task_id","step_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_status_idx" ON "tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_created_by_idx" ON "tasks" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_scheduled_idx" ON "tasks" USING btree ("scheduled_for");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_trace_idx" ON "tasks" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_slack_id_idx" ON "users" USING btree ("slack_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_team_idx" ON "users" USING btree ("slack_team_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_event_idx" ON "analytics_events" USING btree ("event_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_user_idx" ON "analytics_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_created_at_idx" ON "analytics_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_session_idx" ON "analytics_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "logs_level_idx" ON "logs" USING btree ("level");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "logs_trace_idx" ON "logs" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "logs_user_idx" ON "logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "logs_tool_idx" ON "logs" USING btree ("tool_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "logs_created_at_idx" ON "logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "logs_service_level_idx" ON "logs" USING btree ("service","level");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "model_usage_model_idx" ON "model_usage" USING btree ("model");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "model_usage_task_type_idx" ON "model_usage" USING btree ("task_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "model_usage_user_idx" ON "model_usage" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "model_usage_created_at_idx" ON "model_usage" USING btree ("created_at");