# Supply Chain Assessment

> Fase 23 §9 — análisis individual de cada vulnerabilidad reportada por `npm audit`.
> Fecha de análisis: Fase 23. Lockfile: package-lock.json (npm 11).

## Resumen

8 vulnerabilidades reportadas. **0 afectan el runtime de producción de la API.**
Todas están en la cadena de build/desarrollo (vitest/vite/esbuild) o en
dependencias internas de Next.js (postcss/sharp).

## Análisis individual

### 1-3. esbuild ≤0.24.2 / vite ≤6.4.2 / vite-node (MODERATE ×3)

| Campo | Valor |
|-------|-------|
| Advisory | GHSA-67mh-4wv8-2f99 |
| Alcance | Development server — permite que un sitio web envíe requests al dev server |
| Runtime? | ❌ Solo `npm run dev` — nunca en producción |
| Dependencia | Transitiva: vitest → vite → esbuild |
| Versión corregida | vitest@4.x (major upgrade, breaking para todos los 14 workspaces) |
| Explotabilidad | Baja — requiere que el desarrollador navegue un sitio malicioso mientras corre el dev server |
| Mitigación | No ejecutar `npm run dev` mientras se navega sitios no confiables |
| Decisión | **ACEPTADO** — riesgo de desarrollo, no de producción |

### 4-7. postcss ≤8.5.22 (HIGH ×4)

| Campo | Valor |
|-------|-------|
| Advisories | GHSA-qx2v-qp2m-jg93, GHSA-6g55-p6wh-862q, GHSA-fxqj-rqcc-2cmp, GHSA-r28c-9q8g-f849 |
| Alcance | Build-time CSS processing en Next.js |
| Runtime? | ❌ Solo durante `next build` |
| Ataque | Requiere que el atacante controle el CSS de entrada — nuestro CSS es developer-written |
| Versión corregida | next@16.x (major upgrade desde v15) |
| Explotabilidad | MUY BAJA — el atacante necesitaría acceso al repositorio para inyectar CSS |
| Mitigación | CSS revisado en code review; sin user-generated CSS |
| Decisión | **ACEPTADO** — build-time only, sin input del usuario |

### 8. sharp <0.35.0 (HIGH/CRITICAL)

| Campo | Valor |
|-------|-------|
| Advisories | CVE-2026-33327, CVE-2026-33328, CVE-2026-35590, CVE-2026-35591 (libvips) |
| Alcance | Image processing en Next.js |
| Runtime? | ⚠️ Potencialmente sí, si se usa `next/image` con imágenes remotas |
| Uso actual | No usamos `next/image` con imágenes de usuario. Solo assets estáticos propios |
| Versión corregida | next@16.x + sharp@0.35+ |
| Explotabilidad | BAJA actualmente — aumentaría si se habilita optimización de imágenes de usuario |
| Mitigación | No usar `next/image` con URLs remotas no confiables |
| Decisión | **ACEPTADO con monitoreo** — revisar si se habilita image optimization |

## Plan de remediación

| Prioridad | Acción | Cuándo |
|-----------|--------|--------|
| 1 | Actualizar Next.js a v16 cuando sea estable (resuelve postcss + sharp) | Próximo sprint planificado |
| 2 | Actualizar vitest a v4 (resuelve esbuild/vite) | Cuando los tests sean estables en v4 |
| 3 | Habilitar `images.unoptimized: true` en next.config si no se usa optimización | Inmediato si hay preocupación |

## Verificación

```
npm audit: 8 vulnerabilidades
Runtime explotables: 0
Build-time aceptados: 8
Dev-only aceptados: 3 (esbuild chain)
Fecha de próxima revisión: Al actualizar Next.js o agregar image optimization
```
