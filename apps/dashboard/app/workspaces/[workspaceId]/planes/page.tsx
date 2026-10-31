"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import type { PlanDetail, PlanKind } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import { Field, btnDanger, btnGhost, btnPrimary, inputClass, selectClass } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n";
import styles from "./page.module.css";

const KIND_LABEL_KEY: Record<PlanKind, MessageKey> = {
  HOSTING: "money.hosting",
  MAINTENANCE: "plans.kind.MAINTENANCE",
};

type Draft = {
  name: { HOSTING: string; MAINTENANCE: string };
  price: { HOSTING: string; MAINTENANCE: string };
  interval: { HOSTING: "MONTHLY" | "YEARLY"; MAINTENANCE: "MONTHLY" | "YEARLY" };
  quota: string; // MAINTENANCE only; "" = unlimited
};

export default function PlansPage() {
  const params = useParams<{ workspaceId: string }>();
  const router = useRouter();
  const { t } = useI18n();
  const tRef = useRef(t);
  tRef.current = t;
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
        setError(err instanceof Error ? err.message : tRef.current("plans.loadError"));
      });
  }, [workspaceId, router]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(kind: PlanKind) {
    setError(null);
    const name = draft.name[kind].trim();
    const price = draft.price[kind].trim();

    if (name.length < 2) return setError(t("plans.nameShort"));
    if (!/^\d+(\.\d{1,2})?$/.test(price)) return setError(t("plans.priceInvalid"));
    if (kind === "MAINTENANCE" && draft.quota !== "" && (!/^\d+$/.test(draft.quota))) {
      return setError(t("plans.quotaInvalid"));
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
      setError(err instanceof Error ? err.message : t("plans.createError"));
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
      setError(err instanceof Error ? err.message : t("plans.saveError"));
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
      setError(err instanceof Error ? err.message : t("plans.toggleError"));
    } finally {
      setBusy(null);
    }
  }

  function section(kind: PlanKind) {
    const list = plans?.filter((p) => p.kind === kind) ?? [];
    return (
      <section className={styles.panel} aria-label={t(KIND_LABEL_KEY[kind])}>
        <h2 className={styles.panelTitle}>{t(KIND_LABEL_KEY[kind])}</h2>

        <form
          className={styles.createForm}
          onSubmit={(e) => {
            e.preventDefault();
            handleCreate(kind);
          }}
        >
          <Field label={t("plans.name")}>
            <input
              className={inputClass}
              placeholder={kind === "MAINTENANCE" ? t("plans.namePlaceholderMaintenance") : t("plans.namePlaceholderHosting")}
              value={draft.name[kind]}
              onChange={(e) => setDraft((d) => ({ ...d, name: { ...d.name, [kind]: e.target.value } }))}
            />
          </Field>
          <Field label={t("plans.price")}>
            <input
              className={inputClass}
              placeholder="29.00"
              inputMode="decimal"
              value={draft.price[kind]}
              onChange={(e) => setDraft((d) => ({ ...d, price: { ...d.price, [kind]: e.target.value } }))}
            />
          </Field>
          <Field label={t("plans.interval")}>
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
              <option value="MONTHLY">{t("plans.monthly")}</option>
              <option value="YEARLY">{t("plans.yearly")}</option>
            </select>
          </Field>
          {kind === "MAINTENANCE" && (
            <Field label={t("plans.quotaLabel")}>
              <input
                className={inputClass}
                placeholder={t("plans.quotaPlaceholder")}
                inputMode="numeric"
                value={draft.quota}
                onChange={(e) => setDraft((d) => ({ ...d, quota: e.target.value }))}
              />
            </Field>
          )}
          <button className={btnPrimary} type="submit" disabled={busy === `create-${kind}`}>
            {busy === `create-${kind}` ? t("sites.creating") : t("plans.create")}
          </button>
        </form>

        <ul className={styles.planList}>
          {list.length === 0 && <li className={styles.empty}>{t("plans.empty")}</li>}
          {list.map((plan) => (
            <li key={plan.id} className={`${styles.planRow} ${plan.active ? "" : styles.inactive}`}>
              {editingId === plan.id ? (
                <div className={styles.editGrid}>
                  <input className={inputClass} value={editName} onChange={(e) => setEditName(e.target.value)} aria-label={t("plans.name")} />
                  <input className={inputClass} value={editPrice} onChange={(e) => setEditPrice(e.target.value)} aria-label={t("plans.priceAria")} />
                  {plan.kind === "MAINTENANCE" && (
                    <input
                      className={inputClass}
                      value={editQuota}
                      placeholder={t("plans.quotaPlaceholder")}
                      onChange={(e) => setEditQuota(e.target.value)}
                      aria-label={t("plans.quotaAria")}
                    />
                  )}
                  <div className={styles.rowActions}>
                    <button className={btnGhost} onClick={() => setEditingId(null)}>{t("charge.cancel")}</button>
                    <button className={btnPrimary} disabled={busy === `save-${plan.id}`} onClick={() => saveEdit(plan)}>
                      {busy === `save-${plan.id}` ? "…" : t("plans.save")}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className={styles.planInfo}>
                    <strong>{plan.name}</strong>
                    <span className={styles.mono}>
                      ${plan.priceDecimal} {plan.currency}/{plan.billingInterval === "MONTHLY" ? t("sub.perMonth") : t("sub.perYear")}
                      {plan.kind === "MAINTENANCE" &&
                        ` · ${plan.includedRequestQuota === null ? t("plans.unlimitedChanges") : t("sub.changesPerMonth", { count: plan.includedRequestQuota })}`}
                    </span>
                  </div>
                  <div className={styles.rowActions}>
                    {!plan.active && <span className={styles.inactiveTag}>{t("plans.inactive")}</span>}
                    <button className={btnGhost} onClick={() => startEdit(plan)} disabled={!!editingId}>
                      {t("plans.edit")}
                    </button>
                    <button className={btnDanger} disabled={!!editingId || busy === `toggle-${plan.id}`} onClick={() => toggleActive(plan)}>
                      {busy === `toggle-${plan.id}` ? "…" : plan.active ? t("plans.deactivate") : t("plans.reactivate")}
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
          <p className={styles.eyebrow}>{t("plans.eyebrow")}</p>
          <h1 className={styles.title}>{t("nav.plans")}</h1>
        </div>
        <span className={styles.dim}>
          {t("plans.note")}
        </span>
      </header>

      {error && <p className={styles.error}>{error}</p>}

      {section("HOSTING")}
      {section("MAINTENANCE")}
    </>
  );
}
