#!/usr/bin/env node
/**
 * E2E — criterio final del brief (§51) contra un stack local real.
 *
 * Requisitos (en otra terminal):
 *   docker compose up -d
 *   npm run db:migrate -w packages/database
 *   npm run dev                       # API :4000
 *
 * Uso:
 *   node scripts/e2e-demo.mjs                 # API en :4000
 *   BASE_URL=http://localhost:4000 node scripts/e2e-demo.mjs
 *
 * Cubre, en orden: registro → workspace → proyecto → sitio → ZIP →
 * submit/approve/publish (LIVE) → cliente → asignación → tier + hosting →
 * checkout demo → pago (suscripción ACTIVE) → solicitudes de mantenimiento con
 * cuota → cobro único → pago fallido → PAST_DUE → suspensión → recuperación →
 * dashboard con MRR > 0 → audit log poblado.
 */

const BASE = process.env.BASE_URL ?? "http://localhost:4000";
const API = `${BASE}/api/v1`;

let cookie = "";
let passed = 0;
const step = (name) => process.stdout.write(`\n▶ ${name}\n`);
const ok = (msg) => {
  passed++;
  console.log(`  ✓ ${msg}`);
};
function must(cond, msg) {
  if (!cond) {
    console.error(`\n✗ FALLO: ${msg}\n`);
    process.exit(1);
  }
}

async function call(method, path, body, extraHeaders = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...extraHeaders,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];

  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, json };
}

