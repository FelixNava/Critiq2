CREATE TABLE "account_rep_joins" (
	"account_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'owner' NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_rep_joins_account_id_user_id_pk" PRIMARY KEY("account_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "account_records" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"stage" text DEFAULT 'prospecting' NOT NULL,
	"summary" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"name" text NOT NULL,
	"title" text,
	"email" text,
	"phone" text,
	"notes" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "account_rep_joins" ADD CONSTRAINT "account_rep_joins_account_id_account_records_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_rep_joins" ADD CONSTRAINT "account_rep_joins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_records" ADD CONSTRAINT "account_records_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_account_id_account_records_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_rep_joins_user_id_idx" ON "account_rep_joins" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "account_rep_joins_account_id_idx" ON "account_rep_joins" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "account_records_created_by_idx" ON "account_records" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "account_records_deleted_at_idx" ON "account_records" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "contacts_account_id_idx" ON "contacts" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "contacts_deleted_at_idx" ON "contacts" USING btree ("deleted_at");