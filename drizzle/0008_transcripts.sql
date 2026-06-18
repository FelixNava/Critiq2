CREATE TABLE "recording_transcripts" (
	"id" text PRIMARY KEY NOT NULL,
	"recording_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider" text DEFAULT 'deepgram' NOT NULL,
	"model" text DEFAULT 'nova-3' NOT NULL,
	"text" text,
	"word_count" integer,
	"duration_ms" integer,
	"segment_count" integer DEFAULT 0 NOT NULL,
	"language" text,
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transcript_segments" (
	"id" text PRIMARY KEY NOT NULL,
	"transcript_id" text NOT NULL,
	"recording_id" text NOT NULL,
	"segment_index" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"text" text,
	"words" jsonb,
	"confidence" real,
	"duration_ms" integer,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recording_transcripts" ADD CONSTRAINT "recording_transcripts_recording_id_recordings_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."recordings"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD CONSTRAINT "transcript_segments_transcript_id_recording_transcripts_id_fk" FOREIGN KEY ("transcript_id") REFERENCES "public"."recording_transcripts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD CONSTRAINT "transcript_segments_recording_id_recordings_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."recordings"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "recording_transcripts_recording_id_key" ON "recording_transcripts" USING btree ("recording_id");
--> statement-breakpoint
CREATE INDEX "recording_transcripts_status_idx" ON "recording_transcripts" USING btree ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX "transcript_segments_transcript_segment_key" ON "transcript_segments" USING btree ("transcript_id","segment_index");
--> statement-breakpoint
CREATE INDEX "transcript_segments_transcript_id_idx" ON "transcript_segments" USING btree ("transcript_id");
--> statement-breakpoint
CREATE INDEX "transcript_segments_recording_id_idx" ON "transcript_segments" USING btree ("recording_id");
