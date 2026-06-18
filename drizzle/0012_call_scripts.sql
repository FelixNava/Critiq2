CREATE TABLE "call_scripts" (
	"id" text PRIMARY KEY NOT NULL,
	"brief_id" text NOT NULL,
	"account_id" text NOT NULL,
	"user_id" text NOT NULL,
	"style_mode" text DEFAULT 'relational' NOT NULL,
	"objective" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider" text DEFAULT 'anthropic' NOT NULL,
	"model" text DEFAULT 'claude-sonnet-4-6' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"opener" text,
	"sections" jsonb,
	"closing" text,
	"delivery_notes" jsonb,
	"usefulness_rating" integer,
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "call_scripts" ADD CONSTRAINT "call_scripts_brief_id_pre_call_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."pre_call_briefs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "call_scripts" ADD CONSTRAINT "call_scripts_account_id_account_records_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account_records"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "call_scripts" ADD CONSTRAINT "call_scripts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "call_scripts_brief_id_idx" ON "call_scripts" USING btree ("brief_id");
--> statement-breakpoint
CREATE INDEX "call_scripts_account_id_idx" ON "call_scripts" USING btree ("account_id");
--> statement-breakpoint
CREATE INDEX "call_scripts_user_id_idx" ON "call_scripts" USING btree ("user_id");
