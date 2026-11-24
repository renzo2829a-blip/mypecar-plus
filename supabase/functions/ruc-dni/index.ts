// Edge Function "ruc-dni" — consulta de RUC (SUNAT) y DNI (RENIEC) vía DECOLECTA.
// Versión corregida de "consulta-documento": EXIGE iniciar sesión, valida el formato y limita el uso.
//
// Cómo se aplica (una sola vez):
//   supabase functions deploy ruc-dni            (verify_jwt queda activado: es lo que corta a los anónimos)
//   El secreto DECOLECTA_TOKEN ya existe en el proyecto (lo usa consulta-documento); esta función lo reutiliza.
//   Opcional: ALLOWED_ORIGIN (por defecto https://mypecar.net.pe).
//
// El frontend (mypecar-ruc-gratis.js y 01 Ventas) prueba primero "ruc-dni" y, si todavía no está desplegada,
// usa "consulta-documento" como hasta ahora. Cuando esta esté desplegada, se puede retirar la anterior.
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

// Dígito verificador oficial del RUC (módulo 11) — corta números inventados antes de gastar una consulta.
function rucValido(r: string): boolean {
  if (!/^(10|15|16|17|20)\d{9}$/.test(r)) return false;
  const f = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = f.reduce((a, x, i) => a + x * Number(r[i]), 0);
  const dv = (11 - (suma % 11)) % 10;
  return dv === Number(r[10]);
}

// Límite por usuario (por instancia): 30 consultas por minuto y 300 por hora.
const usos = new Map<string, number[]>();
function dentroDelLimite(uid: string): boolean {
  const ahora = Date.now();
  const lista = (usos.get(uid) ?? []).filter((t) => ahora - t < 3_600_000);
  const ultimoMin = lista.filter((t) => ahora - t < 60_000).length;
  if (ultimoMin >= 30 || lista.length >= 300) { usos.set(uid, lista); return false; }
  lista.push(ahora); usos.set(uid, lista);
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "Método no permitido" }, 405);

  // 1) Exige sesión iniciada: el token del usuario se valida contra Supabase Auth.
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json(req, { error: "Inicia sesión para consultar." }, 401);
  const url = Deno.env.get("SUPABASE_URL")!;
  const usuario = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: u, error: errU } = await usuario.auth.getUser();
  if (errU || !u?.user) return json(req, { error: "Tu sesión no es válida. Vuelve a iniciar sesión." }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(req, { error: "Solicitud inválida" }, 400); }

  // 2) Debe ser miembro de la empresa desde la que consulta (la regla de la base de datos filtra por usuario).
  const empresaId = String(body.empresa_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(empresaId)) return json(req, { error: "Falta la empresa." }, 400);
  const { data: miembro, error: errM } = await usuario.from("empresa_usuarios").select("empresa_id").eq("empresa_id", empresaId).limit(1);
  if (errM || !miembro || miembro.length === 0) return json(req, { error: "No tienes acceso a esa empresa." }, 403);

  // 3) Formato: solo 8 dígitos (DNI) u 11 dígitos con dígito verificador válido (RUC).
  const numero = String(body.numero ?? body.dni_ruc ?? "").trim();
  let tipo = String(body.tipo ?? "").toLowerCase();
  if (!/^\d+$/.test(numero)) return json(req, { error: "Escribe solo números." }, 400);
  if (!tipo) tipo = numero.length === 8 ? "dni" : numero.length === 11 ? "ruc" : "";
  if (tipo === "dni" && numero.length !== 8) return json(req, { error: "El DNI debe tener 8 dígitos." }, 400);
  if (tipo === "ruc" && !rucValido(numero)) return json(req, { error: "El RUC no es válido (revisa los 11 dígitos)." }, 400);
  if (tipo !== "dni" && tipo !== "ruc") return json(req, { error: "Tipo de documento no válido." }, 400);

  // 4) Límite de uso por usuario (cuida tu saldo de DECOLECTA).
  if (!dentroDelLimite(u.user.id)) return json(req, { error: "Demasiadas consultas seguidas. Espera un minuto." }, 429);

  try {
    const token = Deno.env.get("DECOLECTA_TOKEN");
    if (!token) return json(req, { error: "Servicio de consulta no configurado." }, 503);
    const api = tipo === "ruc"
      ? `https://api.decolecta.com/v1/sunat/ruc?numero=${numero}`
      : `https://api.decolecta.com/v1/reniec/dni?numero=${numero}`;
    const res = await fetch(api, { headers: { Authorization: `Bearer ${token}` } });
    const result = await res.json();
    if (!res.ok) return json(req, { error: result.msg || "No se encontró el documento." }, 400);

    // Mismo formato de respuesta que consulta-documento (el frontend no cambia).
    const nombre = result.full_name || result.business_name || result.nombre || result.name || "";
    return json(req, { ...result, nombre, full_name: nombre, business_name: nombre, name: nombre });
  } catch (_e) {
    return json(req, { error: "No se pudo consultar ahora. Intenta de nuevo." }, 502);
  }
});
