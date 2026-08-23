"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import type { PlanDetail, PlanKind } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import { Field, btnDanger, btnGhost, btnPrimary, inputClass, selectClass } from "@/components/ui";
import styles from "./page.module.css";

const KIND_LABEL: Record<PlanKind, string> = {
  HOSTING: "Hosting + infraestructura",
  MAINTENANCE: "Tiers de mantenimiento",
};

type Draft = {
  name: { HOSTING: string; MAINTENANCE: string };
  price: { HOSTING: string; MAINTENANCE: string };
  interval: { HOSTING: "MONTHLY" | "YEARLY"; MAINTENANCE: "MONTHLY" | "YEARLY" };
  quota: string; // solo MAINTENANCE; "" = ilimitado
};

export default function PlansPage() {
  const params = useParams<{ workspaceId: string }>();
  const router = useRouter();
  const workspaceId = params.workspaceId;

  const [plans, setPlans] = useState<PlanDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [draft, setDraft] = useState<Draft>({
    name: { HOSTING: "", MAINTENANCE: "" },
    price: { HOSTING: "", MAINTENANCE: "" },
    interval: { HOSTING: "MONTHLY", MAINTENANCE: "MONTHLY" },
    quota: "",
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editQuota, setEditQuota] = useState("");

  const load = useCallback(() => {
    api
      .listPlans(workspaceId)
      .then(setPlans)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          router.replace(`/login?returnTo=/workspaces/${workspaceId}/planes`);
          return;
        }
        setError(err instanceof Error ? err.message : "No pudimos cargar los planes.");
      });
  }, [workspaceId, router]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(kind: PlanKind) {
    setError(null);
    const name = draft.name[kind].trim();
    const price = draft.price[kind].trim();

    if (name.length < 2) return setError("El nombre necesita al menos 2 caracteres.");
    if (!/^\d+(\.\d{1,2})?$/.test(price)) return setError("El precio debe ser un monto válido (ej: 29.00).");
    if (kind === "MAINTENANCE" && draft.quota !== "" && (!/^\d+$/.test(draft.quota))) {
      return setError("La cuota debe ser un número entero o vacío para ilimitado.");
    }

    setBusy(`create-${kind}`);
    try {
      await api.createPlan(workspaceId, {
        name,
        kind,
        priceDecimal: price,
        currency: "USD",
        billingInterval: draft.interval[kind],
        includedRequestQuota:
          kind === "MAINTENANCE" ? (draft.quota === "" ? null : Number(draft.quota)) : undefined,
      });
      setDraft((d) => ({ ...d, name: { ...d.name, [kind]: "" }, price: { ...d.price, [kind]: "" }, quota: "" }));
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos crear el plan.");
    } finally {
      setBusy(null);
    }
  }

  function startEdit(plan: PlanDetail) {
    setEditingId(plan.id);
    setEditName(plan.name);
    setEditPrice(plan.priceDecimal);
    setEditQuota(plan.includedRequestQuota === null ? "" : String(plan.includedRequestQuota));
  }

  async function saveEdit(plan: PlanDetail) {
    setError(null);
    setBusy(`save-${plan.id}`);
    try {
      await api.updatePlan(workspaceId, plan.id, {
        name: editName.trim(),
        priceDecimal: editPrice.trim(),
        includedRequestQuota:
          plan.kind === "MAINTENANCE"
            ? editQuota.trim() === ""
              ? null
              : Number(editQuota)
            : undefined,
      });
      setEditingId(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos guardar los cambios.");
    } finally {
      setBusy(null);
    }
  }

  async function toggleActive(plan: PlanDetail) {
    setBusy(`toggle-${plan.id}`);
    try {
      await api.updatePlan(workspaceId, plan.id, { active: !plan.active });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos cambiar el estado.");
    } finally {
      setBusy(null);
    }
  }

  function section(kind: PlanKind) {
    const list = plans?.filter((p) => p.kind === kind) ?? [];
    return (
      <section className={styles.panel} aria-label={KIND_LABEL[kind]}>
        <h2 className={styles.panelTitle}>{KIND_LABEL[kind]}</h2>

        <form
          className={styles.createForm}
          onSubmit={(e) => {
            e.preventDefault();
            handleCreate(kind);
          }}
        >
          <Field label="Nombre">
            <input
              className={inputClass}
              placeholder={kind === "MAINTENANCE" ? "Ej: Pro — 6 cambios/mes" : "Ej: Hosting estándar"}
              value={draft.name[kind]}
              onChange={(e) => setDraft((d) => ({ ...d, name: { ...d.name, [kind]: e.target.value } }))}
            />
          </Field>
          <Field label="Precio (USD)">
            <input
              className={inputClass}
              placeholder="29.00"
              inputMode="decimal"
              value={draft.price[kind]}
              onChange={(e) => setDraft((d) => ({ ...d, price: { ...d.price, [kind]: e.target.value } }))}
            />
          </Field>
          <Field label="Período">
            <select
              className={selectClass}
              value={draft.interval[kind]}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  interval: { ...d.interval, [kind]: e.target.value as "MONTHLY" | "YEARLY" },
                }))
              }
            >
              <option value="MONTHLY">Mensual</option>
              <option value="YEARLY">Anual</option>
            </select>
          </Field>
          {kind === "MAINTENANCE" && (
            <Field label="Cambios incluidos/mes">
              <input
                className={inputClass}
                placeholder="vacío = ilimitado"
                inputMode="numeric"
                value={draft.quota}
                onChange={(e) => setDraft((d) => ({ ...d, quota: e.target.value }))}
              />
            </Field>
          )}
          <button className={btnPrimary} type="submit" disabled={busy === `create-${kind}`}>
            {busy === `create-${kind}` ? "Creando…" : "Crear"}
          </button>
        </form>

        <ul className={styles.planList}>
          {list.length === 0 && <li className={styles.empty}>Todavía no creaste planes de este tipo.</li>}
          {list.map((plan) => (
            <li key={plan.id} className={`${styles.planRow} ${plan.active ? "" : styles.inactive}`}>
              {editingId === plan.id ? (
                <div className={styles.editGrid}>
                  <input className={inputClass} value={editName} onChange={(e) => setEditName(e.target.value)} aria-label="Nombre" />
                  <input className={inputClass} value={editPrice} onChange={(e) => setEditPrice(e.target.value)} aria-label="Precio" />
                  {plan.kind === "MAINTENANCE" && (
                    <input
                      className={inputClass}
                      value={editQuota}
                      placeholder="vacío = ilimitado"
                      onChange={(e) => setEditQuota(e.target.value)}
                      aria-label="Cuota mensual"
                    />
                  )}
                  <div className={styles.rowActions}>
                    <button className={btnGhost} onClick={() => setEditingId(null)}>Cancelar</button>
                    <button className={btnPrimary} disabled={busy === `save-${plan.id}`} onClick={() => saveEdit(plan)}>
                      {busy === `save-${plan.id}` ? "…" : "Guardar"}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className={styles.planInfo}>
                    <strong>{plan.name}</strong>
                    <span className={styles.mono}>
                      ${plan.priceDecimal} {plan.currency}/{plan.billingInterval === "MONTHLY" ? "mes" : "año"}
                      {plan.kind === "MAINTENANCE" &&
                        (plan.includedRequestQuota === null ? " · cambios ilimitados" : ` · ${plan.includedRequestQuota} cambios/mes`)}
                    </span>
                  </div>
                  <div className={styles.rowActions}>
                    {!plan.active && <span className={styles.inactiveTag}>inactivo</span>}
                    <button className={btnGhost} onClick={() => startEdit(plan)} disabled={!!editingId}>
                      Editar
                    </button>
                    <button className={btnDanger} disabled={!!editingId || busy === `toggle-${plan.id}`} onClick={() => toggleActive(plan)}>
                      {busy === `toggle-${plan.id}` ? "…" : plan.active ? "Desactivar" : "Reactivar"}
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Catálogo comercial</p>
          <h1 className={styles.title}>Planes y tiers</h1>
        </div>
        <span className={styles.dim}>
          Todo es tuyo: nombres, precios y cuotas son definidos por vos. Editar el precio no afecta suscripciones ya activas.
        </span>
      </header>

      {error && <p className={styles.error}>{error}</p>}

      {section("HOSTING")}
      {section("MAINTENANCE")}
    </>
  );
}