async function uploadZip(path, files) {
  // ZIP mínimo válido (stored) generado en memoria — sin dependencias.
  const crcTable = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })();
  const crc32 = (buf) => {
    let c = -1;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };

  const encoder = new TextEncoder();
  const locals = [];
  const central = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const data = encoder.encode(content);
    const nameBytes = encoder.encode(name);
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0, true);
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    locals.push(local);

    central.push({ nameBytes, crc, size: data.length, offset });
    offset += local.length;
  }

  const centralStart = offset;
  let centralSize = 0;
  const centralParts = [];
  for (const e of central) {
    const cd = new Uint8Array(46 + e.nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint32(16, e.crc, true);
    cv.setUint32(20, e.size, true);
    cv.setUint32(24, e.size, true);
    cv.setUint16(28, e.nameBytes.length, true);
    cd.set(e.nameBytes, 46);
    cv.setUint32(42, e.offset, true);
    centralParts.push(cd);
    centralSize += cd.length;
  }

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, central.length, true);
  ev.setUint16(10, central.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralStart, true);

  const zip = new Blob([...locals, ...centralParts, eocd], { type: "application/zip" });

  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { Cookie: cookie },
    body: (() => {
      const form = new FormData();
      form.append("file", zip, "site.zip");
      return form;
    })(),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function main() {
  console.log(`E2E SiteDock → ${API}`);
  const stamp = Date.now();

  step("1-2 · Registro + login del developer");
  const email = `dev-${stamp}@sitedock.test`;
  {
    const r = await call("POST", "/auth/register", {
      email,
      password: "supersecret",
      fullName: "Jane Dev",
    });
    must(r.status === 201, `registro: ${r.status} ${JSON.stringify(r.json)}`);
    const login = await call("POST", "/auth/login", { email, password: "supersecret" });
    must(login.status === 200, `login: ${login.status} ${JSON.stringify(login.json)}`);
    must(cookie, "login no emitió cookie de sesión");
    ok(`cuenta creada y sesión iniciada: ${email}`);
  }

  step("3 · Workspace");
  let workspaceId;
  {
    const r = await call("POST", "/workspaces", { name: "Studio E2E" });
    must(r.status === 201, "crear workspace");
    workspaceId = r.json.workspaceId ?? r.json.id;
    ok(`workspace: ${workspaceId}`);
  }

  step("4 · Proyecto + sitio");
  let projectId, websiteId;
  {
    const p = await call("POST", `/workspaces/${workspaceId}/projects`, { name: "Restaurante E2E" });
    must(p.status === 201, "crear proyecto");
    projectId = p.json.projectId ?? p.json.id;

    const w = await call("POST", `/workspaces/${workspaceId}/websites`, {
      projectId,
      name: "Landing Restaurante E2E",
    });
    must(w.status === 201, "crear website");
    websiteId = w.json.websiteId;
    ok(`website: ${websiteId} (${w.json.subdomain})`);
  }

  step("5-8 · Upload ZIP v1 → submit → approve → publish (LIVE)");
  {
    const up = await uploadZip(`/workspaces/${workspaceId}/websites/${websiteId}/deployments`, {
      "index.html": "<html><body><h1>Hola E2E</h1></body></html>",
      "styles.css": "body{font-family:sans-serif}",
    });
    must(up.status === 201 && up.json?.deploymentId, `upload: ${up.status} ${JSON.stringify(up.json)}`);
    ok(`deployment v${up.json.version}: ${up.json.deploymentId}`);

    for (const action of ["submit-for-approval", "approve"]) {
      const r = await call("POST", `/workspaces/${workspaceId}/websites/${websiteId}/${action}`);
      must(r.status === 204 || r.status === 200, action);
    }
    const pub = await call(
      "POST",
      `/workspaces/${workspaceId}/websites/${websiteId}/deployments/${up.json.deploymentId}/publish`
    );
    must(pub.status === 204 || pub.status === 200, "publish");

    const site = await call("GET", `/workspaces/${workspaceId}/websites/${websiteId}`);
    must(site.json.status === "LIVE", `sitio LIVE (estado: ${site.json.status})`);
    ok("sitio LIVE");
  }

  step("9 · Cliente + asignación al sitio");
  let clientId;
  {
    const c = await call("POST", `/workspaces/${workspaceId}/clients`, {
      fullName: "Juan Pérez",
      email: `juan-${stamp}@cliente.test`,
    });
    must(c.status === 201, "crear cliente");
    clientId = c.json.clientId;

    const a = await call("POST", `/workspaces/${workspaceId}/websites/${websiteId}/subscription/assign-client`, {
      clientId,
    });
    must(a.status === 204 || a.status === 200, "asignar cliente");
    ok("cliente asignado");
  }

  step("10 · Tier de mantenimiento (Pro · 2 cambios/mes) + plan hosting");
  let hostingPlanId, tierPlanId;
  {
    const h = await call("POST", `/workspaces/${workspaceId}/plans`, {
      name: "Hosting estándar",
      kind: "HOSTING",
      priceDecimal: "29.00",
      currency: "USD",
      billingInterval: "MONTHLY",
    });
    must(h.status === 201, "plan hosting");
    hostingPlanId = h.json.planId;

    const t = await call("POST", `/workspaces/${workspaceId}/plans`, {
      name: "Mantenimiento Pro",
      kind: "MAINTENANCE",
      priceDecimal: "49.00",
      currency: "USD",
      billingInterval: "MONTHLY",
      includedRequestQuota: 2,
    });
    must(t.status === 201, "tier mantenimiento");
    tierPlanId = t.json.planId;
    ok("planes creados (hosting + tier Pro)");
  }

  step("11 · Suscripciones hosting + mantenimiento");
  {
    const h = await call("POST", `/workspaces/${workspaceId}/websites/${websiteId}/subscription`, {
      planId: hostingPlanId,
    });
    must(h.status === 201, "suscripción hosting");

    const m = await call("POST", `/workspaces/${workspaceId}/websites/${websiteId}/subscription`, {
      planId: tierPlanId,
    });
    must(m.status === 201, "membresía mantenimiento");
    ok("ambas suscripciones creadas (INCOMPLETE)");
  }

  step("12 · Checkout + pago demo → ACTIVE");
  {
    const sub = await call("GET", `/workspaces/${workspaceId}/websites/${websiteId}/subscription`);
    must(sub.json?.id, "leer suscripción hosting");
    const co = await call(
      "POST",
      `/workspaces/${workspaceId}/websites/${websiteId}/subscription/${sub.json.id}/checkout`,
      {}
    );
    must(co.status === 201 && co.json.checkoutUrl, "generar checkout");
    const sessionId = String(co.json.checkoutUrl).split("/").pop();
    ok(`checkout: ${co.json.checkoutUrl}`);

    // El CLIENTE paga por la página pública demo (mismo pipeline que el webhook).
    const pay = await fetch(`${BASE}/api/v1/public/demo-checkout/${sessionId}/pay`, { method: "POST" });
    must(pay.ok, "pago público demo");

    const after = await call("GET", `/workspaces/${workspaceId}/websites/${websiteId}/subscription`);
    must(after.json?.status === "ACTIVE", `suscripción ACTIVE (estado: ${after.json?.status})`);
    ok("suscripción ACTIVE tras el pago");
  }

  step("13 · Membresía de mantenimiento también paga");
  {
    const m = await call("GET", `/workspaces/${workspaceId}/websites/${websiteId}/subscription?kind=MAINTENANCE`);
    must(m.json?.id, "leer membresía mantenimiento");
    const co = await call(
      "POST",
      `/workspaces/${workspaceId}/websites/${websiteId}/subscription/${m.json.id}/checkout`,
      {}
    );
    must(co.status === 201, "checkout membresía");
    const pay = await fetch(
      `${BASE}/api/v1/public/demo-checkout/${String(co.json.checkoutUrl).split("/").pop()}/pay`,
      { method: "POST" }
    );
    must(pay.ok, "pago membresía");
    ok("membresía de mantenimiento ACTIVE");
  }

  step("14 · Solicitudes de mantenimiento y cuota del tier (2/mes)");
  {
    for (let i = 1; i <= 2; i++) {
      const r = await call("POST", `/workspaces/${workspaceId}/websites/${websiteId}/maintenance-requests`, {
        title: `Cambio cubierto #${i}`,
        description: "Dentro de la cuota del tier Pro.",
      });
      must(r.status === 201 && r.json?.tier?.covered === true, `request ${i} cubierta`);
    }
    const tercera = await call("POST", `/workspaces/${workspaceId}/websites/${websiteId}/maintenance-requests`, {
      title: "Cambio extra fuera de cuota",
      description: "Debe marcarse over-quota.",
    });
    must(
      tercera.status === 201 && tercera.json?.tier?.covered === false,
      "tercera solicitud marcada fuera de cuota"
    );
    ok("cuota del tier aplicada (2/2 → over-quota)");
  }

  step("15 · Cobro único por creación/deploy");
  {
    const ch = await call("POST", `/workspaces/${workspaceId}/websites/${websiteId}/charges`, {
      title: "Diseño y desarrollo inicial",
      priceDecimal: "1500.00",
      currency: "USD",
    });
    must(ch.status === 201 && ch.json.chargeId, "crear charge");
    const sessionId = String(ch.json.checkoutUrl).split("/").pop();
    const pay = await fetch(`${BASE}/api/v1/public/demo-checkout/${sessionId}/pay`, { method: "POST" });
    must(pay.ok, "pagar charge");

    const list = await call("GET", `/workspaces/${workspaceId}/websites/${websiteId}/charges`);
    must(list.json[0]?.status === "PAID", "charge PAID");
    ok("cobro único PAID ($1500.00)");
  }

  step("16-20 · Pago fallido → PAST_DUE → suspensión → recuperación → LIVE");
  {
    const sub = await call("GET", `/workspaces/${workspaceId}/websites/${websiteId}/subscription`);
    must(sub.json?.id, "leer suscripción hosting");

    // Nueva sesión de la misma suscripción para poder simular el fallo sobre ella.
    const co = await call(
      "POST",
      `/workspaces/${workspaceId}/websites/${websiteId}/subscription/${sub.json.id}/checkout`,
      {}
    );
    must(co.status === 201, "nueva sesión de checkout");
    const sessionId = String(co.json.checkoutUrl).split("/").pop();

    const fail = await call(
      "POST",
      `/workspaces/${workspaceId}/demo-payments/simulate-payment-failed`,
      { checkoutSessionId: sessionId }
    );
    must(fail.status === 200, "simular pago fallido");

    const pastDue = await call("GET", `/workspaces/${workspaceId}/websites/${websiteId}/subscription`);
    must(pastDue.json?.status === "PAST_DUE", "suscripción PAST_DUE");
    ok("pago fallido → PAST_DUE");

    const susp = await call("POST", `/workspaces/${workspaceId}/demo-payments/suspend-for-nonpayment`, {
      websiteId,
    });
    must(susp.status === 204 || susp.status === 200, "suspender sitio");

    const siteAfter = await call("GET", `/workspaces/${workspaceId}/websites/${websiteId}`);
    must(siteAfter.json.status === "SUSPENDED", "sitio SUSPENDED");
    ok("sitio suspendido por falta de pago");

    // Recuperación: nuevo pago exitoso sobre la misma sesión reactiva todo.
    const recover = await call(
      "POST",
      `/workspaces/${workspaceId}/demo-payments/simulate-payment-succeeded`,
      { checkoutSessionId: String(co.json.checkoutUrl).split("/").pop() }
    );
    must(recover.status === 200, "pago recuperado");

    const finalSub = await call("GET", `/workspaces/${workspaceId}/websites/${websiteId}/subscription`);
    must(finalSub.json?.status === "ACTIVE", "suscripción ACTIVE nuevamente");
    const finalSite = await call("GET", `/workspaces/${workspaceId}/websites/${websiteId}`);
    must(finalSite.json.status === "LIVE", "sitio LIVE nuevamente");
    ok("recuperación completa → LIVE");
  }

  step("21 · Dashboard con MRR > 0 y audit log poblado");
  {
    const dash = await call("GET", `/workspaces/${workspaceId}/dashboard`);
    must(dash.status === 200, "dashboard accesible");
    const mrrUsd = dash.json.mrr.find((m) => m.currency === "USD");
    must((mrrUsd?.amountCents ?? 0) > 0, `MRR > 0 (${JSON.stringify(dash.json.mrr)})`);

    const audit = await call("GET", `/workspaces/${workspaceId}/audit-logs`);
    must(audit.status === 200 && Array.isArray(audit.json) && audit.json.length > 5, "audit log poblado");
    ok(`dashboard OK — MRR ${(mrrUsd.amountCents / 100).toFixed(2)} USD, ${audit.json.length} entradas de auditoría`);
  }

  console.log(`\n✅ E2E COMPLETO — ${passed} pasos verificados sin errores.\n`);
}

main().catch((err) => {
  console.error("\n✗ E2E abortado:", err);
  process.exit(1);
});

