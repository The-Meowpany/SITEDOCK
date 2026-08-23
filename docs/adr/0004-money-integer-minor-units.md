# ADR-004: Money en unidades menores enteras, nunca float

## Status
Accepted

## Context
El producto cobra suscripciones recurrentes y reparte revenue-share. El error clásico de
representar dinero con `number` (float IEEE 754) corrompe totales: `0.1 + 0.2 !== 0.3`.

## Decision
`Money` es un Value Object (`packages/shared/src/value-objects.ts`) que guarda
`amountCents: number` (entero, minor units) + `currency`. Construcción solo vía
`Money.fromCents()` / `Money.fromDecimalString()` (parseo sin float). Toda operación
(`add`, `subtract`, `percentage`) valida igualdad de moneda y devuelve centavos enteros;
el redondeo (p. ej. prorrateo o fee del 10%) ocurre una vez, con `Math.round`, en el
límite donde la regla de negocio lo define (`FlatPercentageFeePolicy`).

## Alternatives considered
- Librería decimal (decimal.js/big.js): innecesaria — centavos enteros cubren todos los
  casos del producto sin dependencia extra.
- Guardar floats y redondear al mostrar: descartado — los errores se acumulan en
  agregaciones (MRR, sumas de pagos) antes de mostrarse.

## Consequences
- La API expone `priceDecimal: "29.00"` como string para humanos; internamente todo es
  entero. El dashboard suma por moneda y jamás mezcla divisas.
- Un cambio futuro a multi-moneda con decimales distintos (JPY, 0 decimales) solo toca
  el Value Object.
