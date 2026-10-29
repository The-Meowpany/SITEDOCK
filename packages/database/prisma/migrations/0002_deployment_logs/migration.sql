-- Add new enum values to DeploymentStatus
ALTER TYPE "DeploymentStatus" ADD VALUE 'DEPLOYING';
ALTER TYPE "DeploymentStatus" ADD VALUE 'LIVE';
ALTER TYPE "DeploymentStatus" ADD VALUE 'SUPERSEDED';

-- Add new columns to deployments
ALTER TABLE "deployments" ADD COLUMN "deployed_at" TIMESTAMP(3);
ALTER TABLE "deployments" ADD COLUMN "superseded_at" TIMESTAMP(3);
ALTER TABLE "deployments" ADD COLUMN "is_preview" BOOLEAN NOT NULL DEFAULT false;

-- Create deployment_logs table
CREATE TABLE "deployment_logs" (
    "id" TEXT NOT NULL,
    "deployment_id" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSON,

    CONSTRAINT "deployment_logs_pkey" PRIMARY KEY ("id")
);

-- Add foreign key
ALTER TABLE "deployment_logs" ADD CONSTRAINT "deployment_logs_deployment_id_fkey" FOREIGN KEY ("deployment_id") REFERENCES "deployments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Create indexes
CREATE INDEX "deployment_logs_deployment_id_idx" ON "deployment_logs"("deployment_id");
CREATE INDEX "deployment_logs_timestamp_idx" ON "deployment_logs"("timestamp");
CREATE INDEX "deployments_is_preview_idx" ON "deployments"("is_preview");
