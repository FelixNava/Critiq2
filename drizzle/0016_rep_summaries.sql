CREATE TABLE "rep_summaries" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider" text DEFAULT 'anthropic' NOT NULL,
	"model" text DEFAULT 'claude-sonnet-4-6' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"headline" text,
	"narrative" text,
	"traits" jsonb,
	"debrief_count" integer DEFAULT 0 NOT NULL,
	"consolidated_through_at" timestamp with time zone,
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rep_summaries" ADD CONSTRAINT "rep_summaries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "rep_summaries_user_id_key" ON "rep_summaries" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "rep_summaries_status_idx" ON "rep_summaries" USING btree ("status");
