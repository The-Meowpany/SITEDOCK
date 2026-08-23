# Testing Strategy

> Principio: medir riesgo cubierto, defect detection y regresión protegida.
> No medir calidad por cantidad de tests.

## Pirámide actual

```
         /  E2E  \           ← scripts/e2e-demo.mjs (requiere stack local)
        / Contract \          ← api-contract.smoke.test.ts (HTTP real, sin BD)
       / Adversarial \        ← multitenant-security, branding-security
      / Integration  \       ← checkout+webhook flow con fakes en memoria
     /   Unit tests   \      ← 250+ tests de dominio con fakes (sin BD, <5s)
```

## Qué se prueba y por qué

| Nivel | Alcance | Justificación |
|-------|---------|---------------|
| **Unit (dominio)** | Invariantes de aggregates, state machines, VOs, pure math | Detecta bugs de lógica sin infraestructura. Corre en <10s. |
| **Integration** | Flujos multi-aggregate con fakes (checkout→webhook→subscription) | Verifica orquestación entre contexts. |
| **Contract (HTTP)** | Middleware, auth gates, error handling, CORS, rate limits | Verifica que la capa interfaces funciona correctamente. |
| **Adversarial** | XSS, IDOR, prototype pollution, path traversal, failure injection | Regresión para vulnerabilidades históricas H1-H5+. |
| **E2E** | Flujo completo §51 contra stack local | Confianza de integración real. Requiere Postgres. |

## Cuándo agregar un test

Solo cuando exista:
- Una nueva frontera de autorización
- Un nuevo flujo económico
- Una vulnerabilidad corregida (regresión)
- Una integración nueva entre contexts
- Un bug encontrado que los tests existentes no detectaron

## Cuándo NO agregar un test

- Para alcanzar un número
- Porque "faltaba cobertura" en un archivo
- Para probar getters/setters triviales
- Para verificar mocks en lugar de comportamiento
- Porque el linter sugiere cobertura

## Convenciones

- Fakes en memoria implementan los mismos ports que Prisma
- Cada fake verifica las mismas invariantes que su contraparte Prisma
- Tests de dominio no tocan base de datos ni red
- Tests de contrato HTTP usan `createApp()` real sobre puerto efímero
- Tests de seguridad atacan desde fuera hacia dentro (unauthenticated → authenticated → authorized)
