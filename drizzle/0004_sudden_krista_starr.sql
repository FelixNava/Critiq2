CREATE TABLE "recording_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"recording_id" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"blob_pathname" text NOT NULL,
	"blob_url" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"duration_ms" integer,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"uploaded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recordings" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text,
	"status" text DEFAULT 'recording' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"duration_ms" integer,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recording_chunks" ADD CONSTRAINT "recording_chunks_recording_id_recordings_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."recordings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_account_id_account_records_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recording_chunks_recording_chunk_key" ON "recording_chunks" USING btree ("recording_id","chunk_index");--> statement-breakpoint
CREATE INDEX "recording_chunks_recording_id_idx" ON "recording_chunks" USING btree ("recording_id");--> statement-breakpoint
CREATE INDEX "recordings_user_id_idx" ON "recordings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "recordings_account_id_idx" ON "recordings" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "recordings_deleted_at_idx" ON "recordings" USING btree ("deleted_at");