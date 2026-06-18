CREATE TABLE "call_debriefs" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"user_id" text NOT NULL,
	"recording_id" text,
	"brief_id" text,
	"report" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider" text DEFAULT 'anthropic' NOT NULL,
	"model" text DEFAULT 'claude-sonnet-4-6' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"recap" text,
	"observations" jsonb,
	"commitments" jsonb,
	"open_questions" jsonb,
	"summary" text,
	"usefulness_rating" integer,
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "call_debriefs" ADD CONSTRAINT "call_debriefs_account_id_account_records_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account_records"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "call_debriefs" ADD CONSTRAINT "call_debriefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "call_debriefs" ADD CONSTRAINT "call_debriefs_recording_id_recordings_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."recordings"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "call_debriefs" ADD CONSTRAINT "call_debriefs_brief_id_pre_call_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."pre_call_briefs"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "call_debriefs_account_id_idx" ON "call_debriefs" USING btree ("account_id");
--> statement-breakpoint
CREATE INDEX "call_debriefs_user_id_idx" ON "call_debriefs" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "call_debriefs_recording_id_idx" ON "call_debriefs" USING btree ("recording_id");
--> statement-breakpoint
CREATE INDEX "call_debriefs_brief_id_idx" ON "call_debriefs" USING btree ("brief_id");
