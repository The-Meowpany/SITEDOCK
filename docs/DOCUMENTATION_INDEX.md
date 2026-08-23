# Documentation Index

Índice oficial de toda la documentación de SiteDock.

## Arquitectura y diseño

| Documento | Descripción |
|-----------|-------------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Visión general de arquitectura, bounded contexts, stack |
| [adr/0001-modular-monolith.md](adr/0001-modular-monolith.md) | Modular Monolith + Async Workers |
| [adr/0002-postgresql-prisma.md](adr/0002-postgresql-prisma.md) | PostgreSQL + Prisma como persistencia |
| [adr/0003-provider-abstractions.md](adr/0003-provider-abstractions.md) | Ports para servicios externos |
| [adr/0004-money-integer-minor-units.md](adr/0004-money-integer-minor-units.md) | Money en centavos enteros |
| [adr/0005-centralized-state-machines.md](adr/0005-centralized-state-machines.md) | State machines centralizadas |
| [adr/0006-stripe-connect-money.md](adr/0006-stripe-connect-money.md) | Stripe Connect como autoridad económica |

## Desarrollo

| Documento | Descripción |
|-----------|-------------|
| [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md) | Setup completo paso a paso + flujos manuales |
| [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md) | Guía para developers nuevos: convenciones, reglas, estructura |
| [TESTING_STRATEGY.md](TESTING_STRATEGY.md) | Estrategia de testing: qué, cuándo y por qué |

## Seguridad

| Documento | Descripción |
|-----------|-------------|
| [SECURITY.md](SECURITY.md) | Modelo de seguridad implementado |
| [MULTI_TENANT_SECURITY_MODEL.md](MULTI_TENANT_SECURITY_MODEL.md) | Fronteras de aislamiento entre tenants |
| [AUTHORIZATION_MATRIX.md](AUTHORIZATION_MATRIX.md) | Matriz rol x operación x recurso |
| [THREAT_MODEL.md](THREAT_MODEL.md) | Activos, superficies de ataque, controles |

## Operaciones

| Documento | Descripción |
|-----------|-------------|
| [OPERATIONS_MANUAL.md](OPERATIONS_MANUAL.md) | Manual operacional: start, stop, logs, health, deploy |
| [DEPLOYMENT_RUNBOOK.md](DEPLOYMENT_RUNBOOK.md) | Runbook de deployment paso a paso |
| [RATE_LIMITING.md](RATE_LIMITING.md) | Límites de tasa por categoría |
| [BACKUP_RESTORE.md](BACKUP_RESTORE.md) | Backup y restore de deployments (S3) |

## Producción

| Documento | Descripción |
|-----------|-------------|
| [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) | Estado real de preparación para producción |
| [ENVIRONMENT_CAPABILITY.md](ENVIRONMENT_CAPABILITY.md) | Capacidades del entorno de desarrollo |
| [INFRASTRUCTURE_ASSESSMENT.md](INFRASTRUCTURE_ASSESSMENT.md) | Evaluación de infraestructura necesaria |
| [SUPPLY_CHAIN_ASSESSMENT.md](SUPPLY_CHAIN_ASSESSMENT.md) | Auditoría de dependencias npm |
| [PRODUCTION_CONFIGURATION_MATRIX.md](PRODUCTION_CONFIGURATION_MATRIX.md) | Variables por entorno |

## White-label

| Documento | Descripción |
|-----------|-------------|
| [WHITE_LABEL_ARCHITECTURE.md](WHITE_LABEL_ARCHITECTURE.md) | Evaluación de arquitectura white-label |
