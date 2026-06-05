CREATE TABLE "rate_limit_counters" (
	"bucket_key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "rate_limit_counters_expires_at_idx" ON "rate_limit_counters" USING btree ("expires_at");