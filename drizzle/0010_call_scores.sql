CREATE TABLE "call_scores" (
	"id" text PRIMARY KEY NOT NULL,
	"recording_id" text NOT NULL,
	"transcript_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider" text DEFAULT 'anthropic' NOT NULL,
	"model" text DEFAULT 'claude-sonnet-4-6' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"overall_score" integer,
	"spin_score" integer,
	"voss_score" integer,
	"navarro_score" integer,
	"dimensions" jsonb,
	"strengths" jsonb,
	"improvements" jsonb,
	"summary" text,
	"partial_judgement" boolean DEFAULT false NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "call_scores" ADD CONSTRAINT "call_scores_recording_id_recordings_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."recordings"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "call_scores" ADD CONSTRAINT "call_scores_transcript_id_recording_transcripts_id_fk" FOREIGN KEY ("transcript_id") REFERENCES "public"."recording_transcripts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "call_scores_recording_id_key" ON "call_scores" USING btree ("recording_id");
--> statement-breakpoint
CREATE INDEX "call_scores_status_idx" ON "call_scores" USING btree ("status");
