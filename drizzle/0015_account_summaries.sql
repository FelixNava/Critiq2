CREATE TABLE "account_summaries" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider" text DEFAULT 'anthropic' NOT NULL,
	"model" text DEFAULT 'claude-sonnet-4-6' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"headline" text,
	"narrative" text,
	"facts" jsonb,
	"debrief_count" integer DEFAULT 0 NOT NULL,
	"consolidated_through_at" timestamp with time zone,
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_summaries" ADD CONSTRAINT "account_summaries_account_id_account_records_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account_records"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "account_summaries_account_id_key" ON "account_summaries" USING btree ("account_id");
--> statement-breakpoint
CREATE INDEX "account_summaries_status_idx" ON "account_summaries" USING btree ("status");
