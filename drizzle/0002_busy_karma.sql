CREATE TABLE "rep_intake_progress" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"dimension" text NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rep_intake_responses" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"dimension" text NOT NULL,
	"question_key" text NOT NULL,
	"answer" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rep_intake_progress" ADD CONSTRAINT "rep_intake_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rep_intake_responses" ADD CONSTRAINT "rep_intake_responses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rep_intake_progress_user_dimension_key" ON "rep_intake_progress" USING btree ("user_id","dimension");--> statement-breakpoint
CREATE INDEX "rep_intake_progress_user_id_idx" ON "rep_intake_progress" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rep_intake_responses_user_question_key" ON "rep_intake_responses" USING btree ("user_id","question_key");--> statement-breakpoint
CREATE INDEX "rep_intake_responses_user_id_idx" ON "rep_intake_responses" USING btree ("user_id");