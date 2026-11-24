// Avisa al dueño (correo con Resend y/o WhatsApp con CallMeBot) cuando una empresa se registra o declara un pago.
// Solo lo puede pedir un miembro de esa empresa, y cada aviso se envía una sola vez.
// Secretos opcionales: RESEND_API_KEY, AVISO_EMAIL, RESEND_FROM, CALLMEBOT_PHONE, CALLMEBOT_APIKEY.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function avisar(asunto: string, msg: string): Promise<boolean> {
  let enviado = false;
  const rk = Deno.env.get("RESEND_API_KEY");
  const para = Deno.env.get("AVISO_EMAIL");
  if (rk && para) {
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${rk}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: Deno.env.get("RESEND_FROM") ?? "MYPECAR <onboarding@resend.dev>",
          to: [para], subject: asunto, text: msg,
        }),
      });
      enviado = enviado || r.ok;
    } catch (_) { /* opcional */ }
  }
  const phone = Deno.env.get("CALLMEBOT_PHONE");
  const key = Deno.env.get("CALLMEBOT_APIKEY");
  if (phone && key) {
    try {
      const r = await fetch(`https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(msg)}&apikey=${encodeURIComponent(key)}`);
      enviado = enviado || r.ok;
    } catch (_) { /* opcional */ }
  }
  return enviado;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "metodo no permitido" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const auth = req.headers.get("Authorization") ?? "";
  const usuario = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: u } = await usuario.auth.getUser();
  if (!u?.user) return json({ error: "no autorizado" }, 401);

  let body: { tipo?: string; empresa_id?: string } = {};
  try { body = await req.json(); } catch (_) { /* vacío */ }
  const tipo = body.tipo === "pago_reportado" ? "pago_reportado" : body.tipo === "registro" ? "registro" : null;
  const empresaId = body.empresa_id;
  if (!tipo || !empresaId) return json({ error: "datos incompletos" }, 400);

  const sb = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: miembro } = await sb.from("empresa_usuarios").select("user_id").eq("empresa_id", empresaId).eq("user_id", u.user.id).maybeSingle();
  if (!miembro) return json({ error: "no autorizado" }, 403);

  const { data: emp } = await sb.from("empresas").select("ruc,razon_social,nombre_comercial,estado").eq("id", empresaId).maybeSingle();
  if (!emp) return json({ error: "empresa no encontrada" }, 404);
  const nombre = emp.nombre_comercial || emp.razon_social || "Empresa";

  let claveAviso: string = tipo;
  let asunto = "";
  let msg = "";
  if (tipo === "registro") {
    asunto = "MYPECAR: nueva empresa registrada";
    msg = `Nueva empresa registrada: ${nombre} (RUC ${emp.ruc}). Estado: ${emp.estado}. Si paga por Yape, se activará sola.`;
  } else {
    const { data: sol } = await sb.from("solicitudes_pago").select("id,plan,monto,nombre_yape,estado,provisional").eq("empresa_id", empresaId).eq("estado", "esperando").order("creado_en", { ascending: false }).limit(1).maybeSingle();
    if (!sol) return json({ ok: true, enviado: false });
    claveAviso = `pago_${sol.id}`;
    const prov = sol.provisional ? " Entró con acceso PROVISIONAL de 48 horas: si no llega el Yape, se corta solo." : "";
    asunto = "MYPECAR: un cliente dice que pagó por Yape";
    msg = `${nombre} (RUC ${emp.ruc}) dice que pagó S/ ${Number(sol.monto).toFixed(2)} (${sol.plan}) por Yape a nombre de ${sol.nombre_yape}.${prov} Cuando llegue el Yape, se confirma sola.`;
  }

  // Un solo aviso por tipo y empresa (la clave primaria evita duplicados)
  const { error: dup } = await sb.from("avisos_enviados").insert({ empresa_id: empresaId, tipo: claveAviso });
  if (dup) return json({ ok: true, enviado: false });
  const ok = await avisar(asunto, msg);
  return json({ ok: true, enviado: ok });
});
