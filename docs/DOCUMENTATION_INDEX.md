# Documentation Index

Índice oficial de toda la documentación de SiteDock.

## Getting Started

| Documento | Audiencia | Cuándo leerlo |
|-----------|-----------|---------------|
| [README.md](../README.md) | Todos | Primera entrada: qué es SiteDock, stack, quick start |
| [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md) | Developers | Setup completo paso a paso + flujos manuales |

## Arquitectura y diseño

| Documento | Audiencia | Cuándo leerlo |
|-----------|-----------|---------------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Architects, tech leads | Comprender bounded contexts y decisiones |
| [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md) | Developers nuevos | Convenciones, reglas que NO romper, estructura |
| [DATABASE_GUIDE.md](DATABASE_GUIDE.md) | Backend devs | Schema Prisma, migraciones, constraints, aislamiento |
| [adr/0001–0006](adr/) | Architects | Decisiones arquitectónicas con contexto y alternativas |

## API

| Documento | Audiencia | Cuándo leerlo |
|-----------|-----------|---------------|
| [API_CONTRACT.md](API_CONTRACT.md) | Frontend devs, integradores | Todos los endpoints con auth/roles/input/output/errores |

## Seguridad

| Documento | Audiencia | Cuándo leerlo |
|-----------|-----------|---------------|
| [SECURITY.md](SECURITY.md) | Security engineers | Modelo de seguridad implementado |
| [MULTI_TENANT_SECURITY_MODEL.md](MULTI_TENANT_SECURITY_MODEL.md) | Security engineers | Fronteras de aislamiento entre tenants |
| [AUTHORIZATION_MATRIX.md](AUTHORIZATION_MATRIX.md) | Developers, security | Matriz rol × operación × recurso |
| [THREAT_MODEL.md](THREAT_MODEL.md) | Security engineers | Activos, superficies de ataque, controles |
| [SECURITY_CHECKLIST.md](SECURITY_CHECKLIST.md) | Release managers | Checklist pre-release obligatorio |

## Testing

| Documento | Audiencia | Cuándo leerlo |
|-----------|-----------|---------------|
| [TESTING_STRATEGY.md](TESTING_STRATEGY.md) | QA, developers | Estrategia por capas, cuándo agregar tests |

## Operaciones

| Documento | Audiencia | Cuándo leerlo |
|-----------|-----------|---------------|
| [OPERATIONS_MANUAL.md](OPERATIONS_MANUAL.md) | DevOps, SRE | Start, stop, logs, health, workers, secrets |
| [DEPLOYMENT_RUNBOOK.md](DEPLOYMENT_RUNBOOK.md) | DevOps | Deployment paso a paso con rollback |
| [RATE_LIMITING.md](RATE_LIMITING.md) | DevOps, security | Límites de tasa por categoría |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | DevOps, support | Resolución de problemas comunes |
| [RELEASE_MANAGEMENT.md](RELEASE_MANAGEMENT.md) | Tech leads | Versionado, release process, rollback |

## Providers

| Documento | Audiencia | Cuándo leerlo |
|-----------|-----------|---------------|
| [PROVIDER_INTEGRATION.md](PROVIDER_INTEGRATION.md) | Backend devs | Arquitectura ports/adapters para Stripe, S3, Resend |

## Producción

| Documento | Audiencia | Cuándo leerlo |
|-----------|-----------|---------------|
| [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) | Tech leads, PMs | Estado real de preparación para producción |
| [INFRASTRUCTURE_ASSESSMENT.md](INFRASTRUCTURE_ASSESSMENT.md) | DevOps, architects | Evaluación de infraestructura necesaria |
| [ENVIRONMENT_CAPABILITY.md](ENVIRONMENT_CAPABILITY.md) | Todos | Qué puede verificarse en este entorno |
| [SUPPLY_CHAIN_ASSESSMENT.md](SUPPLY_CHAIN_ASSESSMENT.md) | Security, DevOps | Auditoría de dependencias npm |
| [PRODUCTION_CONFIGURATION_MATRIX.md](PRODUCTION_CONFIGURATION_MATRIX.md) | DevOps, security | Variables de entorno por entorno |
| [REAL_INFRASTRUCTURE_VERIFICATION.md](REAL_INFRASTRUCTURE_VERIFICATION.md) | Tech leads | Estado de verificación contra infraestructura real |

## White-label

| Documento | Audiencia | Cuándo leerlo |
|-----------|-----------|---------------|
| [WHITE_LABEL_ARCHITECTURE.md](WHITE_LABEL_ARCHITECTURE.md) | Architects, product | Evaluación de arquitectura white-label |
