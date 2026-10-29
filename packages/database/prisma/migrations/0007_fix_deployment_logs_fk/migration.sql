-- Fix foreign key on deployment_logs to reference service_deployments instead of deployments
ALTER TABLE "deployment_logs" DROP CONSTRAINT "deployment_logs_deployment_id_fkey";
ALTER TABLE "deployment_logs" ADD CONSTRAINT "deployment_logs_deployment_id_fkey" FOREIGN KEY ("deployment_id") REFERENCES "service_deployments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
