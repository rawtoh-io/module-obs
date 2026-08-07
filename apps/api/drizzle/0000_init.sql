CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"host" text DEFAULT '127.0.0.1' NOT NULL,
	"port" integer DEFAULT 4455 NOT NULL,
	"password" text DEFAULT '' NOT NULL,
	"instance_id" text,
	"private_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"sid" text PRIMARY KEY NOT NULL,
	"data" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
