-- Add ServiceType enum
CREATE TYPE "ServiceType" AS ENUM ('WEB', 'API', 'WORKER', 'DATABASE', 'STORAGE', 'CRON');

-- Add ServiceStatus enum
CREATE TYPE "ServiceStatus" AS ENUM ('PENDING', 'BUILDING', 'DEPLOYING', 'LIVE', 'FAILED', 'STOPPED', 'SUPERSEDED');

-- Add ServiceDeploymentStatus enum
CREATE TYPE "ServiceDeploymentStatus" AS ENUM ('QUEUED', 'BUILDING', 'READY', 'FAILED');

-- Add ContainerInstanceStatus enum
CREATE TYPE "ContainerInstanceStatus" AS ENUM ('RUNNING', 'STOPPED', 'FAILED');

-- CreateService table
CREATE TABLE "services" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ServiceType" NOT NULL DEFAULT 'WEB',
    "status" "ServiceStatus" NOT NULL DEFAULT 'PENDING',
    "source_type" TEXT NOT NULL DEFAULT 'github',
    "source_url" TEXT,
    "source_branch" TEXT,
    "source_path" TEXT,
    "dockerfile" TEXT,
    "build_command" TEXT,
    "start_command" TEXT,
    "port" INTEGER NOT NULL DEFAULT 8080,
    "env" JSON,
    "cpu_limit" TEXT,
    "memory_limit" TEXT,
    "pids_limit" INTEGER,
    "readonly_root" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateServiceDeployment table
CREATE TABLE "service_deployments" (
    "id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "ServiceDeploymentStatus" NOT NULL DEFAULT 'QUEUED',
    "image_id" TEXT,
    "image_digest" TEXT,
    "build_log" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "service_deployments_pkey" PRIMARY KEY ("id")
);

-- CreateContainerInstance table
CREATE TABLE "container_instances" (
    "id" TEXT NOT NULL,
    "deployment_id" TEXT NOT NULL,
    "container_id" TEXT NOT NULL,
    "status" "ContainerInstanceStatus" NOT NULL DEFAULT 'RUNNING',
    "host_port" INTEGER,
    "container_port" INTEGER NOT NULL DEFAULT 8080,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stopped_at" TIMESTAMP(3),
    "restart_count" INTEGER NOT NULL DEFAULT 0,
    "last_health_check" TIMESTAMP(3),

    CONSTRAINT "container_instances_pkey" PRIMARY KEY ("id")
);

-- Add foreign keys
ALTER TABLE "services" ADD CONSTRAINT "services_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "service_deployments" ADD CONSTRAINT "service_deployments_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "container_instances" ADD CONSTRAINT "container_instances_deployment_id_fkey" FOREIGN KEY ("deployment_id") REFERENCES "service_deployments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add unique constraints
CREATE UNIQUE INDEX "service_deployments_service_id_version_key" ON "service_deployments"("service_id", "version");
CREATE UNIQUE INDEX "container_instances_container_id_key" ON "container_instances"("container_id");

-- Add indexes
CREATE INDEX "services_project_id_idx" ON "services"("project_id");
CREATE INDEX "service_deployments_service_id_idx" ON "service_deployments"("service_id");
CREATE INDEX "container_instances_deployment_id_idx" ON "container_instances"("deployment_id");
