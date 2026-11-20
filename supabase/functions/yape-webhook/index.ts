// Recibe la notificación de Yape que reenvía el celular del dueño, la registra y,
// si coincide con una solicitud de pago, activa la empresa.
// Avisa al dueño por correo (Resend) y/o WhatsApp (CallMeBot), según los secretos configurados.
//
// Secretos (Supabase → Edge Functions → Secrets):
//   YAPE_WEBHOOK_SECRET  (obligatorio) contraseña que envía el celular en la cabecera x-webhook-secret
//   RESEND_API_KEY, AVISO_EMAIL, RESEND_FROM   (opcionales) aviso por correo
//   CALLMEBOT_PHONE, CALLMEBOT_APIKEY          (opcionales) aviso por WhatsApp
import { createClient } from "npm:@supabase/supabase-js@2";

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

async function avisar(asunto: string, msg: string) {
  // Correo (Resend)
  const rk = Deno.env.get("RESEND_API_KEY");
  const para = Deno.env.get("AVISO_EMAIL");
  if (rk && para) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${rk}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: Deno.env.get("RESEND_FROM") ?? "MYPECAR <onboarding@resend.dev>",
          to: [para],
          subject: asunto,
          text: msg,
        }),
      });
    } catch (_) { /* el aviso nunca debe romper el registro del pago */ }
  }
  // WhatsApp (CallMeBot)
  const phone = Deno.env.get("CALLMEBOT_PHONE");
  const key = Deno.env.get("CALLMEBOT_APIKEY");
  if (phone && key) {
    try {
      await fetch(`https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(msg)}&apikey=${encodeURIComponent(key)}`);
    } catch (_) { /* idem */ }
  }
}

function leerMonto(t: string): number | null {
  const m = t.match(/S\/\.?\s*([\d][\d.,]*)/i);
  if (!m) return null;
  let s = m[1];
  if (s.includes(",") && s.includes(".")) s = s.replace(/,/g, "");
  else if (s.includes(",")) s = s.replace(",", ".");
  const n = parseFloat(s);
  return isFinite(n) ? n : null;
}

function leerNombre(t: string): string | null {
  const pats = [
    /Yape!?\s*[:\-]?\s*(.+?)\s+te\s+(?:envi[oó]|yape[oó]|hizo|mand[oó])/i,
    /(.+?)\s+te\s+(?:envi[oó]|yape[oó]|mand[oó])\s+(?:un\s+pago\s+por\s+)?S\//i,
    /recibiste.+?de\s+(.+?)(?:\.|$)/i,
  ];
  for (const p of pats) {
    const m = t.match(p);
    if (m && m[1]) return m[1].replace(/^[\s:!\-]+|[\s:!\-]+$/g, "").slice(0, 80);
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "metodo no permitido" }, 405);
  const secreto = Deno.env.get("YAPE_WEBHOOK_SECRET");
  if (!secreto || req.headers.get("x-webhook-secret") !== secreto) return json({ error: "no autorizado" }, 401);

  let body: Record<string, unknown> = {};
  const crudo = await req.text();
  try { body = JSON.parse(crudo); } catch (_) { body = { texto: crudo }; }
  const titulo = String(body.titulo ?? body.title ?? "");
  const texto = String(body.texto ?? body.text ?? body.message ?? "");
  const todo = `${titulo} ${texto}`.trim().replace(/\s+/g, " ");
  if (!todo) return json({ estado: "vacio" });

  // Solo pagos que ENTRAN. Si es un pago que tú hiciste, se ignora.
  if (/yapeaste|enviaste|pagaste|plineaste/i.test(todo)) return json({ estado: "ignorado" });
  if (!/te\s+(envi|yape|mand|hizo)|recibiste|te\s+pag/i.test(todo)) return json({ estado: "ignorado" });

  const monto = leerMonto(todo);
  const nombre = leerNombre(todo);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await sb.rpc("yape_registrar_pago", { p_monto: monto, p_nombre: nombre, p_texto: todo });
  if (error) {
    await avisar("MYPECAR: error al registrar un Yape", `Llegó un Yape pero hubo un error al registrarlo (${error.message}). Texto: ${todo.slice(0, 160)}`);
    return json({ error: error.message }, 500);
  }

  const montoTxt = monto != null ? `S/ ${monto.toFixed(2)}` : "monto no leído";
  if (data?.estado === "asignado") {
    const vence = data.vence_en ? String(data.vence_en).split("-").reverse().join("/") : "-";
    await avisar("MYPECAR: pago confirmado y empresa activada",
      `Pago ${montoTxt} de ${nombre}. Empresa ACTIVADA: ${data.empresa} (RUC ${data.ruc}) hasta ${vence}.`);
  } else if (data?.estado === "duplicado") {
    // notificación repetida: no se avisa de nuevo
  } else if (data?.estado === "revisar") {
    await avisar("MYPECAR: Yape que coincide con varias empresas",
      `Yape ${montoTxt} de ${nombre}. Coincide con VARIAS empresas; revisa en /admin.`);
  } else {
    await avisar("MYPECAR: Yape recibido sin empresa que coincida",
      `Yape ${montoTxt} de ${nombre ?? "nombre no leído"}. Aún no coincide con ninguna empresa; si el cliente declara su pago, se activará sola.`);
  }
  return json({ estado: data?.estado ?? "desconocido" });
});
