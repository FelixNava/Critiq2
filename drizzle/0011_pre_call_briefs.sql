CREATE TABLE "pre_call_briefs" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"user_id" text NOT NULL,
	"interaction_number" integer DEFAULT 1 NOT NULL,
	"narration" text NOT NULL,
	"objective_source" text DEFAULT 'rep' NOT NULL,
	"objective" text,
	"recommended_objective" text,
	"overridden" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider" text DEFAULT 'anthropic' NOT NULL,
	"model" text DEFAULT 'claude-sonnet-4-6' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"diagnosis" text,
	"approach" jsonb,
	"objections" jsonb,
	"summary" text,
	"usefulness_rating" integer,
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pre_call_briefs" ADD CONSTRAINT "pre_call_briefs_account_id_account_records_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account_records"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pre_call_briefs" ADD CONSTRAINT "pre_call_briefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "pre_call_briefs_account_id_idx" ON "pre_call_briefs" USING btree ("account_id");
--> statement-breakpoint
CREATE INDEX "pre_call_briefs_user_id_idx" ON "pre_call_briefs" USING btree ("user_id");
