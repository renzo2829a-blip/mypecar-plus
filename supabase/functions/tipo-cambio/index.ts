// Edge Function "tipo-cambio" (2026-11-24) — Tipo de cambio publicado por SUNAT (USD → PEN) para una fecha.
// - Exige sesión iniciada (verify_jwt + getUser).
// - Guarda cada fecha en la tabla public.tipo_cambio_sunat: cada fecha se consulta a la fuente UNA sola vez para todos.
// - Fuentes: Decolecta (con DECOLECTA_TOKEN) y, para el día de hoy, el archivo público de SUNAT como respaldo.
// - Si ese día no hubo publicación (feriado / fin de semana), usa el último día anterior publicado (hasta 4 días atrás).
// Respuesta: { fecha, compra, venta, fecha_publicada, fuente }  ·  Error: { error } con 4xx/5xx.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.2";

const ORIGEN_PERMITIDO = Deno.env.get("ALLOWED_ORIGIN") ?? "https://mypecar.net.pe";
function cors(req: Request) {
  const origen = req.headers.get("Origin") ?? "";
  const ok = origen === ORIGEN_PERMITIDO || origen.startsWith("http://localhost");
  return {
    "Access-Control-Allow-Origin": ok ? origen : ORIGEN_PERMITIDO,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}
const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });

const usos = new Map<string, number[]>();
function dentroDelLimite(uid: string): boolean {
  const ahora = Date.now();
  const lista = (usos.get(uid) ?? []).filter((t) => ahora - t < 60_000);
  if (lista.length >= 60) { usos.set(uid, lista); return false; }
  lista.push(ahora); usos.set(uid, lista);
  return true;
}

const hoyLima = () => new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10);
function restarDia(f: string): string { const d = new Date(f + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); }
function num(v: unknown): number | null { const n = typeof v === "string" ? parseFloat(v.replace(",", ".")) : typeof v === "number" ? v : NaN; return isFinite(n) && n > 1 && n < 10 ? Math.round(n * 10000) / 10000 : null; }

function extraer(j: any): { compra: number; venta: number } | null {
  if (!j || typeof j !== "object") return null;
  const o = Array.isArray(j) ? j[0] : (j.data && typeof j.data === "object" ? (Array.isArray(j.data) ? j.data[0] : j.data) : j);
  if (!o) return null;
  const compra = num(o.buy_price ?? o.compra ?? o.precioCompra ?? o.purchase ?? o.buy);
  const venta = num(o.sell_price ?? o.venta ?? o.precioVenta ?? o.sale ?? o.sell);
  return compra && venta ? { compra, venta } : null;
}

async function consultar(fecha: string): Promise<{ compra: number; venta: number; fuente: string } | null> {
  const token = Deno.env.get("DECOLECTA_TOKEN");
  if (token) {
    for (const url of [
      `https://api.decolecta.com/v1/tipo-cambio/sunat?date=${fecha}`,
      `https://api.decolecta.com/v1/sunat/tipo-cambio?date=${fecha}`,
    ]) {
      try {
        const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!r.ok) { console.log("tipo-cambio: decolecta", r.status, url.split("?")[0]); continue; }
        const x = extraer(await r.json());
        if (x) return { ...x, fuente: "decolecta" };
        console.log("tipo-cambio: decolecta sin compra/venta en la respuesta");
      } catch (e) { console.log("tipo-cambio: decolecta error", String(e).slice(0, 120)); }
    }
  }
  if (fecha === hoyLima()) {
    try {
      const r = await fetch("https://www.sunat.gob.pe/a/txt/tipoCambio.txt");
      if (r.ok) {
        const t = (await r.text()).trim(); // "dd/mm/aaaa|compra|venta|"
        const p = t.split("|");
        const [dd, mm, aa] = (p[0] || "").split("/");
        const compra = num(p[1]), venta = num(p[2]);
        if (compra && venta && `${aa}-${mm}-${dd}` === fecha) return { compra, venta, fuente: "sunat" };
        console.log("tipo-cambio: archivo SUNAT con otra fecha o formato:", t.slice(0, 40));
      } else console.log("tipo-cambio: archivo SUNAT", r.status);
    } catch (e) { console.log("tipo-cambio: archivo SUNAT error", String(e).slice(0, 120)); }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "Método no permitido" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json(req, { error: "Inicia sesión." }, 401);
  const url = Deno.env.get("SUPABASE_URL")!;
  const usuario = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: u, error: errU } = await usuario.auth.getUser();
  if (errU || !u?.user) return json(req, { error: "Tu sesión no es válida." }, 401);
  if (!dentroDelLimite(u.user.id)) return json(req, { error: "Demasiadas consultas seguidas. Espera un minuto." }, 429);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(req, { error: "Solicitud inválida" }, 400); }
  const fecha = String(body.fecha ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || isNaN(Date.parse(fecha + "T12:00:00Z"))) return json(req, { error: "Fecha inválida." }, 400);
  if (fecha < "2000-01-01" || fecha > hoyLima()) return json(req, { error: "La fecha debe ser de hoy o anterior." }, 400);

  const svc = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: c } = await svc.from("tipo_cambio_sunat").select("fecha, compra, venta, fecha_publicada, fuente").eq("fecha", fecha).maybeSingle();
  if (c) return json(req, c);

  let d = fecha;
  for (let i = 0; i <= 4; i++) {
    const r = await consultar(d);
    if (r) {
      const fila = { fecha, compra: r.compra, venta: r.venta, fecha_publicada: d, fuente: r.fuente };
      const { error } = await svc.from("tipo_cambio_sunat").upsert(fila, { onConflict: "fecha" });
      if (error) console.log("tipo-cambio: no se guardó en caché:", error.message);
      console.log("tipo-cambio: ok", fecha, "publicada", d, r.fuente);
      return json(req, fila);
    }
    d = restarDia(d);
  }
  console.log("tipo-cambio: sin dato para", fecha);
  return json(req, { error: "No se encontró el tipo de cambio de SUNAT para esa fecha." }, 404);
});
