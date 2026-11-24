// Avisa al dueño (correo con Resend y/o WhatsApp con CallMeBot) cuando una empresa se registra, declara un pago o inicia su prueba gratuita.
// (2026-11-24) Al iniciar la prueba, además envía la bienvenida al cliente (a su correo de la sesión).
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
  const tipo = body.tipo === "pago_reportado" ? "pago_reportado" : body.tipo === "registro" ? "registro" : body.tipo === "prueba_iniciada" ? "prueba_iniciada" : null;
  const empresaId = body.empresa_id;
  if (!tipo || !empresaId) return json({ error: "datos incompletos" }, 400);

  const sb = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: miembro } = await sb.from("empresa_usuarios").select("user_id").eq("empresa_id", empresaId).eq("user_id", u.user.id).maybeSingle();
  if (!miembro) return json({ error: "no autorizado" }, 403);

  const { data: emp } = await sb.from("empresas").select("ruc,razon_social,nombre_comercial,estado,plan_nombre,vence_en").eq("id", empresaId).maybeSingle();
  if (!emp) return json({ error: "empresa no encontrada" }, 404);
  const nombre = emp.nombre_comercial || emp.razon_social || "Empresa";

  let claveAviso: string = tipo;
  let asunto = "";
  let msg = "";
  if (tipo === "registro") {
    asunto = "MYPECAR: nueva empresa registrada";
    msg = `Nueva empresa registrada: ${nombre} (RUC ${emp.ruc}). Estado: ${emp.estado}. Si paga por Yape, se activará sola.`;
  } else if (tipo === "prueba_iniciada") {
    // Solo si la base de datos confirma que la empresa de verdad está en prueba (nadie puede inventar este aviso).
    if (emp.plan_nombre !== "prueba") return json({ ok: true, enviado: false });
    asunto = "MYPECAR: empezó una prueba gratuita";
    msg = `Prueba gratuita de 14 días iniciada: ${nombre} (RUC ${emp.ruc}). Vence el ${emp.vence_en}.`;
  } else {
    const { data: sol } = await sb.from("solicitudes_pago").select("id,plan,monto,nombre_yape,estado,provisional").eq("empresa_id", empresaId).eq("estado", "esperando").order("creado_en", { ascending: false }).limit(1).maybeSingle();
    if (!sol) return json({ ok: true, enviado: false });
    claveAviso = `pago_${sol.id}`;
    const prov = sol.provisional ? " Entró con acceso PROVISIONAL de 48 horas: si no llega el Yape, se corta solo." : "";
    asunto = "MYPECAR: un cliente dice que pagó por Yape";
    msg = `${nombre} (RUC ${emp.ruc}) dice que pagó S/ ${Number(sol.monto).toFixed(2)} (${sol.plan}) por Yape a nombre de ${sol.nombre_yape}.${prov} Cuando llegue el Yape, se confirma sola.`;
  }

  // (2026-11-24) Bienvenida al CLIENTE que inició la prueba (a su correo de la sesión). Una sola vez; se marca solo si salió.
  let bienvenida: string | null = null;
  if (tipo === "prueba_iniciada" && u.user.email) {
    const { data: ya } = await sb.from("avisos_enviados").select("tipo").eq("empresa_id", empresaId).eq("tipo", "bienvenida").maybeSingle();
    if (!ya) {
      const [y, m, d] = String(emp.vence_en || "").split("-");
      const texto = `Hola:\n\nTu empresa ${nombre} (RUC ${emp.ruc}) ya está activa para probar MYPECAR PLUS gratis hasta el ${d}/${m}/${y}.\n\n` +
        `Para empezar (5 minutos):\n` +
        `1. Entra a https://mypecar.net.pe/modulos y abre 01 Registro de Ventas.\n` +
        `2. Sigue la guía "Primeros pasos": revisa tus datos, agrega un cliente y registra tu primera venta.\n` +
        `3. Registra tus compras en 02 Registro de Compras.\n` +
        `4. Mira tu IGV del mes y tu balance en 07 Reportes.\n\n` +
        `Guía completa: https://mypecar.net.pe/ayuda\n` +
        `Para darle acceso a tu contador: menú de tu empresa → "Gestionar accesos".\n\n` +
        `¿Dudas? Responde este correo o escríbenos por WhatsApp: https://wa.me/51996378921\n— Equipo MYPECAR PLUS`;
      const rk = Deno.env.get("RESEND_API_KEY");
      if (rk) {
        try {
          const r = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${rk}`, "Content-Type": "application/json" },
            body: JSON.stringify({ from: Deno.env.get("RESEND_FROM") ?? "MYPECAR <onboarding@resend.dev>", to: [u.user.email],
              subject: "Bienvenido a MYPECAR PLUS: tu prueba de 14 días ya empezó", text: texto, reply_to: Deno.env.get("AVISO_EMAIL") ?? undefined }),
          });
          bienvenida = r.ok ? "enviada" : `resend ${r.status}: ${(await r.text()).slice(0, 160)}`;
          if (r.ok) await sb.from("avisos_enviados").insert({ empresa_id: empresaId, tipo: "bienvenida" });
        } catch (e) { bienvenida = String(e).slice(0, 160); }
        console.log("avisar: bienvenida", nombre, bienvenida);
      }
    }
  }

  // Un solo aviso por tipo y empresa (la clave primaria evita duplicados)
  const { error: dup } = await sb.from("avisos_enviados").insert({ empresa_id: empresaId, tipo: claveAviso });
  if (dup) return json({ ok: true, enviado: false, bienvenida });
  const ok = await avisar(asunto, msg);
  return json({ ok: true, enviado: ok, bienvenida });
});
