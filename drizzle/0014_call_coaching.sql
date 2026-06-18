CREATE TABLE "call_coaching" (
	"id" text PRIMARY KEY NOT NULL,
	"debrief_id" text NOT NULL,
	"account_id" text NOT NULL,
	"user_id" text NOT NULL,
	"recording_id" text,
	"score_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider" text DEFAULT 'anthropic' NOT NULL,
	"model" text DEFAULT 'claude-sonnet-4-6' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"priorities" jsonb,
	"reinforce" jsonb,
	"next_step" text,
	"summary" text,
	"score_snapshot" jsonb,
	"usefulness_rating" integer,
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "call_coaching" ADD CONSTRAINT "call_coaching_debrief_id_call_debriefs_id_fk" FOREIGN KEY ("debrief_id") REFERENCES "public"."call_debriefs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "call_coaching" ADD CONSTRAINT "call_coaching_account_id_account_records_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account_records"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "call_coaching" ADD CONSTRAINT "call_coaching_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "call_coaching" ADD CONSTRAINT "call_coaching_recording_id_recordings_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."recordings"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "call_coaching" ADD CONSTRAINT "call_coaching_score_id_call_scores_id_fk" FOREIGN KEY ("score_id") REFERENCES "public"."call_scores"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "call_coaching_debrief_id_idx" ON "call_coaching" USING btree ("debrief_id");
--> statement-breakpoint
CREATE INDEX "call_coaching_account_id_idx" ON "call_coaching" USING btree ("account_id");
--> statement-breakpoint
CREATE INDEX "call_coaching_user_id_idx" ON "call_coaching" USING btree ("user_id");
