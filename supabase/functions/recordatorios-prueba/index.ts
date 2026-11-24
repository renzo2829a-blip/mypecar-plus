// Edge Function "recordatorios-prueba" (2026-11-24): una vez al día (tarea programada en la base de datos) escribe a cada
// cliente en prueba gratuita cuando le quedan 4 días, 1 día y cuando su prueba terminó. Cada correo se envía UNA sola vez
// (tabla avisos_enviados; se marca solo si el correo salió). Solo la puede llamar la tarea programada: exige la clave guardada en Vault (cabecera x-cron-secret).
// Con { "probar": true } solo devuelve lo que enviaría, sin enviar nada.
import { createClient } from "npm:@supabase/supabase-js@2";

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
const hoyLima = () => new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10);
const diasEntre = (a: string, b: string) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400000);
const fmt = (f: string) => { const [y, m, d] = String(f).split("-"); return `${d}/${m}/${y}`; };

async function enviarCorreo(para: string, asunto: string, texto: string): Promise<{ ok: boolean; detalle: string }> {
  const rk = Deno.env.get("RESEND_API_KEY");
  if (!rk) return { ok: false, detalle: "sin RESEND_API_KEY" };
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${rk}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: Deno.env.get("RESEND_FROM") ?? "MYPECAR <onboarding@resend.dev>", to: [para], subject: asunto, text: texto, reply_to: Deno.env.get("AVISO_EMAIL") ?? undefined }),
    });
    return { ok: r.ok, detalle: r.ok ? "enviado" : `resend ${r.status}: ${(await r.text()).slice(0, 160)}` };
  } catch (e) { return { ok: false, detalle: String(e).slice(0, 160) }; }
}

const PIE = "\n\n¿Dudas? Responde este correo o escríbenos por WhatsApp: https://wa.me/51996378921\n— Equipo MYPECAR PLUS · https://mypecar.net.pe";
function mensaje(tipo: string, nombre: string, vence: string): { asunto: string; texto: string } {
  if (tipo === "recordatorio_4") return {
    asunto: "Te quedan 4 días de prueba en MYPECAR PLUS",
    texto: `Hola:\n\nA la prueba gratuita de ${nombre} le quedan 4 días (termina el ${fmt(vence)}).\n\nPara seguir sin interrupciones, entra a https://mypecar.net.pe/modulos y pulsa "Suscribirme": pagas con Yape S/ 59 al mes o S/ 590 al año (IGV incluido). Si te suscribes antes, los días que te sobren se suman.\n\nTus datos se conservan siempre.` + PIE,
  };
  if (tipo === "recordatorio_1") return {
    asunto: "Mañana termina tu prueba de MYPECAR PLUS",
    texto: `Hola:\n\nLa prueba gratuita de ${nombre} termina mañana (${fmt(vence)}).\n\nPara seguir registrando sin cortes, suscríbete hoy desde https://mypecar.net.pe/modulos (botón "Suscribirme", pago con Yape): S/ 59 al mes o S/ 590 al año, IGV incluido.\n\nTus datos están guardados y no se pierden.` + PIE,
  };
  return {
    asunto: "Tu prueba de MYPECAR PLUS terminó (tus datos siguen guardados)",
    texto: `Hola:\n\nLa prueba gratuita de ${nombre} terminó el ${fmt(vence)}. Todo lo que registraste sigue guardado.\n\nPara volver a usar MYPECAR PLUS, entra a https://mypecar.net.pe/modulos y suscríbete con Yape (S/ 59 al mes o S/ 590 al año, IGV incluido): apenas se confirme el pago, sigues donde lo dejaste. También puedes descargar un respaldo de tus datos desde esa misma pantalla.` + PIE,
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "metodo no permitido" }, 405);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: valida, error: errV } = await sb.rpc("verificar_cron_recordatorios", { p_clave: req.headers.get("x-cron-secret") ?? "" });
  if (errV || valida !== true) return json({ error: "no autorizado" }, 401);
  let body: { probar?: boolean } = {};
  try { body = await req.json(); } catch (_) { /* vacío */ }

  const hoy = hoyLima();
  const { data: emps, error } = await sb.from("empresas").select("id, ruc, razon_social, nombre_comercial, vence_en, plan_nombre").eq("plan_nombre", "prueba");
  if (error) return json({ error: error.message }, 500);
  const resultado: unknown[] = [];
  for (const e of emps ?? []) {
    if (!e.vence_en) continue;
    const quedan = diasEntre(hoy, e.vence_en);
    const tipo = quedan === 4 ? "recordatorio_4" : quedan === 1 ? "recordatorio_1" : (quedan < 0 && quedan >= -3) ? "prueba_terminada" : null;
    if (!tipo) continue;
    const { data: pg } = await sb.from("pruebas_gratis").select("email").eq("empresa_id", e.id).maybeSingle();
    const para = pg?.email;
    const nombre = e.nombre_comercial || e.razon_social || "tu empresa";
    if (!para) { resultado.push({ empresa: nombre, tipo, estado: "sin correo guardado" }); continue; }
    if (body.probar) { resultado.push({ empresa: nombre, tipo, para, estado: "solo prueba" }); continue; }
    const { data: ya } = await sb.from("avisos_enviados").select("tipo").eq("empresa_id", e.id).eq("tipo", tipo).maybeSingle();
    if (ya) { resultado.push({ empresa: nombre, tipo, estado: "ya enviado antes" }); continue; }
    const m = mensaje(tipo, nombre, e.vence_en);
    const r = await enviarCorreo(para, m.asunto, m.texto);
    if (r.ok) await sb.from("avisos_enviados").insert({ empresa_id: e.id, tipo }); // si falló, se reintenta mañana
    console.log("recordatorios-prueba:", tipo, nombre, r.detalle);
    resultado.push({ empresa: nombre, tipo, estado: r.detalle });
  }
  return json({ ok: true, hoy, revisadas: (emps ?? []).length, resultado });
});
