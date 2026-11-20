/**
 * mypecar-sync.js
 * ============================================================================
 * Capa de sincronización COMPARTIDA por las 9 apps de MYPECAR CONTABLE.
 * Un solo archivo, incluido igual en cada app — así la lógica de conexión,
 * autenticación, cola sin-internet y reintentos vive en UN SOLO lugar en vez
 * de repetirse 9 veces.
 *
 * CÓMO INCLUIRLO EN CADA APP (justo antes de tu <script> de siempre):
 *
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
 *   <script src="mypecar-sync.js"></script>
 *   <script>
 *     MypecarSync.init({
 *       url: 'https://TU-PROYECTO.supabase.co',
 *       anonKey: 'TU-ANON-KEY',
 *       app: 'diario' // uno de: ventas, compras, caja, diario, personal, activos, inventario, reportes, auditoria
 *     });
 *     // ... el resto de tu app sigue igual ...
 *   </script>
 *
 * FILOSOFÍA (importante, léelo antes de integrar una app):
 *
 *  1. localStorage sigue siendo la fuente de verdad INMEDIATA — la app
 *     arranca y funciona igual si no hay internet, exactamente como hoy.
 *  2. Al iniciar (MypecarSync.pullAll), esta librería trae de Supabase la
 *     última versión de cada "clave" de esa empresa y la escribe en
 *     localStorage ANTES de que la app la lea — así, si abriste el archivo
 *     en otro dispositivo, ves los datos más recientes.
 *  3. storageGet/storageSet son reemplazos casi textuales de las funciones
 *     que 01, 03, 04 y 09 YA tienen (mismo nombre, misma firma async) — para
 *     esas 4 apps, integrar es cambiar 2 funciones, no reescribir nada más.
 *     02, 05 y 06 usan localStorage directo: para ellas, basta con llamar
 *     `await MypecarSync.pullAll()` al principio de inicializarApp() (antes
 *     de sus lecturas de localStorage) y `MypecarSync.push(clave, valor)`
 *     justo después de cada localStorage.setItem(clave, ...) que ya tengan.
 *  4. Sin internet: todo se sigue guardando en localStorage normalmente, y
 *     los cambios quedan en una "bandeja de salida" (outbox) que se reintenta
 *     sola cuando vuelve la conexión — nunca se pierde una venta por un corte
 *     de señal.
 *  5. Última escritura gana (last-write-wins) por fecha/hora — para el
 *     tamaño de negocio de MYPECAR (1-3 personas por archivo) es un
 *     compromiso razonable; MypecarSync.getConflictos() permite revisar si
 *     alguna vez dos dispositivos escribieron la misma clave casi al mismo
 *     tiempo, por transparencia.
 * ============================================================================
 */
(function (global) {
  'use strict';

  const VERSION_SYNC = '2026-11-13c';
  const OUTBOX_KEY = 'mypecar_sync_outbox';
  const OUTBOX_BORRADOS_KEY = 'mypecar_sync_outbox_borrados';
  const EMPRESA_KEY = 'mypecar_empresa_activa';
  const SESSION_LOG_KEY = 'mypecar_sync_conflictos';
  const PENDIENTE_DESDE_KEY = 'mypecar_sync_pendiente_desde';
  const ULTIMO_ERROR_KEY = 'mypecar_sync_ultimo_error';
  // (2026-09-24b) Aviso entre pestañas de que los datos de una empresa se
  // reiniciaron desde la nube -- ver verificarReinicioDatos() más abajo.
  const REINICIO_SENAL_KEY = 'mypecar_reinicio_datos_senal';
  // Claves propias de esta librería (nunca se suben a la nube como si fueran datos de la app).
  const CLAVES_INTERNAS = [OUTBOX_KEY, OUTBOX_BORRADOS_KEY, EMPRESA_KEY, SESSION_LOG_KEY, PENDIENTE_DESDE_KEY, ULTIMO_ERROR_KEY, REINICIO_SENAL_KEY];
  // ARREGLO (2026-09-16) — "null value in column valor... violates not-null
  // constraint": varias apps tienen variables que empiezan en `null` (p.ej.
  // "todavía no se importó nada") y se guardan tal cual con persistAll() en
  // CADA acción, no solo cuando cambian. Enviar un `valor: null` de JavaScript
  // a Supabase se interpreta como "deja esta columna vacía" — y la columna
  // `valor` de app_config NO admite vacíos — así que esa subida en particular
  // fallaba SIEMPRE, sin importar cuántas veces se reintentara (por eso el
  // aviso quedaba atascado en vez de resolverse solo). No es responsabilidad
  // de cada app evitar guardar `null` — el reemplazo se hace aquí, una sola
  // vez, para cualquier clave de cualquier app, presente o futura: se sube un
  // valor "marcador" en vez de null, y pullAll() lo vuelve a convertir en
  // `null` al traerlo de vuelta — para el resto del código de cada app, sigue
  // siendo exactamente `null`, como si nunca hubiera pasado por la nube.
  const MARCADOR_VALOR_NULO = { __mypecarValorNulo: true };
  function esMarcadorValorNulo(v) { return !!v && typeof v === 'object' && v.__mypecarValorNulo === true; }
  const RETRY_INTERVAL_MS = 15000;
  // A partir de cuánto tiempo con pendientes sin bajar a cero se considera
  // "atascado" (para el aviso al Contador — ver actualizarBadgeSincronizacion
  // en cada app). 90 segundos = 6 intentos del reintento automático de arriba.
  const ATASCADO_MS = 90000;

  let supabaseClient = null;
  let currentApp = null;
  let flushTimer = null;
  let listeners = { estadoCambio: [] };
  let interceptorInstalado = false;
  let interceptorPausado = false;
  // Blindaje contra condición de carrera (2026-09-16, ver flushOutbox/
  // flushOutboxBorrados más abajo): evita que dos subidas se ejecuten
  // superpuestas — por ejemplo, el reintento automático cada 15s y la subida
  // que dispara el guardado de una venta recién registrada.
  let flushEnCurso = false;
  let reintentoTrasFlush = false;
  let flushBorradosEnCurso = false;
  let reintentoBorradosTrasFlush = false;
  // Número de serie único para cada versión encolada de una clave (ver push()
  // y flushOutbox() más abajo). NO se usa la marca de tiempo (encoladoEn) para
  // esto: dos ediciones rápidas seguidas (p.ej. varias ventas registradas en
  // el mismo segundo) pueden caer en el mismo milisegundo y producir el MISMO
  // texto de fecha/hora, lo que haría que la verificación "¿sigue siendo esta
  // misma versión?" diera un falso positivo y borrara de la cola una versión
  // más nueva sin haberla subido. Un contador entero siempre es distinto.
  let outboxSeqCounter = 0;

  // ---- LZString 1.4.5 (Pieroxy, licencia libre WTFPL/MIT), embebido sin cambios ----
  const LZ = (function () {
var LZString = (function() {

// private property
var f = String.fromCharCode;
var keyStrBase64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
var keyStrUriSafe = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$";
var baseReverseDic = {};

function getBaseValue(alphabet, character) {
  if (!baseReverseDic[alphabet]) {
    baseReverseDic[alphabet] = {};
    for (var i=0 ; i<alphabet.length ; i++) {
      baseReverseDic[alphabet][alphabet.charAt(i)] = i;
    }
  }
  return baseReverseDic[alphabet][character];
}

var LZString = {
  compressToBase64 : function (input) {
    if (input == null) return "";
    var res = LZString._compress(input, 6, function(a){return keyStrBase64.charAt(a);});
    switch (res.length % 4) { // To produce valid Base64
    default: // When could this happen ?
    case 0 : return res;
    case 1 : return res+"===";
    case 2 : return res+"==";
    case 3 : return res+"=";
    }
  },

  decompressFromBase64 : function (input) {
    if (input == null) return "";
    if (input == "") return null;
    return LZString._decompress(input.length, 32, function(index) { return getBaseValue(keyStrBase64, input.charAt(index)); });
  },

  compressToUTF16 : function (input) {
    if (input == null) return "";
    return LZString._compress(input, 15, function(a){return f(a+32);}) + " ";
  },

  decompressFromUTF16: function (compressed) {
    if (compressed == null) return "";
    if (compressed == "") return null;
    return LZString._decompress(compressed.length, 16384, function(index) { return compressed.charCodeAt(index) - 32; });
  },

  //compress into uint8array (UCS-2 big endian format)
  compressToUint8Array: function (uncompressed) {
    var compressed = LZString.compress(uncompressed);
    var buf=new Uint8Array(compressed.length*2); // 2 bytes per character

    for (var i=0, TotalLen=compressed.length; i<TotalLen; i++) {
      var current_value = compressed.charCodeAt(i);
      buf[i*2] = current_value >>> 8;
      buf[i*2+1] = current_value % 256;
    }
    return buf;
  },

  //decompress from uint8array (UCS-2 big endian format)
  decompressFromUint8Array:function (compressed) {
    if (compressed===null || compressed===undefined){
        return LZString.decompress(compressed);
    } else {
        var buf=new Array(compressed.length/2); // 2 bytes per character
        for (var i=0, TotalLen=buf.length; i<TotalLen; i++) {
          buf[i]=compressed[i*2]*256+compressed[i*2+1];
        }

        var result = [];
        buf.forEach(function (c) {
          result.push(f(c));
        });
        return LZString.decompress(result.join(''));

    }

  },


  //compress into a string that is already URI encoded
  compressToEncodedURIComponent: function (input) {
    if (input == null) return "";
    return LZString._compress(input, 6, function(a){return keyStrUriSafe.charAt(a);});
  },

  //decompress from an output of compressToEncodedURIComponent
  decompressFromEncodedURIComponent:function (input) {
    if (input == null) return "";
    if (input == "") return null;
    input = input.replace(/ /g, "+");
    return LZString._decompress(input.length, 32, function(index) { return getBaseValue(keyStrUriSafe, input.charAt(index)); });
  },

  compress: function (uncompressed) {
    return LZString._compress(uncompressed, 16, function(a){return f(a);});
  },
  _compress: function (uncompressed, bitsPerChar, getCharFromInt) {
    if (uncompressed == null) return "";
    var i, value,
        context_dictionary= {},
        context_dictionaryToCreate= {},
        context_c="",
        context_wc="",
        context_w="",
        context_enlargeIn= 2, // Compensate for the first entry which should not count
        context_dictSize= 3,
        context_numBits= 2,
        context_data=[],
        context_data_val=0,
        context_data_position=0,
        ii;

    for (ii = 0; ii < uncompressed.length; ii += 1) {
      context_c = uncompressed.charAt(ii);
      if (!Object.prototype.hasOwnProperty.call(context_dictionary,context_c)) {
        context_dictionary[context_c] = context_dictSize++;
        context_dictionaryToCreate[context_c] = true;
      }

      context_wc = context_w + context_c;
      if (Object.prototype.hasOwnProperty.call(context_dictionary,context_wc)) {
        context_w = context_wc;
      } else {
        if (Object.prototype.hasOwnProperty.call(context_dictionaryToCreate,context_w)) {
          if (context_w.charCodeAt(0)<256) {
            for (i=0 ; i<context_numBits ; i++) {
              context_data_val = (context_data_val << 1);
              if (context_data_position == bitsPerChar-1) {
                context_data_position = 0;
                context_data.push(getCharFromInt(context_data_val));
                context_data_val = 0;
              } else {
                context_data_position++;
              }
            }
            value = context_w.charCodeAt(0);
            for (i=0 ; i<8 ; i++) {
              context_data_val = (context_data_val << 1) | (value&1);
              if (context_data_position == bitsPerChar-1) {
                context_data_position = 0;
                context_data.push(getCharFromInt(context_data_val));
                context_data_val = 0;
              } else {
                context_data_position++;
              }
              value = value >> 1;
            }
          } else {
            value = 1;
            for (i=0 ; i<context_numBits ; i++) {
              context_data_val = (context_data_val << 1) | value;
              if (context_data_position ==bitsPerChar-1) {
                context_data_position = 0;
                context_data.push(getCharFromInt(context_data_val));
                context_data_val = 0;
              } else {
                context_data_position++;
              }
              value = 0;
            }
            value = context_w.charCodeAt(0);
            for (i=0 ; i<16 ; i++) {
              context_data_val = (context_data_val << 1) | (value&1);
              if (context_data_position == bitsPerChar-1) {
                context_data_position = 0;
                context_data.push(getCharFromInt(context_data_val));
                context_data_val = 0;
              } else {
                context_data_position++;
              }
              value = value >> 1;
            }
          }
          context_enlargeIn--;
          if (context_enlargeIn == 0) {
            context_enlargeIn = Math.pow(2, context_numBits);
            context_numBits++;
          }
          delete context_dictionaryToCreate[context_w];
        } else {
          value = context_dictionary[context_w];
          for (i=0 ; i<context_numBits ; i++) {
            context_data_val = (context_data_val << 1) | (value&1);
            if (context_data_position == bitsPerChar-1) {
              context_data_position = 0;
              context_data.push(getCharFromInt(context_data_val));
              context_data_val = 0;
            } else {
              context_data_position++;
            }
            value = value >> 1;
          }


        }
        context_enlargeIn--;
        if (context_enlargeIn == 0) {
          context_enlargeIn = Math.pow(2, context_numBits);
          context_numBits++;
        }
        // Add wc to the dictionary.
        context_dictionary[context_wc] = context_dictSize++;
        context_w = String(context_c);
      }
    }

    // Output the code for w.
    if (context_w !== "") {
      if (Object.prototype.hasOwnProperty.call(context_dictionaryToCreate,context_w)) {
        if (context_w.charCodeAt(0)<256) {
          for (i=0 ; i<context_numBits ; i++) {
            context_data_val = (context_data_val << 1);
            if (context_data_position == bitsPerChar-1) {
              context_data_position = 0;
              context_data.push(getCharFromInt(context_data_val));
              context_data_val = 0;
            } else {
              context_data_position++;
            }
          }
          value = context_w.charCodeAt(0);
          for (i=0 ; i<8 ; i++) {
            context_data_val = (context_data_val << 1) | (value&1);
            if (context_data_position == bitsPerChar-1) {
              context_data_position = 0;
              context_data.push(getCharFromInt(context_data_val));
              context_data_val = 0;
            } else {
              context_data_position++;
            }
            value = value >> 1;
          }
        } else {
          value = 1;
          for (i=0 ; i<context_numBits ; i++) {
            context_data_val = (context_data_val << 1) | value;
            if (context_data_position == bitsPerChar-1) {
              context_data_position = 0;
              context_data.push(getCharFromInt(context_data_val));
              context_data_val = 0;
            } else {
              context_data_position++;
            }
            value = 0;
          }
          value = context_w.charCodeAt(0);
          for (i=0 ; i<16 ; i++) {
            context_data_val = (context_data_val << 1) | (value&1);
            if (context_data_position == bitsPerChar-1) {
              context_data_position = 0;
              context_data.push(getCharFromInt(context_data_val));
              context_data_val = 0;
            } else {
              context_data_position++;
            }
            value = value >> 1;
          }
        }
        context_enlargeIn--;
        if (context_enlargeIn == 0) {
          context_enlargeIn = Math.pow(2, context_numBits);
          context_numBits++;
        }
        delete context_dictionaryToCreate[context_w];
      } else {
        value = context_dictionary[context_w];
        for (i=0 ; i<context_numBits ; i++) {
          context_data_val = (context_data_val << 1) | (value&1);
          if (context_data_position == bitsPerChar-1) {
            context_data_position = 0;
            context_data.push(getCharFromInt(context_data_val));
            context_data_val = 0;
          } else {
            context_data_position++;
          }
          value = value >> 1;
        }


      }
      context_enlargeIn--;
      if (context_enlargeIn == 0) {
        context_enlargeIn = Math.pow(2, context_numBits);
        context_numBits++;
      }
    }

    // Mark the end of the stream
    value = 2;
    for (i=0 ; i<context_numBits ; i++) {
      context_data_val = (context_data_val << 1) | (value&1);
      if (context_data_position == bitsPerChar-1) {
        context_data_position = 0;
        context_data.push(getCharFromInt(context_data_val));
        context_data_val = 0;
      } else {
        context_data_position++;
      }
      value = value >> 1;
    }

    // Flush the last char
    while (true) {
      context_data_val = (context_data_val << 1);
      if (context_data_position == bitsPerChar-1) {
        context_data.push(getCharFromInt(context_data_val));
        break;
      }
      else context_data_position++;
    }
    return context_data.join('');
  },

  decompress: function (compressed) {
    if (compressed == null) return "";
    if (compressed == "") return null;
    return LZString._decompress(compressed.length, 32768, function(index) { return compressed.charCodeAt(index); });
  },

  _decompress: function (length, resetValue, getNextValue) {
    var dictionary = [],
        next,
        enlargeIn = 4,
        dictSize = 4,
        numBits = 3,
        entry = "",
        result = [],
        i,
        w,
        bits, resb, maxpower, power,
        c,
        data = {val:getNextValue(0), position:resetValue, index:1};

    for (i = 0; i < 3; i += 1) {
      dictionary[i] = i;
    }

    bits = 0;
    maxpower = Math.pow(2,2);
    power=1;
    while (power!=maxpower) {
      resb = data.val & data.position;
      data.position >>= 1;
      if (data.position == 0) {
        data.position = resetValue;
        data.val = getNextValue(data.index++);
      }
      bits |= (resb>0 ? 1 : 0) * power;
      power <<= 1;
    }

    switch (next = bits) {
      case 0:
          bits = 0;
          maxpower = Math.pow(2,8);
          power=1;
          while (power!=maxpower) {
            resb = data.val & data.position;
            data.position >>= 1;
            if (data.position == 0) {
              data.position = resetValue;
              data.val = getNextValue(data.index++);
            }
            bits |= (resb>0 ? 1 : 0) * power;
            power <<= 1;
          }
        c = f(bits);
        break;
      case 1:
          bits = 0;
          maxpower = Math.pow(2,16);
          power=1;
          while (power!=maxpower) {
            resb = data.val & data.position;
            data.position >>= 1;
            if (data.position == 0) {
              data.position = resetValue;
              data.val = getNextValue(data.index++);
            }
            bits |= (resb>0 ? 1 : 0) * power;
            power <<= 1;
          }
        c = f(bits);
        break;
      case 2:
        return "";
    }
    dictionary[3] = c;
    w = c;
    result.push(c);
    while (true) {
      if (data.index > length) {
        return "";
      }

      bits = 0;
      maxpower = Math.pow(2,numBits);
      power=1;
      while (power!=maxpower) {
        resb = data.val & data.position;
        data.position >>= 1;
        if (data.position == 0) {
          data.position = resetValue;
          data.val = getNextValue(data.index++);
        }
        bits |= (resb>0 ? 1 : 0) * power;
        power <<= 1;
      }

      switch (c = bits) {
        case 0:
          bits = 0;
          maxpower = Math.pow(2,8);
          power=1;
          while (power!=maxpower) {
            resb = data.val & data.position;
            data.position >>= 1;
            if (data.position == 0) {
              data.position = resetValue;
              data.val = getNextValue(data.index++);
            }
            bits |= (resb>0 ? 1 : 0) * power;
            power <<= 1;
          }

          dictionary[dictSize++] = f(bits);
          c = dictSize-1;
          enlargeIn--;
          break;
        case 1:
          bits = 0;
          maxpower = Math.pow(2,16);
          power=1;
          while (power!=maxpower) {
            resb = data.val & data.position;
            data.position >>= 1;
            if (data.position == 0) {
              data.position = resetValue;
              data.val = getNextValue(data.index++);
            }
            bits |= (resb>0 ? 1 : 0) * power;
            power <<= 1;
          }
          dictionary[dictSize++] = f(bits);
          c = dictSize-1;
          enlargeIn--;
          break;
        case 2:
          return result.join('');
      }

      if (enlargeIn == 0) {
        enlargeIn = Math.pow(2, numBits);
        numBits++;
      }

      if (dictionary[c]) {
        entry = dictionary[c];
      } else {
        if (c === dictSize) {
          entry = w + w.charAt(0);
        } else {
          return null;
        }
      }
      result.push(entry);

      // Add w+entry[0] to the dictionary.
      dictionary[dictSize++] = w + entry.charAt(0);
      enlargeIn--;

      w = entry;

      if (enlargeIn == 0) {
        enlargeIn = Math.pow(2, numBits);
        numBits++;
      }

    }
  }
};
  return LZString;
})();
  return LZString;
  })();

  function log(...args) { console.log('[MypecarSync]', ...args); }
  function warn(...args) { console.warn('[MypecarSync]', ...args); }

  // -------------------------------------------------------------------------
  // Utilidades locales (localStorage con try/catch — mismo patrón que ya
  // usan las 9 apps, para que esta librería nunca sea el eslabón menos
  // tolerante a fallos del navegador).
  // -------------------------------------------------------------------------
  // =========================================================================
  // ALMACENAMIENTO LOCAL (2026-09-19) — compresión transparente + fallos NUNCA silenciosos
  // =========================================================================
  // CAUSA RAÍZ REAL de "importo un mes, cierro, abro y todo vuelve a cero" (reproducida con los
  // 7 Excel reales de Carlos: enero-abril del SIRE, junio, julio y agosto): el navegador solo
  // deja guardar unos 5.2 millones de caracteres en localStorage por origen (medido en
  // Chromium/Edge para archivos abiertos con doble clic). Un mes real de esta pollería (~2,400
  // comprobantes) pesa ~1.2 millones de caracteres, así que ENERO, FEBRERO, MARZO y ABRIL
  // llenaban todo el cupo (5.11 M de 5.20 M) y, desde el quinto mes, setItem() lanzaba
  // QuotaExceededError. Ese error quedaba atrapado en lsSet() y se ignoraba: el periodo nunca
  // quedaba guardado (ni en este equipo ni en la cola de subida a la nube), y como el cupo ya
  // estaba agotado, tampoco cabía el aviso de error (ULTIMO_ERROR_KEY) ni la cola de subida
  // (OUTBOX_KEY) — por eso la pantalla seguía diciendo "Todo guardado" con 0 pendientes. Al
  // reabrir, el periodo aparecía vacío. Coincide con "hace unas horas funcionaba": cada mes
  // nuevo se comía otro 1.2 M del mismo cupo hasta que un mes ya no cupo.
  //
  // ARREGLO en dos capas:
  //  1) Los valores grandes (>= 20,000 caracteres) se guardan COMPRIMIDOS (LZString, ~24 veces
  //     más chico con este tipo de datos: 1.25 M -> 52 mil caracteres por mes). Es transparente:
  //     lsGet/lsSet y también cualquier localStorage.getItem/setItem directo de las 9 apps
  //     (ver instalarAlmacenamientoTransparente) ven siempre el texto original. Lo ya guardado
  //     sin comprimir sigue leyéndose normal, y se comprime solo cuando se reescribe o cuando
  //     falta espacio (ver compactarAlmacenamiento).
  //  2) Si aun así no cabe, ya no falla en silencio: el valor queda respaldado en MEMORIA (la
  //     app sigue funcionando y se sube a la nube desde ahí), y el estado
  //     (getEstado().almacenamientoLleno) y un aviso rojo visible lo dicen — sin depender de
  //     que localStorage acepte escribir el propio aviso.
  const LZ_MARCA = 'LZ1:';
  const UMBRAL_COMPRESION = 20000;
  let LS = null; try { LS = global.localStorage; } catch (e) { LS = null; }
  let STO = null;
  try {
    STO = {
      get: Storage.prototype.getItem, set: Storage.prototype.setItem, remove: Storage.prototype.removeItem, clear: Storage.prototype.clear,
      // 2026-09-24: también se guardan key()/length ORIGINALES (antes de
      // parchearlos, ver instalarAlmacenamientoTransparente) -- se necesitan
      // para enumerar las claves FÍSICAS reales del disco (con su sufijo de
      // empresa) sin pasar por la versión "aislada" que ven las 9 apps.
      key: Storage.prototype.key,
      lengthDesc: Object.getOwnPropertyDescriptor(Storage.prototype, 'length')
    };
  } catch (e) { STO = null; }
  const respaldoMemoria = new Map();        // clave -> texto JSON que NO cupo en localStorage
  const erroresAlmacenamiento = new Map();  // clave -> motivo (solo claves de datos de la app)
  let ultimoErrorMemoria = null;
  let outboxMem = null;                     // la cola de subida, si ni ella cupo en localStorage
  let parcheAlmacenamientoInstalado = false;
  let escriturasBloqueadasPorReinicio = false; // ver escribirTexto / verificarReinicioDatos (2026-09-24b)

  function rawGetFisica(fisica) { return STO ? STO.get.call(LS, fisica) : LS.getItem(fisica); }
  function rawSetFisica(fisica, val) { if (STO) STO.set.call(LS, fisica, val); else LS.setItem(fisica, val); }
  function rawGet(key) { return rawGetFisica(claveFisica(key)); }
  function rawSet(key, val) { rawSetFisica(claveFisica(key), val); }
  function esClaveDeDatos(key) {
    // (2026-11-20) 'sb-...' es la sesión de inicio de sesión de Supabase: NO es un dato de la app.
    // Antes se trataba como dato (aislada por empresa y subida a la nube), lo que podía obligar a
    // volver a iniciar sesión en cada módulo y dejaba una copia de la sesión en app_config.
    // Ahora es una clave global: un solo inicio de sesión sirve para los 9 módulos.
    return CLAVES_INTERNAS.indexOf(key) === -1 && key.indexOf('_meta_') !== 0 && key.indexOf('mps_') !== 0 && key.indexOf('mypecar_') !== 0 && key.indexOf('sb-') !== 0;
  }
  // =========================================================================
  // AISLAMIENTO POR EMPRESA (2026-09-24)
  // =========================================================================
  // CAUSA RAÍZ de "cambié de empresa y el encabezado/Ajustes se quedó con los
  // datos de la empresa anterior" (reportado el 24-sept, reproducido con las
  // 9 apps reales de Carlos): cada app guarda su configuración y TODOS sus
  // datos (ventas, periodos, catálogo, clientes, etc.) bajo una clave FIJA de
  // localStorage -- p.ej. "vendepollo_config" -- sin importar qué empresa
  // está activa. mypecar_empresa_activa solo le dice a la NUBE de qué
  // empresa traer/subir datos (pullAll/push ya filtraban por empresa_id
  // ahí), pero la COPIA LOCAL en este navegador seguía siendo una sola,
  // compartida entre TODAS las empresas que alguna vez se abrieron en este
  // mismo equipo. Si la empresa nueva nunca sincronizó esa clave en
  // particular hacia la nube (empresa recién creada, o ese dato todavía no
  // se guardó desde ningún dispositivo), pullAll() no encontraba nada que
  // traer para esa clave y la dejaba TAL CUAL -- con los datos de la empresa
  // ANTERIOR todavía puestos ahí. Por eso el aviso de "auto-poblar datos
  // legales" tampoco se disparaba: revisa si el config está en blanco
  // (!config.ruc && !config.razonSocial), y no lo estaba -- estaba lleno,
  // pero con los datos de la OTRA empresa.
  //
  // ARREGLO: cada clave de datos de cada app (y su metadato "_meta_<clave>")
  // ahora vive en una clave FÍSICA distinta por empresa dentro de este mismo
  // navegador ("<clave>::emp_<id-de-empresa>") -- totalmente transparente
  // para las 9 apps, que siguen usando siempre el mismo nombre de clave de
  // siempre (storageGet/storageSet, o localStorage.setItem/getItem directo:
  // ninguno de los dos necesitó cambiar). Así, abrir "Pio Chicken" en un
  // equipo donde antes se abrió "PRUEBA" arranca SIEMPRE en blanco para
  // cualquier dato que Pio Chicken todavía no tenga en la nube -- nunca
  // hereda por accidente lo que quedó de la otra empresa -- y si luego se
  // vuelve a "PRUEBA", sus datos siguen intactos donde estaban, sin haberse
  // mezclado ni pisado en ningún momento.
  function requiereAislamientoPorEmpresa(key) {
    return esClaveDeDatos(key) || key.indexOf('_meta_') === 0;
  }
  // Lee mypecar_empresa_activa DIRECTO del almacenamiento real, sin pasar por
  // claveFisica() (sería circular: esta misma clave nunca se aísla a sí
  // misma -- es una CLAVE_INTERNA, ver requiereAislamientoPorEmpresa).
  function empresaActivaFisica() {
    try {
      const raw = STO ? STO.get.call(LS, EMPRESA_KEY) : (LS ? LS.getItem(EMPRESA_KEY) : null);
      if (raw === null || raw === undefined) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  }
  function claveFisicaParaEmpresa(key, empresaId) {
    if (!requiereAislamientoPorEmpresa(key)) return key;
    return empresaId ? (key + '::emp_' + empresaId) : key;
  }
  // FIJADO DE EMPRESA POR CARGA DE PÁGINA (2026-09-24) -- ver el hallazgo
  // completo junto al arreglo de "Cambiar de empresa" en mypecar-login.js:
  // varias de las 9 apps guardan su config con un listener de
  // "beforeunload" (para limpiar el "Usuario Activo" al cerrar), que hace
  // un localStorage.setItem CON LOS DATOS QUE TENÍA EN MEMORIA. El problema:
  // "Cambiar de empresa" primero actualiza mypecar_empresa_activa a la
  // empresa NUEVA y RECIÉN DESPUÉS recarga la página -- y en el instante
  // entre una cosa y la otra, ese beforeunload se dispara igual (la
  // recarga ES un unload) y, si claveFisica() leyera mypecar_empresa_activa
  // en VIVO, ese guardado de último momento (con los datos de la empresa
  // VIEJA, que es lo único que hay en memoria en esa página) se escribiría
  // en la clave física de la empresa NUEVA -- ensuciándola con datos que no
  // le pertenecen, la fracción de segundo antes de que la recarga en sí
  // borre por completo esa página. (Se reprodujo así, exactamente, con una
  // prueba automatizada -- ver la entrega.)
  //
  // ARREGLO: la empresa que se usa para aislar el ALMACENAMIENTO (a
  // diferencia de empresas.activaId(), que sigue siendo siempre en vivo --
  // varias partes del login la necesitan así) se FIJA una sola vez por
  // carga de página, la primera vez que hace falta -- y no se vuelve a
  // mover aunque mypecar_empresa_activa cambie después. Así, cualquier
  // guardado que haga ESTA página en lo que le queda de vida (incluido un
  // beforeunload de último segundo) sigue yendo a la empresa con la que esta
  // página en realidad trabajó, nunca a la que recién se eligió y todavía
  // no llegó a cargar. Una vez que la recarga sí ocurre, es una carga de
  // página nueva (JS totalmente reiniciado) y el fijado vuelve a hacerse
  // desde cero con la empresa ya actualizada -- ahí sí, correcta desde el
  // primer instante (pullAll, Ajustes, encabezados, todo).
  let empresaFijadaEstaCarga; // undefined = todavía no fijada en esta carga de página
  function empresaParaAislamiento() {
    if (empresaFijadaEstaCarga === undefined || empresaFijadaEstaCarga === null) {
      const actual = empresaActivaFisica();
      if (actual !== null) empresaFijadaEstaCarga = actual; // se fija la PRIMERA vez que hay una empresa real esta carga de página
      return actual; // mientras no haya ninguna fijada todavía (p.ej. antes de elegir la primera empresa), se sigue leyendo en vivo
    }
    return empresaFijadaEstaCarga;
  }
  function claveFisica(key) { return claveFisicaParaEmpresa(key, empresaParaAislamiento()); }
  // Todas las claves FÍSICAS reales que hay hoy en el disco (con su sufijo de
  // empresa si corresponde) -- usa key()/length ORIGINALES (STO), nunca los
  // parcheados, porque esto sirve justamente para ver el disco tal cual es.
  function clavesFisicasReales() {
    const out = [];
    // Nunca cae a LS.length/LS.key como respaldo: una vez instalado el
    // parche (ver instalarAlmacenamientoTransparente), esos DOS ya están
    // reemplazados por la versión aislada -- usar ese respaldo aquí
    // recursaría sobre sí mismo sin parar. Si por algo STO/STO.lengthDesc no
    // están disponibles, simplemente no hay forma segura de leer el disco
    // real (se devuelve vacío -- en la práctica esto no pasa en un
    // navegador real, donde Storage.prototype.length siempre existe).
    if (!LS || !STO || !STO.lengthDesc) return out;
    const n = STO.lengthDesc.get.call(LS);
    for (let i = 0; i < n; i++) out.push(STO.key.call(LS, i));
    return out;
  }
  // Las claves que debe "ver" la app activa en este momento -- las internas
  // (mps_/mypecar_/etc.) tal cual, y las de datos SOLO si son de la empresa
  // activa, ya sin su sufijo (para que localStorage.key()/length se vean
  // exactamente igual que antes de este arreglo, desde el punto de vista de
  // cualquiera de las 9 apps). Las claves de datos de OTRAS empresas
  // simplemente no aparecen -- así ninguna app puede, ni por accidente,
  // recorrer o "descubrir" un periodo/catálogo de una empresa distinta a la
  // activa.
  function clavesVisiblesLS() {
    const empresaId = empresaParaAislamiento();
    const sufijo = empresaId ? ('::emp_' + empresaId) : null;
    const vistas = [];
    clavesFisicasReales().forEach(fisica => {
      if (!requiereAislamientoPorEmpresa(fisica)) { vistas.push(fisica); return; }
      if (sufijo && fisica.length > sufijo.length && fisica.slice(-sufijo.length) === sufijo) {
        vistas.push(fisica.slice(0, -sufijo.length));
      }
      // si no coincide con el sufijo de la empresa activa (o no hay ninguna
      // empresa activa todavía), es de otra empresa -- no se muestra.
    });
    return vistas;
  }
  // CLAVES HUÉRFANAS SIN EMPRESA (cambiado el 2026-09-24b, 6ta ronda).
  // Antes, aquí había una "migración única" que tomaba toda clave de datos
  // SIN sufijo de empresa y la renombraba a la empresa que estuviera activa
  // en ese momento. En la práctica NO era única: corría en CADA carga de
  // página, y cualquier dato que por algún motivo quedara escrito sin sufijo
  // (p.ej. algo guardado antes de iniciar sesión) terminaba "regalado" a la
  // empresa que estuviera activa en la siguiente carga -- justamente así
  // aparecían en DEMO DOS la configuración y los datos de la Pollería (y en
  // la Pollería los de PRUEBA). Todos los equipos ya pasaron hace rato por
  // esa migración, así que ahora esas claves huérfanas simplemente se
  // DESCARTAN (nunca se asignan a ninguna empresa). Solo se hace cuando hay
  // una empresa activa: sin empresa (modo 100% local, sin nube configurada)
  // las claves sin sufijo son las legítimas y no se tocan.
  function descartarClavesHuerfanasSinEmpresa() {
    if (!LS || !STO) return;
    const empresaId = empresaParaAislamiento();
    if (!empresaId) return;
    clavesFisicasReales().forEach(fisica => {
      if (!requiereAislamientoPorEmpresa(fisica)) return;
      if (fisica.indexOf('::emp_') !== -1) return; // ya pertenece a una empresa concreta
      try { STO.remove.call(LS, fisica); } catch (e) { /* no crítico */ }
    });
  }
  function setUltimoError(msg) {
    ultimoErrorMemoria = msg;
    try { rawSet(ULTIMO_ERROR_KEY, JSON.stringify(msg)); } catch (e) { /* sin espacio: queda solo en memoria */ }
  }
  function diferirEmitir() { try { setTimeout(() => { try { emitirEstadoCambio(); } catch (e) { } }, 0); } catch (e) { } }

  // Devuelve el texto tal como debe guardarse: comprimido (con marca) si es grande y vuelve
  // idéntico al descomprimir; si no, el mismo texto. Nunca guarda algo que no pueda recuperarse.
  function comprimirSiConviene(texto) {
    if (texto.length < UMBRAL_COMPRESION) return texto;
    try {
      const c = LZ.compressToUTF16(texto);
      if (c.length + LZ_MARCA.length >= texto.length) return texto;
      if (LZ.decompressFromUTF16(c) !== texto) return texto;
      return LZ_MARCA + c;
    } catch (e) { return texto; }
  }
  function descomprimirCrudo(raw) {
    if (typeof raw === 'string' && raw.indexOf(LZ_MARCA) === 0) {
      let t = null;
      try { t = LZ.decompressFromUTF16(raw.slice(LZ_MARCA.length)); } catch (e) { t = null; }
      if (t === null || t === undefined) { setUltimoError('Un dato guardado en este equipo no se pudo descomprimir (se ignora; si está respaldado en la nube se recupera al sincronizar).'); return null; }
      return t;
    }
    return raw;
  }
  // Texto original (ya descomprimido) de una clave, o null si no hay nada guardado. Incluye lo
  // que solo pudo quedar en memoria por falta de espacio. Trabaja siempre con
  // la clave FÍSICA (ver claveFisica arriba) para que respaldoMemoria y el
  // disco hablen siempre de la misma empresa.
  function leerTexto(key) { return leerTextoFisica(claveFisica(key)); }
  function leerTextoFisica(fisica) {
    if (respaldoMemoria.has(fisica)) return respaldoMemoria.get(fisica);
    return descomprimirCrudo(rawGetFisica(fisica));
  }
  // Igual que leerTexto(), pero para la empresa que se indique (no
  // necesariamente la activa en este momento) -- lo usan flushOutbox() y
  // flushOutboxBorrados() para leer el valor de la empresa que corresponda a
  // cada pendiente en cola, aunque mientras tanto se haya cambiado a otra.
  function leerTextoParaEmpresa(key, empresaId) { return leerTextoFisica(claveFisicaParaEmpresa(key, empresaId)); }

  // Comprime lo que otras claves de datos tengan sin comprimir. Devuelve cuántos caracteres liberó.
  // Si no se pudo liberar nada, no se vuelve a intentar durante 20 s ni con las claves que ya se
  // vio que no comprimen (p.ej. datos ya comprimidos de otros programas): con el disco realmente
  // lleno cada escritura fallida repetiría todo el trabajo en balde y la app se pondría lenta.
  let compactacionInutilEn = 0;
  const intentosInutiles = new Map(); // clave -> largo con el que ya se intentó comprimir sin ganancia
  function compactarAlmacenamiento(exceptoClave) {
    if (!LS) return 0;
    if (Date.now() - compactacionInutilEn < 20000) return 0;
    let liberado = 0;
    // NOTA (2026-09-24): se usa clavesFisicasReales() (basada en STO.key/
    // STO.lengthDesc, los ORIGINALES sin parchear) y no LS.key(i)/LS.length
    // directo -- esos ahora están parcheados (ver instalarAlmacenamientoTransparente)
    // para devolver solo las claves "visibles" de la empresa activa, sin su
    // sufijo -- y aquí hace falta ver el disco TAL CUAL es (todas las
    // empresas, con su sufijo), porque la compresión trabaja sobre el disco
    // real. Por eso se leen/escriben con rawGetFisica/rawSetFisica DIRECTO
    // (sin volver a pasar por claveFisica, que las sufijaría dos veces).
    // "exceptoClave" que llega de escribirTexto() ya es también una clave
    // física (ver más abajo), así que la comparación sigue siendo correcta
    // tal cual.
    const claves = clavesFisicasReales();
    for (const k of claves) {
      if (k === exceptoClave || !esClaveDeDatos(k) || respaldoMemoria.has(k)) continue;
      let raw; try { raw = rawGetFisica(k); } catch (e) { continue; }
      if (typeof raw !== 'string' || raw.length < UMBRAL_COMPRESION || raw.indexOf(LZ_MARCA) === 0) continue;
      if (intentosInutiles.get(k) === raw.length) continue;
      const comp = comprimirSiConviene(raw);
      if (comp !== raw) { try { rawSetFisica(k, comp); liberado += raw.length - comp.length; intentosInutiles.delete(k); } catch (e) { /* si ni así cabe, se deja igual */ } }
      else intentosInutiles.set(k, raw.length);
    }
    if (liberado === 0) compactacionInutilEn = Date.now();
    return liberado;
  }
  function compactarAhora() { compactacionInutilEn = 0; intentosInutiles.clear(); return compactarAlmacenamiento(null); }

  // NOTA (2026-09-24): respaldoMemoria y erroresAlmacenamiento ahora se
  // indexan por clave FÍSICA (con su sufijo "::emp_<id>" si corresponde),
  // igual que leerTextoFisica -- así un respaldo en memoria de una empresa
  // nunca se confunde con el de otra.
  function liberarFallo(fisica) {
    respaldoMemoria.delete(fisica);
    if (erroresAlmacenamiento.delete(fisica)) diferirEmitir();
  }
  function registrarFallo(key, fisica, e, texto) {
    if (esClaveDeDatos(key)) {
      respaldoMemoria.set(fisica, texto);
      erroresAlmacenamiento.set(fisica, (e && e.name) ? String(e.name) : 'sin espacio');
      setUltimoError('No cabe en el almacenamiento de este equipo: "' + key + '" (' + Math.round(texto.length / 1000) + ' mil caracteres). Se mantiene en memoria y se respalda en la nube.');
      diferirEmitir();
    } else {
      setUltimoError('No se pudo escribir "' + key + '" en este equipo (sin espacio de guardado).');
    }
  }
  // Único punto por donde se escribe en localStorage. true = quedó guardado en el disco de este equipo.
  function escribirTexto(key, texto) {
    // (2026-09-24b) Si otra pestaña acaba de reiniciar los datos de ESTA
    // empresa (ver verificarReinicioDatos), esta página tiene en memoria
    // datos viejos y se va a recargar en un instante: no se le deja escribir
    // ningún dato de la app (ni siquiera el guardado de último segundo del
    // "beforeunload"), para que no vuelva a sembrar lo que se acaba de borrar.
    if (escriturasBloqueadasPorReinicio && esClaveDeDatos(key)) return true;
    const fisica = claveFisica(key);
    const aGuardar = esClaveDeDatos(key) ? comprimirSiConviene(texto) : texto;
    try { rawSetFisica(fisica, aGuardar); liberarFallo(fisica); return true; }
    catch (e1) {
      let ultimo = e1;
      let liberado = 0;
      try { liberado = compactarAlmacenamiento(fisica); } catch (e) { liberado = 0; }
      if (liberado > 0) { try { rawSetFisica(fisica, aGuardar); liberarFallo(fisica); return true; } catch (e2) { ultimo = e2; } }
      warn('No se pudo escribir en localStorage:', ultimo);
      registrarFallo(key, fisica, ultimo, texto);
      return false;
    }
  }
  // Reintenta pasar a disco lo que quedó solo en memoria (por ejemplo, si el usuario liberó espacio).
  function reintentarRespaldosEnMemoria() {
    if (respaldoMemoria.size === 0) return;
    Array.from(respaldoMemoria.keys()).forEach(fisica => {
      const texto = respaldoMemoria.get(fisica);
      try { rawSetFisica(fisica, comprimirSiConviene(texto)); liberarFallo(fisica); } catch (e) { /* sigue sin caber */ }
    });
  }
  function olvidarClaveEnMemoria(fisica) {
    respaldoMemoria.delete(fisica);
    if (erroresAlmacenamiento.delete(fisica)) diferirEmitir();
  }

  function lsGet(key, fallback) {
    try {
      const v = leerTexto(key);
      if (v === null || v === undefined) return fallback;
      const parsed = JSON.parse(v);
      // Blindaje: si lo guardado (nube o local) quedó literalmente como null —por
      // ejemplo, tras sincronizar una fila de app_config cuyo "valor" es NULL— no se
      // deja pasar ese null en silencio cuando quien llama esperaba otra cosa (un
      // arreglo, un objeto de configuración, etc.). Sin este resguardo, la app sigue
      // ejecutando el resto de su arranque con ese null y se detiene a medio camino
      // (con un error como "Cannot read properties of null"), dejando en blanco
      // secciones enteras — como Gestión de Periodos o el Catálogo de Cuentas— sin
      // ningún aviso visible de qué falló.
      return (parsed === null && fallback !== null) ? fallback : parsed;
    } catch (e) { return fallback; }
  }
  function lsSet(key, value) {
    let texto;
    try { texto = JSON.stringify(value); } catch (e) { warn('No se pudo serializar', key, e); return false; }
    return escribirTexto(key, texto === undefined ? 'undefined' : texto);
  }

  // Claves guardadas (con un prefijo dado) de la empresa ACTIVA (ver
  // clavesVisiblesLS -- 2026-09-24), incluidas las que solo están en memoria
  // por falta de espacio.
  function claves(prefijo) {
    const set = new Set();
    clavesVisiblesLS().forEach(k => { if (!prefijo || k.indexOf(prefijo) === 0) set.add(k); });
    const empresaId = empresaParaAislamiento();
    const sufijo = empresaId ? ('::emp_' + empresaId) : null;
    respaldoMemoria.forEach((_v, fisica) => {
      let logica = null;
      if (!requiereAislamientoPorEmpresa(fisica)) logica = fisica;
      else if (sufijo && fisica.slice(-sufijo.length) === sufijo) logica = fisica.slice(0, -sufijo.length);
      if (logica !== null && (!prefijo || logica.indexOf(prefijo) === 0)) set.add(logica);
    });
    return Array.from(set);
  }
  // Cuánto del cupo del navegador (aprox. 5.2 millones de caracteres) está
  // ocupado -- sobre el disco REAL completo (todas las empresas juntas, ver
  // clavesFisicasReales 2026-09-24), porque el cupo del navegador es uno
  // solo para todo el origen, sin importar cuántas empresas se hayan usado
  // alguna vez en este equipo.
  function usoAlmacenamiento() {
    let total = 0, n = 0;
    if (LS) clavesFisicasReales().forEach(k => { let v = ''; try { v = rawGetFisica(k) || ''; } catch (e) { } total += k.length + v.length; n++; });
    return { caracteres: total, claves: n, cupoAproximado: 5200000, porcentaje: Math.round(total / 52000) };
  }

  // Compresión transparente para TODO localStorage.getItem/setItem (incluidas las apps que lo
  // usan directo: 02, 05, 06, 07, 08): un valor grande se guarda comprimido y se lee ya
  // descomprimido. Se instala una sola vez, al cargar este archivo (antes que cualquier app).
  function instalarAlmacenamientoTransparente() {
    if (parcheAlmacenamientoInstalado || !STO || !LS) return;
    parcheAlmacenamientoInstalado = true;
    // Primero migra lo que ya hubiera guardado ANTES de este arreglo (ver
    // migrarClavesSinAislarUnaVez arriba) -- usa STO.* directo (sin parchear
    // todavía), así que es seguro hacerlo antes de instalar los parches de
    // abajo.
    try { descartarClavesHuerfanasSinEmpresa(); } catch (e) { warn('No se pudo descartar claves antiguas sin empresa:', e); }
    Storage.prototype.getItem = function (k) { if (this !== LS) return STO.get.call(this, k); return leerTexto(String(k)); };
    Storage.prototype.setItem = function (k, v) { if (this !== LS) return STO.set.call(this, k, v); escribirTexto(String(k), String(v)); };
    // ARREGLO (2026-09-24): antes borraba SIEMPRE la clave tal cual la pidió
    // la app (sin sufijo de empresa) -- con el aislamiento por empresa (ver
    // claveFisica arriba), eso ya no borraba nada de verdad en el disco
    // (borraba una clave física que nunca existió), dejando el dato viejo
    // intacto. Ahora resuelve la clave física de la empresa activa, igual
    // que getItem/setItem.
    Storage.prototype.removeItem = function (k) {
      if (this !== LS) return STO.remove.call(this, k);
      const fisica = claveFisica(String(k));
      olvidarClaveEnMemoria(fisica);
      return STO.remove.call(this, fisica);
    };
    Storage.prototype.clear = function () { if (this === LS) { respaldoMemoria.clear(); if (erroresAlmacenamiento.size) { erroresAlmacenamiento.clear(); diferirEmitir(); } } return STO.clear.call(this); };
    // ARREGLO (2026-09-24): varias de las 9 apps recorren localStorage con
    // `for (i=0; i<localStorage.length; i++) localStorage.key(i)` para
    // descubrir sus propias claves dinámicas (p.ej. los periodos guardados,
    // "vendepollo_periods__2026-01", uno por mes). Sin parchear key()/length
    // también, esas dos seguían devolviendo las claves FÍSICAS reales (ya
    // con su sufijo de empresa) -- la app encontraba el nombre "correcto"
    // pero, al leerlo con localStorage.getItem(esa_clave_ya_con_sufijo), el
    // sufijo se aplicaba una SEGUNDA vez y la lectura fallaba (no existe tal
    // clave) -- todo el Catálogo/Gestión de Periodos se veía vacío o roto.
    // Ahora key()/length devuelven las claves tal como las conocen las 9
    // apps (sin sufijo), y solo las de la empresa activa -- ver
    // clavesVisiblesLS() más arriba.
    Storage.prototype.key = function (i) {
      if (this !== LS) return STO.key.call(this, i);
      const vistas = clavesVisiblesLS();
      return i >= 0 && i < vistas.length ? vistas[i] : null;
    };
    try {
      Object.defineProperty(Storage.prototype, 'length', {
        configurable: true,
        get: function () {
          if (this !== LS) return STO.lengthDesc.get.call(this);
          return clavesVisiblesLS().length;
        }
      });
    } catch (e) { warn('No se pudo aislar localStorage.length por empresa (se deja el comportamiento normal del navegador):', e); }
    // Si hay algo que solo vive en memoria y todavía no llegó a la nube, el navegador avisa antes de cerrar.
    global.addEventListener('beforeunload', function (ev) {
      try {
        if (erroresAlmacenamiento.size > 0 && (outboxDeEstaApp().length > 0 || !navigator.onLine)) { ev.preventDefault(); ev.returnValue = ''; return ''; }
      } catch (e) { }
    });
  }

  // Aviso rojo fijo, independiente de la app (así también lo ven 02, 05, 06... sin tocar su HTML).
  let bannerAlmEl = null;
  function actualizarBannerAlmacenamiento(estado) {
    if (typeof document === 'undefined' || !document.body) return;
    if (!estado.almacenamientoLleno) {
      if (bannerAlmEl && bannerAlmEl.parentNode) bannerAlmEl.parentNode.removeChild(bannerAlmEl);
      bannerAlmEl = null; return;
    }
    if (!bannerAlmEl) {
      bannerAlmEl = document.createElement('div');
      bannerAlmEl.id = 'mps-alerta-almacenamiento';
      bannerAlmEl.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:100000;background:#b91c1c;color:#fff;font:600 13px/1.4 Arial,sans-serif;text-align:center;padding:9px 14px;box-shadow:0 2px 8px rgba(0,0,0,.35);';
      document.body.appendChild(bannerAlmEl);
    }
    const respaldado = estado.online && estado.conectadoASupabase && estado.pendientesEnCola === 0;
    bannerAlmEl.textContent = respaldado
      ? '⚠️ Este navegador se quedó sin espacio de guardado en este equipo, pero lo que registraste YA está respaldado en la nube. Puedes seguir con internet; avisa a soporte para liberar espacio en este equipo.'
      : '⚠️ Este navegador se quedó SIN ESPACIO de guardado en este equipo. Lo último que registraste todavía NO está protegido: se está subiendo a la nube. NO cierres ni recargues esta página hasta que este aviso cambie.';
  }

  function leerOutbox() { return outboxMem ? outboxMem.slice() : lsGet(OUTBOX_KEY, []); }
  // ARREGLO (2026-09-24b, 6ta ronda): la cola de subida es UNA sola para las
  // 9 apps (todas comparten el mismo almacenamiento del navegador), pero
  // cada pendiente no recordaba DE QUÉ APP era. Resultado: con 01 Ventas y
  // 02 Compras abiertas a la vez, 01 podía subir a la nube un pendiente de
  // 02 (p.ej. "comprapollo_config") marcado como si fuera de "ventas" -- y
  // lo quitaba de la cola, así que la fila real de "compras" nunca se
  // actualizaba. Ahora cada pendiente guarda su app, y cada app solo sube,
  // cuenta y bloquea el cierre por SUS propios pendientes. (Los pendientes
  // antiguos sin app se siguen tratando como antes, como de la app actual.)
  function esDeEstaApp(item) { return !item || typeof item !== 'object' || !item.app || !currentApp || item.app === currentApp; }
  function outboxDeEstaApp() { return leerOutbox().filter(esDeEstaApp); }
  function borradosDeEstaApp() { return leerOutboxBorrados().filter(esDeEstaApp); }
  function totalPendientesDeEstaApp() { return outboxDeEstaApp().length + borradosDeEstaApp().length; }
  function guardarOutbox(items) { const ok = lsSet(OUTBOX_KEY, items); outboxMem = ok ? null : items.slice(); return ok; }
  function leerOutboxBorrados() { return lsGet(OUTBOX_BORRADOS_KEY, []); }
  function guardarOutboxBorrados(items) { return lsSet(OUTBOX_BORRADOS_KEY, items); }

  // Lleva la cuenta de desde cuándo hay pendientes sin bajar a cero (para
  // poder avisar si la sincronización lleva "atascada" un buen rato) y limpia
  // el último error guardado en cuanto la cola vuelve a quedar en cero.
  function actualizarPendienteDesde(totalPendientes) {
    if (totalPendientes > 0) {
      if (!lsGet(PENDIENTE_DESDE_KEY, null)) lsSet(PENDIENTE_DESDE_KEY, new Date().toISOString());
    } else {
      lsSet(PENDIENTE_DESDE_KEY, null);
      lsSet(ULTIMO_ERROR_KEY, null);
      ultimoErrorMemoria = null;
    }
  }

  function emitirEstadoCambio() {
    actualizarPendienteDesde(totalPendientesDeEstaApp());
    const estado = getEstado();
    try { actualizarBannerAlmacenamiento(estado); } catch (e) { /* solo un aviso visual */ }
    listeners.estadoCambio.forEach(fn => { try { fn(estado); } catch (e) { warn(e); } });
  }

  // -------------------------------------------------------------------------
  // INIT
  // -------------------------------------------------------------------------
  function init(cfg) {
    if (!cfg || !cfg.url || !cfg.anonKey || !cfg.app) {
      throw new Error('MypecarSync.init requiere { url, anonKey, app }.');
    }
    if (typeof global.supabase === 'undefined' || !global.supabase.createClient) {
      warn('No se encontró la librería @supabase/supabase-js. Verifica que su <script> esté ANTES de mypecar-sync.js. La app seguirá funcionando solo con localStorage hasta que se corrija.');
    } else {
      supabaseClient = global.supabase.createClient(cfg.url, cfg.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true }
      });
    }
    currentApp = cfg.app;
    // (2026-09-19) archivos que ya venían usados de antes guardan sus meses SIN comprimir: si el
    // cupo del navegador ya va por la mitad, se comprime lo heredado de una vez (evita llegar
    // al 100% en el próximo mes importado). No hace nada en un equipo con poco uso.
    try { if (LS && usoAlmacenamiento().porcentaje >= 50) compactarAlmacenamiento(null); } catch (e) { warn('No se pudo compactar el almacenamiento:', e); }

    window.addEventListener('online', () => { emitirEstadoCambio(); flushOutbox(); flushOutboxBorrados(); });
    window.addEventListener('offline', emitirEstadoCambio);
    if (flushTimer) clearInterval(flushTimer);
    // (2026-09-19) reintentar desde el temporizador: si el usuario liberó espacio, lo que solo estaba en memoria pasa a disco
    flushTimer = setInterval(() => { try { reintentarRespaldosEnMemoria(); } catch (e) { /* no crítico */ } flushOutbox(); flushOutboxBorrados(); }, RETRY_INTERVAL_MS);

    // (2026-10-16) verificación de versión mínima: al abrir y cada vez que se inicia sesión.
    if (supabaseClient) {
      try {
        supabaseClient.auth.onAuthStateChange((_ev, ses) => { if (ses) setTimeout(() => seguridad.verificarVersionMinima(), 1500); });
        setTimeout(() => seguridad.verificarVersionMinima(), 4000);
      } catch (e) { warn('No se pudo programar la verificación de versión:', e); }
    }
    log(`Inicializado para la app "${cfg.app}".`, supabaseClient ? 'Conectado a Supabase.' : 'SIN Supabase (modo local).');
    return getEstado();
  }

  function getEstado() {
    const pendientesEnCola = totalPendientesDeEstaApp();
    const pendienteDesde = lsGet(PENDIENTE_DESDE_KEY, null);
    const atascado = pendientesEnCola > 0 && !!pendienteDesde &&
      (Date.now() - new Date(pendienteDesde).getTime()) > ATASCADO_MS;
    return {
      online: navigator.onLine,
      conectadoASupabase: !!supabaseClient,
      empresaActiva: lsGet(EMPRESA_KEY, null),
      pendientesEnCola,
      pendienteDesde,
      atascado,
      ultimoError: ultimoErrorMemoria || lsGet(ULTIMO_ERROR_KEY, null),
      // ARREGLO (2026-09-19): estos dos campos viven SOLO en memoria (no dependen de que
      // localStorage acepte escribir): si el equipo se queda sin espacio, es justo cuando
      // no se puede guardar ni el aviso de que no se pudo guardar.
      almacenamientoLleno: erroresAlmacenamiento.size > 0,
      clavesSinGuardarLocal: Array.from(erroresAlmacenamiento.keys()),
      versionSync: VERSION_SYNC
    };
  }

  function onEstadoCambio(fn) { listeners.estadoCambio.push(fn); }

  // -------------------------------------------------------------------------
  // AUTENTICACIÓN
  // -------------------------------------------------------------------------
  const auth = {
    async registrarse(email, password) {
      requiereSupabase();
      const { data, error } = await supabaseClient.auth.signUp({ email, password });
      if (error) throw error;
      return data;
    },
    async iniciarSesion(email, password) {
      requiereSupabase();
      const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return data;
    },
    async enviarEnlaceMagico(email) {
      requiereSupabase();
      // (2026-11-13) el enlace del correo vuelve a la MISMA app desde la que se pidió
      // (debe estar permitido en Supabase > Authentication > URL Configuration > Redirect URLs).
      const volverA = location.origin + location.pathname;
      const { data, error } = await supabaseClient.auth.signInWithOtp({ email, options: { emailRedirectTo: volverA } });
      if (error) throw error;
      return data;
    },
    // (2026-11-13) Ingreso con cuenta de Google. Requiere activar el proveedor Google en
    // Supabase (Authentication > Providers). Redirige a Google y vuelve a esta misma página.
    async iniciarConGoogle() {
      requiereSupabase();
      const volverA = location.origin + location.pathname;
      const { data, error } = await supabaseClient.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: volverA } });
      if (error) throw error;
      return data;
    },
    // (2026-11-13) Deja constancia, en la cuenta del usuario, de qué versión de los Términos y la
    // Política de privacidad aceptó y cuándo. No cambia tablas: usa los datos del propio usuario.
    async registrarAceptacion(version) {
      requiereSupabase();
      const { data: { user } } = await supabaseClient.auth.getUser();
      if (!user) return false;
      const md = user.user_metadata || {};
      if (md.terminos_version === version) return true;
      const { error } = await supabaseClient.auth.updateUser({ data: { terminos_version: version, terminos_fecha: new Date().toISOString() } });
      if (error) throw error;
      return true;
    },
    async cerrarSesion() {
      requiereSupabase();
      await supabaseClient.auth.signOut();
      lsSet(EMPRESA_KEY, null);
      emitirEstadoCambio();
    },
    async sesionActual() {
      requiereSupabase();
      const { data } = await supabaseClient.auth.getSession();
      return data.session;
    },
    alCambiarSesion(callback) {
      requiereSupabase();
      supabaseClient.auth.onAuthStateChange((_evento, session) => callback(session));
    }
  };

  // -------------------------------------------------------------------------
  // EMPRESAS (tenants)
  // -------------------------------------------------------------------------
  const empresas = {
    // Crea la empresa y de una vez te vuelve "owner" (dueño) de ella.
    async crear({ ruc, razonSocial, nombreComercial }) {
      requiereSupabase();
      const { data: emp, error } = await supabaseClient.from('empresas')
        .insert({ ruc, razon_social: razonSocial, nombre_comercial: nombreComercial })
        .select().single();
      if (error) throw error;
      const { data: { user } } = await supabaseClient.auth.getUser();
      const { error: errMiembro } = await supabaseClient.from('empresa_usuarios')
        .insert({ empresa_id: emp.id, user_id: user.id, rol: 'owner' });
      if (errMiembro) throw errMiembro;
      return emp;
    },
    async listarMias() {
      requiereSupabase();
      const { data, error } = await supabaseClient.from('empresas').select('*').order('nombre_comercial');
      if (error) throw error;
      return data;
    },
    seleccionar(empresaId) {
      lsSet(EMPRESA_KEY, empresaId);
      emitirEstadoCambio();
    },
    activaId() { return lsGet(EMPRESA_KEY, null); },
    // Control de licenciamiento (2026-09-12): toda empresa nace "pendiente"
    // y solo el propio Carlos puede pasarla a "autorizada" (desde el Table
    // Editor de Supabase — el trigger de la base de datos ignora cualquier
    // intento de cambiarlo desde aquí). mypecar-login.js usa esto para
    // bloquear el acceso mientras una empresa sigue sin aprobar. Si la
    // consulta falla (sin internet en este instante), se cachea localmente
    // el último estado conocido y se confía en él — así una empresa YA
    // aprobada antes se sigue pudiendo abrir sin conexión, sin volver a
    // preguntarle a la nube cada vez.
    //
    // ARREGLO (16-sept) — "Reiniciar Todo" ahora también cuenta como
    // pendiente de revisión: la columna "estado" en sí NO se toca (la
    // protege el trigger de arriba, y no tiene sentido pelear con él), pero
    // se agregó una columna nueva "reinicio_pendiente_revision" que si está
    // en true, se trata exactamente igual que "pendiente" — ver
    // reiniciarComoNueva() más abajo y el script 116.01 del proyecto.
    // (2026-11-13) VENCIMIENTO DE LICENCIA. La empresa puede tener "vence_en" (fecha) y
    // "gracia_dias" (por defecto 15). Si no hay fecha, no vence nunca (empresas anteriores).
    // Pasada la fecha hay un periodo de gracia con acceso completo (para renovar o exportar);
    // terminado ese periodo, la empresa se trata como "vencida" y las apps no abren.
    // La nube también la pasa a "suspendida" sola (ver "132 vencimiento_licencias.sql").
    evaluarLicencia(lic) {
      if (!lic || !lic.vence_en) return null;
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(lic.vence_en));
      if (!m) return null;
      const venc = new Date(+m[1], +m[2] - 1, +m[3]);
      const ahora = new Date();
      const hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
      const dias = Math.round((venc - hoy) / 86400000);            // >0 faltan, 0 hoy, <0 ya venció
      const gracia = (lic.gracia_dias == null || isNaN(+lic.gracia_dias)) ? 15 : +lic.gracia_dias;
      const bloqueada = dias + gracia < 0;
      return {
        vence_en: String(lic.vence_en).slice(0, 10), gracia_dias: gracia, periodo_pago: lic.periodo_pago || null,
        dias, enGracia: dias < 0 && !bloqueada, bloqueada, diasDeGracia: bloqueada ? 0 : Math.max(0, dias + gracia)
      };
    },
    // Última licencia conocida de esa empresa (ya evaluada contra el reloj de este equipo).
    obtenerLicencia(empresaId) {
      return empresas.evaluarLicencia(lsGet('mps_licencia_' + empresaId, null));
    },
    async obtenerEstado(empresaId) {
      const cacheKey = 'mps_estado_empresa_' + empresaId;
      const licKey = 'mps_licencia_' + empresaId;
      if (!supabaseClient || !navigator.onLine) {
        // Sin conexión: se confía en lo último conocido; si había fecha de vencimiento se
        // vuelve a evaluar con el reloj de este equipo (null = nunca se verificó en línea).
        const ultimo = lsGet(cacheKey, null);
        if (ultimo === 'autorizada') {
          const ev = empresas.obtenerLicencia(empresaId);
          if (ev && ev.bloqueada) return 'vencida';
        }
        return ultimo;
      }
      try {
        const consulta = (cols) => supabaseClient.from('empresas').select(cols).eq('id', empresaId).single();
        let r = await consulta('estado, reinicio_pendiente_revision, vence_en, gracia_dias, periodo_pago');
        // Si todavía no se corrió "132 vencimiento_licencias.sql" en Supabase, esas columnas no
        // existen: se consulta como antes para que nada se rompa mientras tanto.
        if (r.error && /column|vence_en|gracia_dias|periodo_pago/i.test(String(r.error.message || ''))) {
          r = await consulta('estado, reinicio_pendiente_revision');
        }
        // Sin filas (HTTP 406 / PGRST116): la base de datos oculta la empresa a este usuario, lo que
        // ocurre cuando está suspendida. Se trata como suspendida, no como un error de conexión.
        if (r.error && (r.error.code === 'PGRST116' || r.status === 406 || /0 rows|no rows|multiple \(or no\) rows/i.test(String(r.error.message || '')))) {
          lsSet(cacheKey, 'suspendida'); lsSet(licKey, null);
          return 'suspendida';
        }
        if (r.error) throw r.error;
        const data = r.data;
        lsSet(licKey, data.vence_en ? { vence_en: data.vence_en, gracia_dias: data.gracia_dias, periodo_pago: data.periodo_pago } : null);
        let estadoEfectivo = data.reinicio_pendiente_revision ? 'pendiente' : data.estado;
        if (estadoEfectivo === 'autorizada') {
          const ev = empresas.evaluarLicencia(lsGet(licKey, null));
          if (ev && ev.bloqueada) estadoEfectivo = 'vencida';
        }
        lsSet(cacheKey, estadoEfectivo);
        return estadoEfectivo;
      } catch (e) {
        warn('No se pudo verificar el estado de la empresa (se usa el último conocido):', e);
        const ultimo = lsGet(cacheKey, null);
        if (ultimo === 'autorizada') {
          const ev = empresas.obtenerLicencia(empresaId);
          if (ev && ev.bloqueada) return 'vencida';
        }
        return ultimo;
      }
    },
    // Datos legales de la empresa (razón social, nombre comercial, RUC) tal
    // como quedaron guardados en Supabase al crearla o al reiniciarla como
    // nueva — ver reiniciarComoNueva() más abajo. Se usa para AUTO-POBLAR el
    // config local (razonSocial/nombreComercial/ruc) de cada app apenas se
    // detecta que ese config local todavía está en blanco (empresa recién
    // creada, o abierta por primera vez en este equipo) — así el encabezado y
    // los reportes de cada copia muestran SIEMPRE el dato real que se
    // ingresó al crear la empresa, sin que haya que volver a escribirlo a
    // mano en Ajustes de cada una de las 7 apps operativas.
    //
    // A propósito, esta función NO cachea localmente como obtenerEstado(): si
    // no hay conexión justo en este instante, simplemente no hay de dónde
    // auto-poblar todavía (se reintentará solo la próxima vez que la app
    // cargue con internet) — nunca debe sobreescribir un config local ya
    // guardado con un valor viejo de caché.
    async obtenerDatos(empresaId) {
      requiereSupabase();
      const { data, error } = await supabaseClient.from('empresas')
        .select('ruc, razon_social, nombre_comercial').eq('id', empresaId).single();
      if (error) throw error;
      return { ruc: data.ruc, razonSocial: data.razon_social, nombreComercial: data.nombre_comercial };
    },
    // Control de acceso por app (2026-09-16): el Contador Jefe (rol 'owner')
    // decide qué apps puede usar cada asistente. Mismo patrón de caché que
    // obtenerEstado — si no hay conexión justo en este instante, se confía en
    // el último resultado verificado en línea; si NUNCA se verificó en línea,
    // se devuelve null ("no se sabe") y quien llama debe tratarlo como
    // bloqueado (mejor pedir conexión una vez que dejar pasar por defecto,
    // tratándose de datos sensibles como planillas).
    async tieneAccesoApp(empresaId, app) {
      if (!app) return true; // no debería pasar, pero si no se supo determinar la app, no bloquear por un error propio
      const cacheKey = 'mps_acceso_app_' + empresaId + '_' + app;
      // Importante: si nunca se pudo verificar (offline, red caída, o incluso
      // si la función en Supabase todavía no existe porque no se corrió la
      // migración SQL), NO se debe bloquear al usuario. El valor por defecto
      // es "true" (permitir) para no dejar a todos fuera de todas las apps
      // por un problema técnico o por un orden de despliegue distinto al
      // esperado (JS actualizado antes que el script SQL). Solo se bloquea
      // cuando en algún momento SÍ se pudo consultar a Supabase y la
      // respuesta fue explícitamente "no tiene acceso" (quedó cacheada en false).
      if (!supabaseClient || !navigator.onLine) {
        return lsGet(cacheKey, true);
      }
      try {
        const { data, error } = await supabaseClient.rpc('usuario_tiene_acceso_app', { p_empresa_id: empresaId, p_app: app });
        if (error) throw error;
        lsSet(cacheKey, !!data);
        return !!data;
      } catch (e) {
        warn('No se pudo verificar el acceso a la app (se usa el último conocido, o se permite si nunca se verificó):', e);
        return lsGet(cacheKey, true);
      }
    },
    // ¿El usuario actual es el dueño (Contador Jefe) de esta empresa? Se usa
    // para decidir si se le muestra la opción "Gestionar accesos".
    async esOwner(empresaId) {
      if (!supabaseClient || !navigator.onLine) return false;
      try {
        const { data, error } = await supabaseClient.rpc('soy_owner_de_empresa', { p_empresa_id: empresaId });
        if (error) throw error;
        return !!data;
      } catch (e) {
        warn('No se pudo verificar si eres el dueño de la empresa:', e);
        return false;
      }
    },
    // Lista de miembros de la empresa CON su correo — solo devuelve datos si
    // quien llama es el dueño (lo exige la propia función en Supabase).
    async listarMiembros(empresaId) {
      requiereSupabase();
      const { data, error } = await supabaseClient.rpc('listar_miembros_empresa', { p_empresa_id: empresaId });
      if (error) throw error;
      return data || [];
    },
    // Cambia qué apps puede usar un miembro puntual — solo funciona si quien
    // llama es el dueño (lo exige la política de la base de datos; si no lo
    // es, Supabase simplemente no actualiza ninguna fila).
    async actualizarPermisosApp(empresaId, userId, appsPermitidas) {
      requiereSupabase();
      const { error } = await supabaseClient.from('empresa_usuarios')
        .update({ apps_permitidas: appsPermitidas })
        .eq('empresa_id', empresaId).eq('user_id', userId);
      if (error) throw error;
    },
    // Agrega a una persona a la empresa usando solo su correo (debe haber
    // creado su cuenta antes desde "Crear cuenta" en cualquiera de las 9
    // apps). Devuelve { ok:true } si quedó agregada, o { ok:false, motivo }
    // si no se pudo (correo no encontrado, ya es miembro, o quien llama no
    // es el dueño) — mypecar-login.js traduce "motivo" a un mensaje claro.
    async agregarMiembroPorCorreo(empresaId, correo, rol) {
      requiereSupabase();
      const { data, error } = await supabaseClient.rpc('invitar_miembro_por_correo', {
        p_empresa_id: empresaId, p_correo: correo, p_rol: rol || 'asistente'
      });
      if (error) throw error;
      return data;
    },
    // Invitaciones pendientes: personas que el dueño agregó por correo ANTES
    // de que ellas crearan su cuenta. El correo vive directo en esta tabla
    // (no en auth.users), así que aquí sí se puede leer/editar/borrar
    // directo — la política RLS ya exige ser el dueño de la empresa.
    async listarInvitacionesPendientes(empresaId) {
      requiereSupabase();
      const { data, error } = await supabaseClient.from('invitaciones_pendientes')
        .select('*').eq('empresa_id', empresaId).order('creado_en');
      if (error) throw error;
      return data || [];
    },
    async actualizarAppsInvitacionPendiente(invitacionId, appsPermitidas) {
      requiereSupabase();
      const { error } = await supabaseClient.from('invitaciones_pendientes')
        .update({ apps_permitidas: appsPermitidas }).eq('id', invitacionId);
      if (error) throw error;
    },
    async cancelarInvitacionPendiente(invitacionId) {
      requiereSupabase();
      const { error } = await supabaseClient.from('invitaciones_pendientes')
        .delete().eq('id', invitacionId);
      if (error) throw error;
    },
    // Co-dueño(a): para que la administración de accesos no dependa de una
    // sola persona si el Contador Jefe original deja la empresa.
    async hacerCodueno(empresaId, userId) {
      requiereSupabase();
      const { data, error } = await supabaseClient.rpc('hacer_codueno', {
        p_empresa_id: empresaId, p_user_id: userId
      });
      if (error) throw error;
      return data;
    },
    async quitarCodueno(empresaId, userId, nuevoRol) {
      requiereSupabase();
      const { data, error } = await supabaseClient.rpc('quitar_codueno', {
        p_empresa_id: empresaId, p_user_id: userId, p_nuevo_rol: nuevoRol || 'asistente'
      });
      if (error) throw error;
      return data;
    },
    // "Reiniciar Todo (Nueva Empresa)" en cualquiera de las 7 apps operativas
    // (01, 02, 03, 04, 05, 06, 09) llama a esto DESPUÉS de validar el código
    // de autorización localmente — ver el script 116.01 del proyecto para la
    // función en Supabase. Actualiza el RUC/razón social/nombre comercial en
    // la nube, marca la empresa como pendiente de revisión (sin tocar
    // "estado", que queda protegido por su propio trigger) y, del lado de la
    // nube, quita a todo el que no sea quien acaba de reiniciar — para que
    // el negocio nuevo no herede co-dueños ni asistentes del negocio
    // anterior — y cancela las invitaciones pendientes que hubiera.
    // (2026-11-20) Pago por Yape: el dueño declara su plan y su nombre en Yape; si el pago ya
    // llegó (o llega después), la nube activa la empresa sola. Ver funciones reportar_pago /
    // yape_registrar_pago en Supabase.
    async reportarPago(empresaId, plan, nombreYape) {
      requiereSupabase();
      const { data, error } = await supabaseClient.rpc('reportar_pago', {
        p_empresa_id: empresaId, p_plan: plan, p_nombre_yape: nombreYape
      });
      if (error) throw error;
      return data;
    },
    // Aviso al WhatsApp del administrador (registro de empresa / pago declarado). Nunca lanza error.
    async avisar(empresaId, tipo) {
      try {
        if (!supabaseClient || !supabaseClient.functions) return;
        await supabaseClient.functions.invoke('avisar', { body: { tipo, empresa_id: empresaId } });
      } catch (e) { /* el aviso es opcional */ }
    },
    async reiniciarComoNueva(empresaId, { ruc, razonSocial, nombreComercial }) {
      requiereSupabase();
      const { data, error } = await supabaseClient.rpc('reiniciar_empresa_como_nueva', {
        p_empresa_id: empresaId, p_ruc: ruc, p_razon_social: razonSocial, p_nombre_comercial: nombreComercial
      });
      if (error) throw error;
      // (2026-10-15b) La función de Supabase responde {ok:false, motivo} cuando no
      // te deja reiniciar (p.ej. no eres owner). Antes eso se ignoraba en silencio.
      if (data && data.ok === false) throw new Error('La nube rechazó el reinicio: ' + (data.motivo || 'sin motivo'));
      // El estado cacheado localmente queda obsoleto apenas se llama esto (la
      // nube ya quedó "pendiente de revisión") — se actualiza aquí mismo para
      // que la próxima verificación, incluso si fuera sin conexión, no siga
      // mostrando el estado viejo "autorizada".
      lsSet('mps_estado_empresa_' + empresaId, 'pendiente');
      return data;
    }
  };

  function requiereSupabase() {
    if (!supabaseClient) throw new Error('MypecarSync: Supabase no está configurado (revisa init()).');
  }
  function requiereEmpresaActiva() {
    const id = empresas.activaId();
    if (!id) throw new Error('MypecarSync: no hay una empresa seleccionada (usa MypecarSync.empresas.seleccionar()).');
    return id;
  }

  // -------------------------------------------------------------------------
  // FASE 1 — ESPEJO GENÉRICO (app_config): reemplazo casi directo de
  // storageGet/storageSet, o complemento de un localStorage.setItem directo.
  // -------------------------------------------------------------------------

  // =========================================================================
  // REINICIO DE DATOS DESDE LA NUBE (2026-09-24b, 6ta ronda)
  // =========================================================================
  // Para poder dejar una empresa "limpia" de verdad (en la nube Y en cada
  // equipo que alguna vez la abrió), la tabla "empresas" tiene una columna
  // "datos_reiniciados_en" (ver el script 127.01 del proyecto). Cuando Carlos
  // la marca con la fecha/hora actual (a la vez que borra en la nube las
  // filas de app_config de esa empresa), cada equipo, la próxima vez que abra
  // CUALQUIERA de las 9 apps con esa empresa activa, compara esa marca con la
  // última que ya aplicó ("mps_reinicio_visto_<empresa>"): si es nueva, borra
  // de este equipo TODOS los datos locales de esa empresa (de las 9 apps, que
  // comparten el mismo almacenamiento) y cualquier subida pendiente de esa
  // empresa, ANTES de que la app lea nada y antes de subir nada -- así los
  // datos viejos no pueden "resucitar" subiéndose otra vez desde un equipo
  // que todavía los tenía guardados.
  //
  // Devuelve 'ok' (verificado: no hay reinicio pendiente, o ya se aplicó),
  // o 'sin-verificar' (no se pudo consultar la nube justo ahora: quien llama
  // NO debe subir nada de esa empresa todavía).
  const reinicioVerificadoEstaCarga = new Set();
  let pullInicialHecho = false;
  function claveReinicioVisto(empresaId) { return 'mps_reinicio_visto_' + empresaId; }
  function purgarDatosLocalesDeEmpresa(empresaId) {
    const sufijo = '::emp_' + empresaId;
    let borradas = 0;
    clavesFisicasReales().forEach(fisica => {
      if (fisica.length <= sufijo.length || fisica.slice(-sufijo.length) !== sufijo) return;
      if (fisica.indexOf('mypecar_empresa_activa_nombre') === 0) return; // nombre del globito: no es un dato de la app
      try { STO.remove.call(LS, fisica); borradas++; } catch (e) { /* no crítico */ }
    });
    Array.from(respaldoMemoria.keys()).forEach(fisica => {
      if (fisica.slice(-sufijo.length) === sufijo) olvidarClaveEnMemoria(fisica);
    });
    // Pendientes de subida/borrado de esa empresa -- y los muy antiguos que
    // ni siquiera sabían de qué empresa eran -- ya no deben llegar a la nube.
    guardarOutbox(leerOutbox().filter(i => i && i.empresaId && i.empresaId !== empresaId));
    guardarOutboxBorrados(leerOutboxBorrados().filter(p => p && typeof p === 'object' && p.empresaId && p.empresaId !== empresaId));
    return borradas;
  }
  // ¿La empresa ACTIVA tuvo alguna vez un reinicio de datos desde la nube? Las
  // apps lo usan para NO sembrar datos de ejemplo en una empresa que se limpió
  // a propósito (una empresa nueva, que nunca se reinició, sí los sigue recibiendo).
  function empresaFueReiniciada() {
    const id = empresas.activaId();
    return !!(id && lsGet(claveReinicioVisto(id), null));
  }
  // "siempreConsultar": las subidas (flushOutbox/flushOutboxBorrados) consultan
  // SIEMPRE antes de subir, así una pestaña que quedó abierta mientras Carlos
  // corría el script de limpieza no puede volver a subir sus datos viejos.
  async function verificarReinicioDatos(empresaId, siempreConsultar) {
    if (!empresaId || !supabaseClient) return 'ok';
    if (!siempreConsultar && reinicioVerificadoEstaCarga.has(empresaId)) return 'ok';
    let data, error;
    try {
      ({ data, error } = await supabaseClient.from('empresas')
        .select('datos_reiniciados_en').eq('id', empresaId).maybeSingle());
    } catch (e) {
      warn('No se pudo verificar si los datos de la empresa fueron reiniciados (se reintentará):', e);
      return 'sin-verificar';
    }
    if (error) {
      const msg = String((error && (error.message || error.details)) || '');
      if (error.code === '42703' || /datos_reiniciados_en/.test(msg)) {
        // La columna todavía no existe (no se corrió el script 127.01): no hay
        // ningún reinicio que aplicar -- se sigue trabajando exactamente igual que antes.
        reinicioVerificadoEstaCarga.add(empresaId);
        return 'ok';
      }
      warn('No se pudo verificar si los datos de la empresa fueron reiniciados (se reintentará):', msg);
      return 'sin-verificar';
    }
    const marcaNube = data && data.datos_reiniciados_en ? String(data.datos_reiniciados_en) : null;
    if (marcaNube && lsGet(claveReinicioVisto(empresaId), null) !== marcaNube) {
      const borradas = purgarDatosLocalesDeEmpresa(empresaId);
      lsSet(claveReinicioVisto(empresaId), marcaNube);
      log(`Los datos de esta empresa fueron reiniciados en la nube (${marcaNube}): se limpiaron ${borradas} clave(s) locales de este equipo.`);
      // Avisa a las OTRAS pestañas abiertas con esta misma empresa para que se
      // recarguen sin volver a guardar lo que tenían en memoria.
      lsSet(REINICIO_SENAL_KEY, { empresaId, marca: marcaNube, en: Date.now() });
      // Si ESTA misma página ya tenía la app cargada con datos (el reinicio se
      // detectó después de arrancar, p.ej. desde el reintento automático de
      // subida), también ella tiene datos viejos en memoria: se recarga.
      if (pullInicialHecho && empresaId === empresaParaAislamiento()) {
        escriturasBloqueadasPorReinicio = true;
        avisarReinicioYRecargar();
      }
    }
    reinicioVerificadoEstaCarga.add(empresaId);
    return 'ok';
  }

  // Trae TODAS las claves guardadas en la nube para (empresa activa, app
  // actual) y las escribe en localStorage. Llamar UNA vez, al boot de la
  // app, antes de que la app lea sus propias claves de localStorage.
  async function pullAllPropio() {
    // Mientras se aplican los datos que vienen de la nube, se pausa el
    // interceptor de localStorage (ver instalarInterceptorLocalStorage) para
    // no volver a subir de inmediato lo que se acaba de bajar.
    interceptorPausado = true;
    try {
      if (!supabaseClient) return { aplicadas: 0, motivo: 'sin-supabase' };
      const empresaId = empresas.activaId();
      if (!empresaId) return { aplicadas: 0, motivo: 'sin-empresa' };
      if (!navigator.onLine) return { aplicadas: 0, motivo: 'sin-conexion' };

      // (2026-09-24b) Antes de traer/aplicar nada: ¿se reiniciaron los datos
      // de esta empresa desde la nube? (ver verificarReinicioDatos)
      if ((await verificarReinicioDatos(empresaId)) !== 'ok') {
        return { aplicadas: 0, motivo: 'excepcion-red' };
      }

      // Blindaje: si la llamada a Supabase falla a nivel de RED (no de datos) —
      // corte de conexión a mitad de la petición, DNS, CORS, un bloqueador de
      // contenido, un timeout — el propio fetch() del cliente de Supabase puede
      // RECHAZAR la promesa (lanzar una excepción) en vez de devolver { error }.
      // Sin este try/catch, esa excepción se escapaba de pullAll() y abortaba a
      // la mitad TODA la inicialización de la app que la llama (inicializarApp
      // nunca llegaba a poblar el selector de Mes/Periodo ni el Catálogo de
      // Cuentas) — la app se veía normal pero con esos campos vacíos, sin
      // ningún aviso visible de qué falló. Ahora, ante cualquier fallo de red,
      // simplemente se sigue trabajando con lo que ya había en localStorage,
      // igual que si no hubiera conexión — nunca se bloquea el arranque.
      let data, error;
      try {
        ({ data, error } = await supabaseClient.from('app_config')
          .select('clave, valor, actualizado_en')
          .eq('empresa_id', empresaId).eq('app', currentApp));
      } catch (e) {
        warn('pullAll: excepción de red al conectar con Supabase, se sigue solo con los datos locales:', e);
        return { aplicadas: 0, motivo: 'excepcion-red', error: e };
      }
      if (error) { warn('pullAll:', error.message); return { aplicadas: 0, motivo: 'error', error }; }

      let aplicadas = 0;
      const conflictos = [];
      (data || []).forEach(fila => {
        if (String(fila.clave).indexOf('snap_') === 0) return; // fotos de enlace entre módulos: no se copian al equipo
        const metaKey = '_meta_' + fila.clave;
        const metaLocal = lsGet(metaKey, null);
        // Si hay un cambio local sin sincronizar (en la cola) más nuevo que lo
        // que trae el servidor, no lo pisamos — se deja que el outbox lo suba.
        // ARREGLO (2026-09-24): solo cuenta como "en cola" si el pendiente es
        // de ESTA MISMA empresa (empresaId) -- pullAll() siempre trae datos de
        // la empresa activa (empresaId, en este scope), así que un pendiente
        // de OTRA empresa que por coincidencia usa el mismo nombre de clave ya
        // no debe bloquear que se traiga lo de la empresa activa.
        const enCola = outboxDeEstaApp().some(item => item.clave === fila.clave && (item.empresaId || empresaId) === empresaId);
        if (enCola) { conflictos.push({ clave: fila.clave, motivo: 'cambio local pendiente de subir' }); return; }
        // Igual de importante: si esta clave tiene un BORRADO local pendiente de
        // confirmar en la nube (ver removeClave), no hay que resucitarla trayéndola
        // de vuelta desde Supabase — el borrado todavía no llegó allá, pero ya es
        // la intención local vigente. Mismo aislamiento por empresa que arriba.
        const borradoEnCola = borradosDeEstaApp().some(p => (typeof p === 'string' ? p === fila.clave : (p.clave === fila.clave && (p.empresaId || empresaId) === empresaId)));
        if (borradoEnCola) { conflictos.push({ clave: fila.clave, motivo: 'borrado local pendiente de confirmar' }); return; }
        // Ver MARCADOR_VALOR_NULO/push() arriba: si lo que bajó de la nube es
        // ese marcador, se vuelve a convertir en `null` — para el código de
        // cada app, es exactamente como si nunca se hubiera subido nada.
        // ARREGLO (2026-09-19): con la compresión (ver leerTexto/escribirTexto), reescribir
        // en cada apertura TODOS los periodos que ya están al día costaría casi un segundo
        // por periodo grande, sin cambiar nada. Si lo guardado aquí ya es EXACTAMENTE esa
        // versión de la nube (misma marca de tiempo, y vino de la nube), no se reescribe.
        if (metaLocal && metaLocal.origen === 'nube' && metaLocal.actualizado_en === fila.actualizado_en && leerTexto(fila.clave) !== null) { aplicadas++; return; }
        lsSet(fila.clave, esMarcadorValorNulo(fila.valor) ? null : fila.valor);
        lsSet(metaKey, { actualizado_en: fila.actualizado_en, origen: 'nube' });
        aplicadas++;
      });
      if (conflictos.length) {
        lsSet(SESSION_LOG_KEY, conflictos);
        warn('Claves no actualizadas porque tenían cambios locales pendientes:', conflictos);
      }
      return { aplicadas, conflictos };
    } finally {
      interceptorPausado = false;
      pullInicialHecho = true;
      try { if (typeof enlace !== 'undefined') enlace.programar(9000); } catch (e) {}
    }
  }


  // =========================================================================
  // CATÁLOGO MAESTRO EN 04 LIBRO DIARIO (2026-10-11, pedido de Carlos)
  // =========================================================================
  // Problema reportado: en 04 Libro Diario estaban configurados los destinos
  // (Clase 9) de 62511 y 62611, pero 02 Compras bloqueaba el Asiento Resumen
  // con "Falta configurar el destino". Causa: cada app guardaba su PROPIA
  // copia de "Destinos por Cuenta" y de "Cuentas Personalizadas" (claves
  // distintas: comprapollo_config, cajabancos_config, personal_config...), y
  // ninguna leía lo del Diario.
  //
  // Decisión de Carlos: el 04 Libro Diario es el CATÁLOGO MAESTRO. Todo
  // destino (Clase 9) y toda cuenta nueva con su denominación que se
  // registre allí se aplica sola a las demás apps que los usan:
  //   01 Ventas    -> cuentas personalizadas
  //   02 Compras   -> destinos + cuentas personalizadas
  //   03 Caja      -> destinos + cuentas personalizadas
  //   05 Personal  -> destinos
  // (06 y 09 no usan ninguno de los dos; 07 y 08 ya toman el catálogo del
  // JSON exportado desde el Diario.)
  //
  // Cómo funciona: al abrir cada una de esas apps, justo después de traer
  // sus propios datos de la nube (pullAll) y ANTES de que la app lea su
  // configuración, se toma el catálogo del Diario (de la nube si hay
  // conexión; si no, de la copia local del Diario en este mismo equipo, si
  // existe) y se mezcla en la configuración local de la app:
  //   - Lo que está en el Diario MANDA: mismo código -> se usa el destino y
  //     la denominación del Diario.
  //   - Lo que solo existe en la app (aún no está en el Diario) se conserva,
  //     para no dejar huérfano ningún registro ya hecho con esa cuenta.
  // Solo se mezcla sobre una configuración que ya exista en este equipo
  // (nunca se crea una desde cero, para no alterar el arranque de una
  // empresa nueva). Si no hay ningún catálogo del Diario disponible, la app
  // sigue exactamente como antes.
  //
  // Lectura en la nube: la tabla app_config está protegida por app (un
  // asistente con acceso solo a Compras no puede leer filas de 'diario'). Por
  // eso se usa la función leer_catalogo_maestro_diario() (SQL
  // "129.01 catalogo_maestro_diario.sql"), que entrega a cualquier miembro de
  // la empresa SOLO los destinos y las cuentas personalizadas del Diario,
  // nada más de su configuración. Si esa función aún no se instaló, se usa
  // la copia local del Diario y no se interrumpe nada.
  const MAESTRO_CONFIG_KEY = 'libro_diario_config';
  const MAESTRO_CUENTAS_KEY = 'libro_diario_custom_accounts';
  const APPS_CON_CATALOGO_MAESTRO = {
    ventas:   { cuentas: 'vendepollo_custom_accounts' },
    compras:  { config: 'comprapollo_config', cuentas: 'comprapollo_custom_accounts' },
    caja:     { config: 'cajabancos_config',  cuentas: 'cajabancos_custom_accounts' },
    personal: { config: 'personal_config' }
  };
  let ultimoCatalogoMaestro = null; // resultado de la última aplicación (diagnóstico)

  function marcaTiempo(v) { const t = v ? Date.parse(v) : NaN; return isNaN(t) ? 0 : t; }

  // Catálogo del Diario guardado en ESTE equipo (si el Diario se abrió aquí
  // con la empresa activa -- la copia local ya está aislada por empresa).
  function catalogoMaestroLocal() {
    const cfg = lsGet(MAESTRO_CONFIG_KEY, null);
    const cuentas = lsGet(MAESTRO_CUENTAS_KEY, null);
    const metaCfg = lsGet('_meta_' + MAESTRO_CONFIG_KEY, null);
    const metaCtas = lsGet('_meta_' + MAESTRO_CUENTAS_KEY, null);
    return {
      destinos: (cfg && typeof cfg === 'object' && cfg.destinosPorCuenta && typeof cfg.destinosPorCuenta === 'object') ? cfg.destinosPorCuenta : null,
      destinosEn: metaCfg ? marcaTiempo(metaCfg.actualizado_en) : 0,
      cuentas: Array.isArray(cuentas) ? cuentas : null,
      cuentasEn: metaCtas ? marcaTiempo(metaCtas.actualizado_en) : 0
    };
  }

  // Catálogo del Diario en la NUBE (vía la función segura, ver arriba).
  async function catalogoMaestroNube() {
    const vacio = { destinos: null, destinosEn: 0, cuentas: null, cuentasEn: 0, motivo: null };
    if (!supabaseClient) return { ...vacio, motivo: 'sin-supabase' };
    const empresaId = empresas.activaId();
    if (!empresaId) return { ...vacio, motivo: 'sin-empresa' };
    if (!navigator.onLine) return { ...vacio, motivo: 'sin-conexion' };
    let data, error;
    try {
      ({ data, error } = await supabaseClient.rpc('leer_catalogo_maestro_diario', { p_empresa_id: empresaId }));
    } catch (e) { return { ...vacio, motivo: 'excepcion-red' }; }
    if (error) { warn('Catálogo maestro (Diario): no se pudo leer de la nube (¿falta correr el SQL 129.01?):', error.message); return { ...vacio, motivo: 'error' }; }
    const out = { ...vacio };
    (data || []).forEach(fila => {
      const valor = esMarcadorValorNulo(fila.valor) ? null : fila.valor;
      if (fila.clave === MAESTRO_CONFIG_KEY && valor && typeof valor.destinosPorCuenta === 'object' && valor.destinosPorCuenta) {
        out.destinos = valor.destinosPorCuenta; out.destinosEn = marcaTiempo(fila.actualizado_en);
      } else if (fila.clave === MAESTRO_CUENTAS_KEY && Array.isArray(valor)) {
        out.cuentas = valor; out.cuentasEn = marcaTiempo(fila.actualizado_en);
      }
    });
    return out;
  }

  // Se queda con la versión más reciente de cada parte (local vs. nube): si en
  // este equipo el Diario guardó algo que todavía no subió, eso es lo vigente.
  async function obtenerCatalogoMaestro() {
    const local = catalogoMaestroLocal();
    const nube = await catalogoMaestroNube();
    const elegir = (vl, tl, vn, tn) => {
      if (vl && vn) return tl > tn ? vl : vn;
      return vl || vn || null;
    };
    return {
      destinos: elegir(local.destinos, local.destinosEn, nube.destinos, nube.destinosEn),
      cuentas: elegir(local.cuentas, local.cuentasEn, nube.cuentas, nube.cuentasEn),
      motivoNube: nube.motivo
    };
  }

  let ultimoMaestro = null; // { destinos, cuentas } leído en el último pullAll (para mezclar en memoria)

  // Mezcla (muta) un objeto de destinos con los del Diario. Devuelve cuántos cambió.
  function mezclarDestinos(destinosApp, destinosMaestro) {
    let n = 0;
    Object.keys(destinosMaestro || {}).forEach(cta => {
      const d = destinosMaestro[cta];
      if (d && destinosApp[cta] !== d) { destinosApp[cta] = d; n++; }
    });
    return n;
  }
  // Mezcla (muta) una lista de cuentas personalizadas con las del Diario.
  function mezclarCuentas(lista, cuentasMaestro) {
    let n = 0;
    (cuentasMaestro || []).forEach(cm => {
      if (!cm || !cm.codigo) return;
      const codigo = String(cm.codigo).trim();
      const nombre = String(cm.nombre || '').trim();
      if (!codigo || !nombre) return;
      const existente = lista.find(c => c && String(c.codigo) === codigo);
      if (existente) {
        if (existente.nombre !== nombre) { existente.nombre = nombre; n++; }
        if (cm.grupo && !existente.grupo) existente.grupo = cm.grupo;
      } else {
        const nueva = { codigo, nombre };
        if (cm.grupo) nueva.grupo = cm.grupo;
        lista.push(nueva); n++;
      }
    });
    return n;
  }
  // Para la app que ya tiene su config y su lista de cuentas EN MEMORIA (p.ej. la
  // primera vez que se abre en un equipo, cuando aún no había nada guardado que
  // mezclar en pullAll): aplica el último catálogo del Diario sobre esos objetos.
  // No guarda nada -- la app lo guardará cuando guarde su configuración.
  function mezclarCatalogoMaestroEn(configApp, cuentasApp) {
    const r = { destinos: 0, cuentas: 0 };
    if (!ultimoMaestro) return r;
    if (configApp && typeof configApp === 'object' && ultimoMaestro.destinos) {
      if (!configApp.destinosPorCuenta || typeof configApp.destinosPorCuenta !== 'object') configApp.destinosPorCuenta = {};
      r.destinos = mezclarDestinos(configApp.destinosPorCuenta, ultimoMaestro.destinos);
    }
    if (Array.isArray(cuentasApp) && ultimoMaestro.cuentas) r.cuentas = mezclarCuentas(cuentasApp, ultimoMaestro.cuentas);
    return r;
  }

  async function aplicarCatalogoMaestro() {
    const destino = APPS_CON_CATALOGO_MAESTRO[currentApp];
    if (!destino) return { aplicado: false, motivo: 'app-no-usa-catalogo' };
    if (escriturasBloqueadasPorReinicio) return { aplicado: false, motivo: 'reinicio' };
    const maestro = await obtenerCatalogoMaestro();
    ultimoMaestro = { destinos: maestro.destinos, cuentas: maestro.cuentas };
    const res = { aplicado: false, destinosActualizados: 0, cuentasActualizadas: 0, motivoNube: maestro.motivoNube };

    // 1) Destinos por Cuenta (Clase 9) -> config.destinosPorCuenta de la app
    if (destino.config && maestro.destinos) {
      const cfg = lsGet(destino.config, null);
      if (cfg && typeof cfg === 'object') {
        const antes = JSON.stringify(cfg.destinosPorCuenta || null);
        const mezcla = { ...(cfg.destinosPorCuenta && typeof cfg.destinosPorCuenta === 'object' ? cfg.destinosPorCuenta : {}) };
        res.destinosActualizados = mezclarDestinos(mezcla, maestro.destinos);
        if (JSON.stringify(mezcla) !== antes) { cfg.destinosPorCuenta = mezcla; lsSet(destino.config, cfg); res.aplicado = true; }
      }
    }

    // 2) Cuentas personalizadas (código + denominación)
    if (destino.cuentas && maestro.cuentas) {
      const lista = lsGet(destino.cuentas, null);
      if (Array.isArray(lista)) {
        const antes = JSON.stringify(lista);
        res.cuentasActualizadas = mezclarCuentas(lista, maestro.cuentas);
        if (JSON.stringify(lista) !== antes) { lsSet(destino.cuentas, lista); res.aplicado = true; }
      }
    }
    if (res.aplicado) log('Catálogo maestro del Libro Diario aplicado:', res);
    ultimoCatalogoMaestro = res;
    return res;
  }

  // pullAll() público = los datos propios de la app + el catálogo maestro del
  // Diario. Las apps no cambian: siguen llamando a MypecarSync.pullAll() al
  // inicio, antes de leer su configuración. Aunque la nube falle, el
  // catálogo igual se intenta aplicar con lo que haya en este equipo.
  async function pullAll() {
    const resultado = await pullAllPropio();
    try {
      const cat = await aplicarCatalogoMaestro();
      if (resultado && typeof resultado === 'object') resultado.catalogoMaestro = cat;
    } catch (e) { warn('No se pudo aplicar el catálogo maestro del Libro Diario (se sigue con el catálogo propio de la app):', e); }
    return resultado;
  }

  // Si el Diario está abierto en OTRA pestaña y cambia un destino o una
  // cuenta, se avisa aquí para recargar (sin recargar a la fuerza: podría
  // haber un comprobante a medio registrar).
  let avisoCatalogoMostrado = false;
  function avisarCatalogoMaestroCambiado() {
    if (avisoCatalogoMostrado) return;
    avisoCatalogoMostrado = true;
    try {
      const aviso = document.createElement('div');
      aviso.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:2147483646;background:#4338ca;color:#fff;padding:10px 16px;border-radius:10px;font:600 13px -apple-system,Segoe UI,Roboto,Arial,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.3);display:flex;gap:12px;align-items:center;max-width:92vw;';
      const txt = document.createElement('span');
      txt.textContent = '📒 En el Libro Diario se agregó o cambió una cuenta o un destino (Clase 9). Termina lo que estás registrando y pulsa Recargar para verlo en esta página.';
      const btn = document.createElement('button');
      btn.textContent = 'Recargar';
      btn.style.cssText = 'background:#fff;color:#4338ca;border:0;border-radius:6px;padding:6px 10px;font-weight:700;cursor:pointer;white-space:nowrap;';
      btn.onclick = function () { try { location.reload(); } catch (e) {} };
      const cerrar = document.createElement('button');
      cerrar.textContent = 'Ahora no';
      cerrar.style.cssText = 'background:transparent;color:#fff;border:1px solid rgba(255,255,255,.6);border-radius:6px;padding:6px 10px;font-weight:600;cursor:pointer;white-space:nowrap;';
      cerrar.onclick = function () { try { aviso.remove(); } catch (e) {} };
      aviso.appendChild(txt); aviso.appendChild(btn); aviso.appendChild(cerrar);
      (document.body || document.documentElement).appendChild(aviso);
    } catch (e) { /* no crítico */ }
  }
  // (2026-10-18) Antes bastaba con que OTRA pestaña guardara CUALQUIER cosa de la
  // configuración del Diario (un ajuste, un cierre de mes...) para que saliera el aviso
  // aunque los Destinos y las Cuentas Personalizadas no hubieran cambiado. Ahora se
  // compara solo esa parte del contenido (ya descomprimido) antes y después.
  function huellaCatalogoMaestro(claveFisicaCambiada, raw) {
    if (raw === null || raw === undefined) return 'null';
    let obj = null;
    try { obj = JSON.parse(descomprimirCrudo(raw)); } catch (e) { return 'ilegible:' + String(raw).length; }
    const emp = empresaParaAislamiento();
    if (claveFisicaCambiada === claveFisicaParaEmpresa(MAESTRO_CONFIG_KEY, emp)) {
      return JSON.stringify((obj && typeof obj === 'object' && obj.destinosPorCuenta) ? obj.destinosPorCuenta : null);
    }
    return JSON.stringify(Array.isArray(obj) ? obj : null);
  }
  function catalogoMaestroCambioDeVerdad(ev) {
    try { return huellaCatalogoMaestro(ev.key, ev.oldValue) !== huellaCatalogoMaestro(ev.key, ev.newValue); }
    catch (e) { return true; } // ante la duda, avisar
  }
  function esCambioDelCatalogoMaestro(claveFisicaCambiada) {
    if (!claveFisicaCambiada || !APPS_CON_CATALOGO_MAESTRO[currentApp]) return false;
    const emp = empresaParaAislamiento();
    return [MAESTRO_CONFIG_KEY, MAESTRO_CUENTAS_KEY].some(k => claveFisicaCambiada === claveFisicaParaEmpresa(k, emp));
  }

  // -------------------------------------------------------------------------
  // INTERCEPTOR de localStorage.setItem — para apps que guardan en
  // localStorage DIRECTO en muchos lugares del código (02 Compras, 05
  // Personal, 06 Activos Fijos, 07 Reportes, 08 Auditoría), en vez de tener
  // que agregar `MypecarSync.push(...)` a mano después de cada
  // localStorage.setItem ya existente (fácil de que se escape alguno en un
  // archivo de miles de líneas). Se llama UNA vez, apenas cargado este
  // archivo (antes de que la app haga cualquier localStorage.setItem):
  // cada escritura normal de la app sigue funcionando exactamente igual
  // (sigue yendo a localStorage primero, instantáneo), y además queda
  // encolada para subir a la nube — salvo las claves internas de esta misma
  // librería (la cola, la empresa activa, los metadatos), que nunca se
  // deben subir como si fueran datos de la app.
  // -------------------------------------------------------------------------
  function instalarInterceptorLocalStorage() {
    if (interceptorInstalado) return;
    interceptorInstalado = true;
    // ARREGLO (2026-09-16): faltaban aquí OUTBOX_BORRADOS_KEY y las dos claves
    // nuevas de diagnóstico (PENDIENTE_DESDE_KEY, ULTIMO_ERROR_KEY). Como esta
    // librería misma escribe esas claves con localStorage.setItem (a través de
    // lsSet), y este interceptor reemplaza ESE MISMO localStorage.setItem para
    // toda la página, cualquier escritura de la cola de borrados terminaba
    // siendo tratada como si fuera un dato más de la app — se encolaba y se
    // subía a Supabase como una fila de app_config falsa (clave
    // "mypecar_sync_outbox_borrados"), inflando artificialmente el contador de
    // "pendientes" que ve el Contador en el encabezado, sin que jamás bajara a
    // cero del todo. Afecta a las apps que usan este interceptor (02, 05, 06).
    const clavesInternas = CLAVES_INTERNAS;
    const setItemOriginal = localStorage.setItem.bind(localStorage);
    localStorage.setItem = function (key, value) {
      setItemOriginal(key, value);
      if (interceptorPausado) return;
      if (clavesInternas.indexOf(key) !== -1) return;
      if (key.indexOf('_meta_') === 0) return;
      // (2026-09-24b) Tampoco se suben claves propias del sistema (mps_*,
      // mypecar_*: p.ej. el nombre del globito que guarda mypecar-login.js) --
      // no son datos de la app y no tienen nada que hacer en app_config.
      if (!esClaveDeDatos(String(key))) return;
      let valorParseado;
      try { valorParseado = JSON.parse(value); }
      catch (e) { return; } // no era JSON (raro en estas apps) — no se sincroniza
      push(key, valorParseado).catch(e => warn('No se pudo encolar', key, e));
    };
    log('Interceptor de localStorage instalado — todo localStorage.setItem futuro se sincroniza solo.');
  }

  // Reemplazo de storageGet(key, fallback) — firma idéntica a la que ya usan
  // 01/03/04/09. Lee de localStorage (rápido, funciona sin internet).
  async function storageGet(key, fallback) {
    return lsGet(key, fallback);
  }

  // Reemplazo de storageSet(key, value) — guarda local YA MISMO (para que la
  // app nunca espere a la red) y encola la subida a Supabase.
  //
  // Blindaje (2026-09-18, mismo diagnóstico que el de push() más abajo): si
  // este guardado LOCAL directo falla (por ejemplo, sin espacio de guardado
  // en este equipo), antes quedaba solo un aviso discreto en la consola del
  // navegador -- nunca visible para el Contador, que seguía viendo "Todo
  // guardado" en el encabezado. Ahora se deja un registro explícito y
  // consultable (ver getEstado().ultimoError) para que la app pueda mostrar
  // un aviso real en vez de una falsa tranquilidad.
  async function storageSet(key, value) {
    const guardadoLocalOk = lsSet(key, value);
    lsSet('_meta_' + key, { actualizado_en: new Date().toISOString(), origen: 'local' });
    if (!guardadoLocalOk) {
      setUltimoError(`No se pudo guardar "${key}" en este equipo (sin espacio de guardado disponible).`);
    }
    await push(key, value);
  }

  // Encola (o envía de inmediato, si hay conexión) una clave para subir a
  // app_config. Úsalo directo si tu app ya hace localStorage.setItem por su
  // cuenta (caso de 02, 05, 06) y solo quieres avisarle a la nube.
  //
  // ARREGLO (2026-09-18, causa raíz real de "importé 2447 comprobantes, cerré,
  // reabrí y TODO está en cero" -- reproducido con la propia consola de Carlos:
  // "QuotaExceededError: Failed to execute 'setItem' on 'Storage': Setting the
  // value of 'mypecar_sync_outbox' exceeded the quota", con la pila apuntando
  // exactamente a esta función, llamada desde storageSet -> persistActivePeriod
  // -> ejecutarImportacion). Antes, el objeto encolado aquí guardaba una
  // SEGUNDA copia COMPLETA del valor (item.valor = valorASubir) además de la
  // copia que storageSet() YA había guardado un instante antes bajo su propia
  // clave (p.ej. "vendepollo_periods__2030-01"). Para una venta suelta eso no
  // se nota, pero para el periodo recién importado con 2447 comprobantes
  // (~1.2 MB en JSON), guardar ESA MISMA información DOS VECES en el mismo
  // origen -- su propia clave + otra copia dentro de la cola -- podía por sí
  // solo superar el cupo de guardado del navegador (localStorage típicamente
  // ronda 5-10 MB por origen, y en un archivo usado por semanas, con muchos
  // periodos y meses de historial ya acumulados, ese margen se agota rápido).
  // El error quedaba atrapado en silencio dentro de lsSet() (ver más arriba)
  // -- la cola nunca se enteraba de que le faltó ese comprobante grande, así
  // que ni se subía a la nube ni había ningún aviso visible: la pantalla
  // seguía mostrando el aviso verde y "Todo guardado" con total normalidad.
  //
  // Ahora la cola SOLO guarda un "puntero" livianísimo (clave + número de
  // versión) -- nunca el valor en sí. Al momento de subir de verdad (ver
  // flushOutbox() más abajo), se relee el valor ACTUAL directo de su propia
  // clave en localStorage -- que es, de todos modos, la única copia que
  // importa (si mientras tanto se volvió a guardar una versión más nueva de
  // esa misma clave, es justamente esa versión más nueva la que se debe
  // subir). Así, la cola nunca vuelve a pesar más que unos pocos cientos de
  // bytes por cambio pendiente, sin importar cuán grande sea la información
  // real -- y una importación masiva ya no puede quedarse sin espacio por
  // culpa de su propia copia de respaldo.
  async function push(clave, valor) {
    // "valor" ya no se usa aquí (ver el ARREGLO de arriba) -- se conserva el
    // parámetro solo para no romper a quien ya llama a push(clave, valor)
    // desde fuera de este archivo (el interceptor de localStorage, más abajo).
    //
    // ARREGLO (2026-09-24): cada pendiente ahora recuerda BAJO QUÉ EMPRESA se
    // encoló (empresaId) -- si el usuario cambia de empresa antes de que esto
    // se suba (ver flushOutbox más abajo), el pendiente sigue subiéndose a SU
    // empresa original, nunca a la que quede activa en ese momento. Por eso
    // el "ya encolado" (para no duplicar una misma clave en cola) ahora
    // compara clave+empresa, no solo clave -- dos empresas distintas SÍ
    // pueden tener, cada una, su propio pendiente de "vendepollo_config" al
    // mismo tiempo.
    const empresaId = empresas.activaId();
    const outbox = leerOutbox();
    if (escriturasBloqueadasPorReinicio) return; // (2026-09-24b) ver escribirTexto
    // (2026-10-15) un pendiente antiguo sin empresa cuenta como de la empresa activa: se reemplaza, no se duplica
    const yaEncolado = outbox.findIndex(item => item.clave === clave && (item.empresaId || empresaId || null) === (empresaId || null) && esDeEstaApp(item));
    const item = { clave, empresaId: empresaId || null, app: currentApp || null, encoladoEn: new Date().toISOString(), seq: ++outboxSeqCounter };
    if (yaEncolado >= 0) outbox[yaEncolado] = item; else outbox.push(item);
    const guardadoOk = guardarOutbox(outbox);
    if (!guardadoOk) {
      // Blindaje adicional: si, aun así (por ejemplo con un cupo YA agotado de
      // entrada por otra causa), no se pudo ni guardar el puntero liviano en
      // la cola, se avisa de forma explícita e inconfundible -- nunca en
      // silencio -- para que la pantalla dependiente de getEstado() pueda
      // mostrar un aviso real en vez de "Todo guardado".
      setUltimoError(`No se pudo encolar "${clave}" en el disco de este equipo (sin espacio) — se sube desde la memoria de esta sesión.`);
    }
    emitirEstadoCambio();
    await flushOutbox();
    try { if (typeof enlace !== 'undefined') enlace.programar(); } catch (e) {}
  }

  // Sube a Supabase todo lo que esté en la cola. Se llama sola cada
  // RETRY_INTERVAL_MS y al recuperar la conexión — pero también puedes
  // llamarla a mano después de una acción importante (ej. tras registrar
  // una venta) si quieres intentar subir de inmediato.
  //
  // ARREGLO (2026-09-16) — condición de carrera que perdía datos ya
  // guardados: esta función puede quedar "en el aire" varios segundos (cada
  // `await` de la subida cede el control) y mientras tanto puede dispararse
  // OTRA subida en paralelo — el reintento automático cada 15s, el aviso de
  // "volvió la conexión", o el guardado de un nuevo cambio. Antes, cada
  // llamada tomaba una "foto" de la cola al empezar y, al terminar,
  // SOBREESCRIBÍA toda la cola con esa foto — si mientras tanto había llegado
  // un cambio más nuevo para la misma clave (p.ej. se siguió registrando
  // ventas de agosto), esa versión más nueva podía (a) perderse de la cola
  // sin haberse subido nunca, o peor, (b) subirse una versión más VIEJA
  // *después* de que ya se hubiera subido la nueva, dejando la nube con
  // datos desactualizados — exactamente el síntoma de "subí la información
  // pero al rato ya no está". Ahora: (1) solo puede haber una subida en
  // marcha a la vez (si ya hay una en curso, la nueva llamada solo pide que
  // se repita el intento apenas termine la actual, sin tocar nada); y (2) al
  // terminar de subir cada clave, se quita de la cola SOLO si en la cola
  // actual (releída en ese momento, no la foto del principio) sigue estando
  // exactamente esa misma versión — si ya hay una más nueva en su lugar, se
  // deja intacta para la siguiente pasada, nunca se pierde ni se pisa.
  //
  // ARREGLO (2026-09-18, causa raíz real de "importé, cerré, reabrí y todo
  // está en cero" — ver "117.1 Diagnostico_y_Arreglo_Ceros_Tras_Importacion_
  // Masiva" en el proyecto): esta función subía las claves pendientes UNA POR
  // UNA -- cada `await` esperaba el viaje de ida y vuelta completo a la nube
  // antes de recién empezar con la siguiente. Para un cambio suelto (una
  // venta nueva) eso no se nota. Pero tras una IMPORTACIÓN MASIVA (miles de
  // comprobantes de un solo golpe), quedan en cola de 9 a 10 claves distintas
  // (el periodo recién importado + config, clientes, catálogo de cuentas,
  // etc.) -- y como cada una esperaba su propio viaje completo a la nube,
  // subir TODO el backlog podía tardar fácilmente medio minuto o más en una
  // conexión normal. En 01 Ventas (y cualquier otra app que usara
  // storageGet/storageSet de forma "await"ada durante el arranque), el
  // arranque de la app esperaba a que ESTO terminara antes de pintar los
  // números en pantalla -- así que, si se cerraba y volvía a abrir el
  // archivo antes de que ese medio minuto pasara, se veía "0" en todos
  // lados. Los datos NUNCA se perdían (seguían intactos en este equipo, en
  // localStorage) -- era la PANTALLA la que no había terminado de pintarlos
  // todavía (ver también el arreglo correspondiente en cada inicializarApp()
  // que ya no espera a persistAll() para pintar). Ahora, además, se suben
  // varias claves JUNTAS, en un solo viaje a la nube por lote (hasta
  // TAMANO_LOTE_SUBIDA claves), así que una importación grande se confirma
  // con la nube en 1-2 viajes en vez de 9-10 -- y ya no hace falta esperar
  // tanto para empezar.
  const TAMANO_LOTE_SUBIDA = 15;

  async function flushOutbox() {
    if (flushEnCurso) { reintentoTrasFlush = true; return { subidas: 0, motivo: 'flush-ya-en-curso' }; }
    if (!supabaseClient || !navigator.onLine) return { subidas: 0, motivo: 'sin-conexion-o-supabase' };

    const outboxInicial = outboxDeEstaApp();
    if (outboxInicial.length === 0) return { subidas: 0 };

    flushEnCurso = true;
    let subidas = 0;
    try {
      const { data: { user } } = await supabaseClient.auth.getUser().catch(() => ({ data: { user: null } }));
      // ARREGLO (2026-09-24, ver push() más arriba): cada pendiente recuerda
      // bajo qué empresa se encoló -- si mientras tanto se cambió de empresa
      // activa (ver empresas.seleccionar), lo pendiente de la empresa
      // anterior debe seguir subiéndose a SU propia empresa_id, con SU
      // propio valor local (aislado por empresa, ver leerTextoParaEmpresa),
      // nunca a la que esté activa en este instante. Se agrupa por empresa
      // antes de subir. Los pendientes muy antiguos, encolados antes de este
      // arreglo (sin empresaId guardado), se suben a la empresa activa
      // actual -- igual que se comportaban siempre.
      const empresaActivaAhora = empresas.activaId();
      const grupos = new Map(); // empresaId -> [items]
      outboxInicial.forEach(item => {
        const emp = item.empresaId || empresaActivaAhora;
        if (!emp) return; // nunca hubo ninguna empresa seleccionada -- no hay a quién subírselo
        if (!grupos.has(emp)) grupos.set(emp, []);
        grupos.get(emp).push(item);
      });

      for (const [empresaId, itemsEmpresa] of grupos) {
        // (2026-09-24b) Antes de subir NADA de una empresa, se confirma con la
        // nube que sus datos no fueron reiniciados (ver verificarReinicioDatos):
        // si lo fueron, estos pendientes son datos viejos que NO deben volver
        // a subirse -- se descartan junto con la copia local. Si no se pudo
        // confirmar (red caída), se dejan en cola para el próximo intento.
        const verif = await verificarReinicioDatos(empresaId, true);
        if (verif !== 'ok') continue;
        for (let i = 0; i < itemsEmpresa.length; i += TAMANO_LOTE_SUBIDA) {
          const lote = itemsEmpresa.slice(i, i + TAMANO_LOTE_SUBIDA);
          // Mismo blindaje que antes: si esta subida falla por una excepción de
          // RED (no por un { error } normal de Supabase), no se deja escapar —
          // se trata igual que cualquier otro fallo de subida: las claves de
          // este lote se quedan en la cola para reintentar después, y sobre
          // todo, no se aborta a medias la inicialización de la app que llamó a
          // esto.
          try {
            // ARREGLO (2026-09-18, ver el comentario largo junto a push() más
            // arriba): el valor a subir YA NO viene guardado dentro del propio
            // item de la cola -- se relee aquí, fresco, directo de la clave en
            // localStorage de LA EMPRESA de este grupo (leerTextoParaEmpresa,
            // 2026-09-24 -- nunca la que esté activa en este instante). Se usa
            // el centinela `_SIN_VALOR_LOCAL_` (nunca `undefined`, que `.map`
            // trataría igual que "sin cambios" y JSON.stringify simplemente
            // omitiría) para poder distinguir, más abajo, una clave que de
            // verdad no tiene nada guardado localmente (no se sube, se deja
            // pendiente) de una que sí, pero cuyo valor real es `null`.
            const SIN_VALOR_LOCAL = { __mypecarSinValorLocal: true };
            const filasConValor = lote
              .map(item => {
                const crudo = leerTextoParaEmpresa(item.clave, empresaId); // ya descomprimido; incluye el respaldo en memoria si no cupo en disco
                if (crudo === null || crudo === undefined) return { item, valor: SIN_VALOR_LOCAL };
                let parseado;
                try { parseado = JSON.parse(crudo); } catch (e) { return { item, valor: SIN_VALOR_LOCAL }; }
                return { item, valor: parseado };
              })
              .filter(({ valor }) => valor !== SIN_VALOR_LOCAL); // si ya no hay nada local para esa clave (se borró mientras tanto, o nunca se guardó), no se sube nada en su nombre -- removeClave() se encarga de los borrados de verdad
            // ARREGLO (2026-10-15): "ON CONFLICT DO UPDATE command cannot affect row a
            // second time". Si en la cola había dos pendientes de la MISMA clave (p.ej.
            // uno anotado con la empresa y otro antiguo sin empresa), ambos caían en el
            // mismo lote y Supabase rechazaba el lote ENTERO, dejándolo atascado para
            // siempre. Ahora, dentro del lote, cada clave se sube UNA sola vez (el valor
            // ya se relee fresco del disco, así que ambos pendientes llevaban lo mismo);
            // al terminar, ambos pendientes se quitan de la cola (ver idsSubidos).
            const _vistas = new Set();
            const filasUnicas = filasConValor.filter(({ item }) => { if (_vistas.has(item.clave)) return false; _vistas.add(item.clave); return true; });
            const filas = filasUnicas.map(({ item, valor }) => ({
              empresa_id: empresaId, app: currentApp, clave: item.clave,
              valor: (valor === null || valor === undefined) ? MARCADOR_VALOR_NULO : valor,
              actualizado_por: user ? user.id : null, actualizado_en: new Date().toISOString()
            }));
            // Las que no tenían valor local (se borraron o nunca llegaron a
            // guardarse) se quitan siempre de la cola, suba o no el resto del
            // lote -- reintentarlas para siempre no tiene sentido, no hay nada
            // que subir en su nombre.
            const idsSinValor = new Set(lote.filter(item => !filasConValor.some(f => f.item === item)).map(item => item.clave + '::' + item.seq));
            if (idsSinValor.size > 0) {
              const outboxSinEsas = leerOutbox().filter(i => !idsSinValor.has(i.clave + '::' + i.seq));
              guardarOutbox(outboxSinEsas);
            }
            if (filas.length === 0) continue; // nada real que subir en este lote

            const { error } = await supabaseClient.from('app_config').upsert(filas, { onConflict: 'empresa_id,app,clave' });
            if (error) {
              warn('No se pudo subir un lote de', filas.length, 'clave(s) de la empresa', empresaId, ':', error.message);
              setUltimoError(error.message);
            } else {
              subidas += filas.length;
              // Se quita del outbox SOLO lo que este lote de verdad subió -- se
              // relee el outbox actual (por si en paralelo se encoló algo
              // nuevo, p.ej. otra pestaña o el propio reintento automático) y
              // se identifica cada fila del lote por clave+seq, igual que antes.
              const idsSubidos = new Set(filasConValor.map(({ item }) => item.clave + '::' + item.seq));
              const outboxActual = leerOutbox();
              const restante = outboxActual.filter(i => !idsSubidos.has(i.clave + '::' + i.seq));
              guardarOutbox(restante);
            }
          } catch (e) {
            warn('No se pudo subir un lote (excepción de red)', e);
            setUltimoError(String((e && e.message) || e));
          }
        }
      }
    } finally {
      flushEnCurso = false;
      try { reintentarRespaldosEnMemoria(); } catch (e) { /* no crítico */ }
      emitirEstadoCambio();
    }
    if (subidas > 0) log(`${subidas} clave(s) sincronizada(s) con la nube.`);
    const pendientesFinal = outboxDeEstaApp().length;
    if (reintentoTrasFlush) { reintentoTrasFlush = false; flushOutbox(); }
    return { subidas, pendientes: pendientesFinal };
  }

  function getConflictos() { return lsGet(SESSION_LOG_KEY, []); }

  // -------------------------------------------------------------------------
  // BORRADO de una clave (2026-09-16): antes esta librería solo sabía crear o
  // actualizar filas de app_config (push/upsert) — no existía forma de borrar
  // una. Hace falta para poder eliminar un periodo (mes) completo, o limpiar
  // claves viejas durante un "Vaciar Datos"/"Reiniciar Todo", sin dejarlas
  // como basura que "resucita" en otro dispositivo la próxima vez que
  // pullAll() las vuelva a traer.
  // -------------------------------------------------------------------------

  // Quita la clave YA MISMO de este dispositivo (localStorage + cualquier
  // subida pendiente de esa misma clave, que ya no tiene sentido enviar) y
  // programa su borrado en Supabase — de inmediato si hay conexión, o en
  // cuanto vuelva si no la hay (igual que push() con las subidas).
  async function removeClave(clave) {
    const empresaId = empresas.activaId();
    // localStorage.removeItem ya está parcheado (ver instalarAlmacenamientoTransparente,
    // 2026-09-24) y resuelve sola la clave física de la empresa ACTIVA -- incluye ya
    // su propio olvidarClaveEnMemoria(), así que no hace falta repetirlo aquí.
    try { localStorage.removeItem(clave); } catch (e) { warn('No se pudo borrar localmente', clave, e); }
    try { localStorage.removeItem('_meta_' + clave); } catch (e) { /* no crítico */ }
    // Ya no tiene sentido subir un valor para una clave que se está borrando --
    // pero SOLO se cancela el pendiente de la MISMA empresa: si hay un
    // pendiente en cola con esa misma clave pero de otra empresa (porque se
    // cambió de empresa entretanto, ver push()/flushOutbox() 2026-09-24), ese
    // pendiente sigue siendo válido para su propia empresa y no se debe tocar.
    guardarOutbox(leerOutbox().filter(item => !(item.clave === clave && (item.empresaId || empresaId) === empresaId && esDeEstaApp(item))));

    const pendientesBorrado = leerOutboxBorrados().map(p => (typeof p === 'string' ? { clave: p, empresaId, app: currentApp || null } : p));
    if (!pendientesBorrado.some(p => p.clave === clave && p.empresaId === empresaId && esDeEstaApp(p))) {
      pendientesBorrado.push({ clave, empresaId: empresaId || null, app: currentApp || null });
    }
    guardarOutboxBorrados(pendientesBorrado);
    emitirEstadoCambio();

    return flushOutboxBorrados();
  }

  // Envía a Supabase todos los borrados pendientes. Misma filosofía, mismos
  // blindajes contra excepciones de red, y el mismo arreglo contra subidas
  // superpuestas (2026-09-16) que flushOutbox() — ver el comentario largo de
  // esa función para el detalle del problema que esto corrige.
  async function flushOutboxBorrados() {
    if (flushBorradosEnCurso) { reintentoBorradosTrasFlush = true; return { borradas: 0, motivo: 'flush-ya-en-curso' }; }
    if (!supabaseClient || !navigator.onLine) return { borradas: 0, motivo: 'sin-conexion-o-supabase' };

    // ARREGLO (2026-09-24): cada borrado pendiente ahora recuerda bajo qué
    // empresa se pidió (empresaId) -- mismo motivo que en flushOutbox(): si
    // se cambió de empresa antes de que esto se sincronizara, el borrado
    // debe aplicarse en SU empresa original, nunca en la que quede activa en
    // ese momento (podría borrar por error una clave de OTRA empresa que
    // comparte el mismo nombre). Los pendientes de antes de este arreglo
    // (solo texto, sin empresa) se normalizan asumiendo la empresa activa en
    // este momento -- igual que se comportaban siempre antes de este arreglo.
    const empresaActivaAhora = empresas.activaId();
    const normalizados = leerOutboxBorrados().map(p => (typeof p === 'string' ? { clave: p, empresaId: empresaActivaAhora, app: currentApp || null } : p));
    guardarOutboxBorrados(normalizados); // deja ya normalizado en disco, por si el proceso se corta a media subida
    const pendientesInicial = normalizados.filter(esDeEstaApp); // (2026-09-24b) solo los de ESTA app
    if (pendientesInicial.length === 0) return { borradas: 0 };

    flushBorradosEnCurso = true;
    let borradas = 0;
    try {
      for (const pendiente of pendientesInicial) {
        const { clave, empresaId } = pendiente;
        if (!empresaId) continue; // nunca hubo empresa activa cuando se encoló -- no hay a quién avisarle en la nube
        if ((await verificarReinicioDatos(empresaId, true)) !== 'ok') continue; // (2026-09-24b) ver flushOutbox
        try {
          const { error } = await supabaseClient.from('app_config').delete()
            .eq('empresa_id', empresaId).eq('app', currentApp).eq('clave', clave);
          if (error) {
            warn('No se pudo borrar en la nube', clave, 'de la empresa', empresaId, ':', error.message);
            setUltimoError(error.message);
          } else {
            borradas++;
            const actuales = leerOutboxBorrados().map(p => (typeof p === 'string' ? { clave: p, empresaId: empresaActivaAhora, app: currentApp || null } : p));
            const restantes = actuales.filter(p => !(p.clave === clave && p.empresaId === empresaId && esDeEstaApp(p)));
            guardarOutboxBorrados(restantes);
          }
        } catch (e) {
          warn('No se pudo borrar en la nube (excepción de red)', clave, e);
          setUltimoError(String((e && e.message) || e));
        }
      }
    } finally {
      flushBorradosEnCurso = false;
      emitirEstadoCambio();
    }
    if (borradas > 0) log(`${borradas} clave(s) borrada(s) de la nube.`);
    const pendientesFinal = borradosDeEstaApp().length;
    if (reintentoBorradosTrasFlush) { reintentoBorradosTrasFlush = false; flushOutboxBorrados(); }
    return { borradas, pendientes: pendientesFinal };
  }

  // -------------------------------------------------------------------------
  // FASE 2 — helper genérico para escribir en una tabla normalizada
  // (ventas, compras, caja_movimientos, diario_asientos, personal_trabajadores,
  // activos, inventario_movimientos, ...) cuando una app esté lista para ese
  // paso. No reemplaza nada de Fase 1 — se usa además, para las apps/tablas
  // que Carlos decida migrar primero.
  // -------------------------------------------------------------------------
  async function syncTable(tabla, filas) {
    requiereSupabase();
    const empresaId = requiereEmpresaActiva();
    const conEmpresa = (Array.isArray(filas) ? filas : [filas]).map(f => ({ ...f, empresa_id: empresaId }));
    const { data, error } = await supabaseClient.from(tabla).upsert(conEmpresa).select();
    if (error) throw error;
    return data;
  }
  async function fetchTable(tabla, filtros) {
    requiereSupabase();
    const empresaId = requiereEmpresaActiva();
    let query = supabaseClient.from(tabla).select('*').eq('empresa_id', empresaId).is('eliminado_en', null);
    Object.entries(filtros || {}).forEach(([campo, valor]) => { query = query.eq(campo, valor); });
    const { data, error } = await query;
    if (error) throw error;
    return data;
  }

  // Qué app es esta (el código pasado a init(), ej. 'personal') — lo usa
  // mypecar-login.js para saber qué permiso revisar, sin que cada una de las
  // 9 apps tenga que repetirlo en su propia llamada a asegurarAcceso().
  function appActual() { return currentApp; }

  // ===========================================================================
  // SINCRONIZACIÓN ENTRE PESTAÑAS (2026-09-24)
  // ===========================================================================
  // CAUSA RAÍZ real de "cambié de empresa y las OTRAS apps/pestañas que ya
  // tenía abiertas se quedaron con los datos de la empresa anterior, aunque
  // el globito de esas otras diga otra empresa distinta" -- reportado por
  // Carlos con capturas de 01/02/04 abiertas a la vez, cada una mostrando
  // una empresa distinta en el globito. Los 2 arreglos anteriores del mismo
  // día (aislamiento por empresa en el disco, y refrescar el nombre
  // cacheado del globito) ya garantizan que CUALQUIER pestaña que se
  // RECARGUE muestre la empresa correcta en todos lados -- pero ninguno de
  // los dos hace nada por una pestaña que YA ESTABA ABIERTA y simplemente
  // nunca se volvió a recargar: esa pestaña sigue mostrando, indefinidamente,
  // lo que tenía en memoria desde su propia carga, sin enterarse de que la
  // empresa activa cambió en otro lado. Como Carlos (como cualquier
  // contador) trabaja con varias de las 9 apps abiertas al mismo tiempo,
  // este es justamente el caso más común, no uno raro.
  //
  // El navegador ya avisa de esto: el evento "storage" se dispara en TODAS
  // las demás pestañas/ventanas del mismo origen (nunca en la que hizo el
  // cambio) en el instante exacto en que cambia una clave de localStorage.
  // Se aprovecha para, apenas cambia mypecar_empresa_activa en otra
  // pestaña, avisar con un banner bien visible y recargar esta página sola
  // -- así ninguna pestaña abierta puede quedarse, sin que el usuario se dé
  // cuenta, mostrando o guardando datos de una empresa que ya dejó de ser
  // la activa (el peor caso: escribir un dato nuevo pensando que es de una
  // empresa cuando en realidad se está guardando, correctamente aislado,
  // bajo la empresa vieja que esa pestaña todavía cree que es la activa).
  let avisoCambioEmpresaMostrado = false;
  function avisarCambioDeEmpresaYRecargar() {
    if (avisoCambioEmpresaMostrado) return;
    avisoCambioEmpresaMostrado = true;
    try {
      const aviso = document.createElement('div');
      aviso.textContent = '🔄 La empresa activa cambió en otra pestaña — actualizando esta página con los datos correctos...';
      aviso.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#b45309;color:#fff;text-align:center;padding:10px 14px;font:bold 13px -apple-system,Segoe UI,Roboto,Arial,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.25);';
      (document.body || document.documentElement).appendChild(aviso);
    } catch (e) { /* no crítico -- de todos modos se recarga */ }
    setTimeout(function () { try { location.reload(); } catch (e) {} }, 1200);
  }
  let avisoReinicioMostrado = false;
  function avisarReinicioYRecargar() {
    if (avisoReinicioMostrado) return;
    avisoReinicioMostrado = true;
    try {
      const aviso = document.createElement('div');
      aviso.textContent = '🔄 Los datos de esta empresa se reiniciaron desde la nube — actualizando esta página...';
      aviso.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#1d4ed8;color:#fff;text-align:center;padding:10px 14px;font:bold 13px -apple-system,Segoe UI,Roboto,Arial,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.25);';
      (document.body || document.documentElement).appendChild(aviso);
    } catch (e) { /* no crítico */ }
    setTimeout(function () { try { location.reload(); } catch (e) {} }, 1200);
  }
  function instalarSincronizacionEntrePestanas() {
    if (typeof window === 'undefined' || !window.addEventListener) return;
    window.addEventListener('storage', function (ev) {
      // (2026-09-24b) Otra pestaña reinició los datos de la empresa con la que
      // trabaja ESTA página: se bloquea cualquier escritura (para no volver a
      // guardar lo que esta página tiene en memoria) y se recarga.
      if (ev.key === REINICIO_SENAL_KEY && ev.newValue) {
        let senal = null; try { senal = JSON.parse(ev.newValue); } catch (e) { senal = null; }
        if (senal && senal.empresaId && senal.empresaId === empresaParaAislamiento()) {
          escriturasBloqueadasPorReinicio = true;
          avisarReinicioYRecargar();
        }
        return;
      }
      // "storage" solo llega a OTRAS pestañas -- nunca a la que hizo el
      // cambio -- así que no hay riesgo de que esto se dispare a sí mismo
      // ni de un ciclo de recargas.
      // (2026-10-11) El Libro Diario (catálogo maestro) cambió en otra pestaña.
      if (ev.key !== EMPRESA_KEY) {
        if (ev.newValue !== ev.oldValue && esCambioDelCatalogoMaestro(ev.key) && catalogoMaestroCambioDeVerdad(ev)) avisarCatalogoMaestroCambiado();
        return;
      }
      if (!ev.newValue || ev.newValue === ev.oldValue) return; // sin cambio real de empresa
      avisarCambioDeEmpresaYRecargar();
    });
  }


  // =========================================================================
  // SEGURIDAD ANTES DE BORRAR (2026-10-15b, pedido de Carlos)
  // =========================================================================
  // Qué pasó: el 15-oct, "Reiniciar Todo" se usó sobre una empresa con ventas
  // reales (enero a setiembre). El botón borra en la NUBE los periodos de la
  // empresa activa, y no había copia de nada. Esto agrega, para los botones
  // "Reiniciar Todo" y "Vaciar Datos de Prueba" de las apps:
  //   1) Consulta a la nube cuántos datos reales tiene la empresa activa.
  //   2) Si tiene datos: descarga SOLA un archivo de respaldo (.json) con todo
  //      lo que la empresa tiene en la nube (las 9 apps), ANTES de borrar.
  //   3) Exige escribir el RUC de la empresa que se va a borrar.
  //   4) Si no se puede consultar la nube (sin internet, error), NO se borra:
  //      sin poder respaldar, no se arriesga.
  // Además, validarRucEmpresaActiva() evita el caso del "RUC que se revierte
  // solo" al cambiar el RUC en Ajustes de una empresa ya registrada.
  const MIN_BYTES_CON_DATOS = 60; // '{}', '[]', '{"sales":[]}' ... no cuentan como datos
  const seguridad = {
    // Todas las filas de la empresa en la nube (las 9 apps).
    async leerFilasEmpresa(empresaId) {
      requiereSupabase();
      const { data, error } = await supabaseClient.from('app_config')
        .select('app, clave, valor, actualizado_en')
        .eq('empresa_id', empresaId).range(0, 9999);
      if (error) throw error;
      return (data || []).filter(f => String(f.clave).indexOf('snap_') !== 0); // las fotos de enlace son derivadas: no entran al respaldo
    },
    resumirFilas(filas) {
      const porApp = {};
      let conDatos = 0;
      (filas || []).forEach(f => {
        const tam = JSON.stringify(f.valor === undefined ? null : f.valor).length;
        if (tam > MIN_BYTES_CON_DATOS) {
          porApp[f.app] = (porApp[f.app] || 0) + 1;
          conDatos++;
        }
      });
      return { conDatos, porApp };
    },
    descargarRespaldo(empresaId, empresaDatos, filas) {
      const ahora = new Date();
      const p2 = n => String(n).padStart(2, '0');
      const sello = ahora.getFullYear() + '-' + p2(ahora.getMonth() + 1) + '-' + p2(ahora.getDate()) + '_' + p2(ahora.getHours()) + p2(ahora.getMinutes());
      const nombre = 'MYPECAR_respaldo_' + ((empresaDatos && empresaDatos.ruc) || 'empresa') + '_' + sello + '.json';
      const contenido = {
        tipo: 'respaldo_mypecar_plus',
        generadoEl: ahora.toISOString(),
        versionSync: VERSION_SYNC,
        empresa: { id: empresaId, ruc: empresaDatos && empresaDatos.ruc, razonSocial: empresaDatos && empresaDatos.razonSocial },
        filas: filas
      };
      const blob = new Blob([JSON.stringify(contenido)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = nombre;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return nombre;
    },
    // Devuelve true solo si es seguro continuar con el borrado.
    async confirmarBorrado({ accion } = {}) {
      const nombreAccion = accion || 'esta operación';
      if (!supabaseClient) return true; // sin nube configurada no hay nada en la nube que perder
      const empresaId = empresas.activaId();
      if (!empresaId) return true;
      let datos = null, filas;
      // (2026-10-16) Solo el Contador Jefe (owner) puede borrar todos los datos de la empresa.
      // Un asistente o un usuario invitado no debe poder reiniciar ni vaciar la empresa.
      try {
        if (!navigator.onLine) throw new Error('sin internet');
        const esDueno = await empresas.esOwner(empresaId);
        if (!esDueno) {
          alert('⛔ No se borró nada.\n\nSolo el Contador Jefe (dueño de la empresa) puede ' + nombreAccion + '.\n\nSi necesita hacerlo, pídaselo a él.');
          return false;
        }
      } catch (e) {
        warn('confirmarBorrado: no se pudo verificar el rol:', e);
        alert('⛔ No se borró nada.\n\nNo se pudo verificar que usted sea el Contador Jefe de la empresa (sin internet o error de conexión). Conéctese e inténtelo de nuevo.');
        return false;
      }
      try {
        if (!navigator.onLine) throw new Error('sin internet');
        filas = await seguridad.leerFilasEmpresa(empresaId);
        try { datos = await empresas.obtenerDatos(empresaId); } catch (e) { datos = null; }
      } catch (e) {
        warn('confirmarBorrado: no se pudo consultar la nube:', e);
        alert('⛔ No se borró nada.\n\nNo se pudo consultar la nube para respaldar la empresa antes de ' + nombreAccion + ' (sin internet o error de conexión).\n\nConéctate a internet y vuelve a intentarlo. Por seguridad, MYPECAR no borra datos si no puede respaldarlos primero.');
        return false;
      }
      const resumen = seguridad.resumirFilas(filas);
      if (resumen.conDatos === 0) return true; // empresa vacía: nada que proteger
      const nombreArchivo = seguridad.descargarRespaldo(empresaId, datos, filas);
      const ruc = String((datos && datos.ruc) || '').trim();
      const razon = (datos && (datos.razonSocial || datos.nombreComercial)) || 'la empresa activa';
      const detalle = Object.keys(resumen.porApp).sort().map(a => a + ': ' + resumen.porApp[a]).join(', ');
      const msg = '⚠ ATENCIÓN — ' + nombreAccion.toUpperCase() + '\n\n' +
        'La empresa activa es "' + razon + '"' + (ruc ? ' (RUC ' + ruc + ')' : '') + ' y TIENE DATOS GUARDADOS EN LA NUBE (' + resumen.conDatos + ' registros — ' + detalle + ').\n\n' +
        'Esta operación los borrará PARA TODAS LAS PERSONAS que usan esta empresa, no solo en este equipo.\n\n' +
        'Se acaba de descargar un respaldo: ' + nombreArchivo + '\nGuárdalo en un lugar seguro antes de continuar.\n\n' +
        (ruc ? 'Para continuar, escribe el RUC de esta empresa (' + ruc + '). Si no quieres borrar, cancela.' : 'Para continuar escribe BORRAR. Si no quieres borrar, cancela.');
      const respuesta = prompt(msg);
      if (respuesta === null) return false;
      const esperado = ruc || 'BORRAR';
      if (respuesta.trim().toUpperCase() !== esperado.toUpperCase()) {
        alert('⛔ No coincide. No se borró nada.');
        return false;
      }
      return true;
    },
    // Para saveSettings(): evita cambiar a mano el RUC de una empresa ya registrada.
    async validarRucEmpresaActiva(rucNuevo) {
      try {
        if (!supabaseClient || !navigator.onLine) return { ok: true, noVerificado: true };
        const empresaId = empresas.activaId();
        if (!empresaId) return { ok: true, noVerificado: true };
        const datos = await empresas.obtenerDatos(empresaId);
        const rucNube = String((datos && datos.ruc) || '').trim();
        if (!rucNube || rucNube === String(rucNuevo || '').trim()) return { ok: true };
        return { ok: false, rucNube, mensaje:
          '⛔ No se guardó el cambio de RUC.\n\n' +
          'La empresa activa en MYPECAR está registrada con el RUC ' + rucNube + ' (' + ((datos && (datos.razonSocial || datos.nombreComercial)) || '') + ').\n' +
          'Si lo cambias aquí, al volver a abrir la app se restauraría el RUC registrado.\n\n' +
          'Para trabajar con OTRO cliente NO cambies este dato: en el globito de empresa (arriba) elige "Cambiar de empresa" → "+ Registrar otra empresa", y espera a que sea autorizada.' };
      } catch (e) {
        warn('validarRucEmpresaActiva: no se pudo verificar (se permite el guardado):', e);
        return { ok: true, noVerificado: true };
      }
    },
    // (2026-10-16) VERSIÓN MÍNIMA: el proveedor fija en Supabase (tabla app_version_minima) la versión
    // más antigua que puede operar. Si esta copia es más vieja, se muestra una pantalla que pide
    // actualizar los archivos y no deja trabajar. Si no se puede consultar (sin internet, la tabla aún
    // no existe, error), NO se bloquea: mejor dejar trabajar que dejar a todos fuera por un fallo técnico.
    // Limitación: solo protege a las copias que ya traen esta revisión; no puede bloquear copias antiguas.
    async verificarVersionMinima() {
      try {
        if (!supabaseClient || !navigator.onLine) return { ok: true, noVerificado: true };
        const { data: ses } = await supabaseClient.auth.getSession();
        if (!ses || !ses.session) return { ok: true, noVerificado: true };
        const { data: fila, error } = await supabaseClient.from('app_version_minima').select('version_minima, mensaje').eq('id', 1).maybeSingle();
        if (error || !fila || !fila.version_minima) return { ok: true, noVerificado: true };
        const minima = String(fila.version_minima).trim();
        const versionApp = String(global.MYPECAR_APP_VERSION || '').trim(); // vacío = app sin la revisión de seguridad
        const versionSync = String(VERSION_SYNC);
        // Las versiones tienen forma AAAA-MM-DD con letra opcional: comparan bien como texto.
        // 07 Reportes y 08 Auditoría no tienen botones de borrado ni guardan datos propios, y no llevan la marca de versión:
        // para ellas solo cuenta la versión de este archivo (si no, quedarían bloqueadas sin motivo).
        const sinMarcaPorDiseno = (currentApp === 'reportes' || currentApp === 'auditoria');
        const desactualizada = (!sinMarcaPorDiseno && versionApp < minima) || versionSync < minima;
        if (!desactualizada) return { ok: true, minima, versionApp, versionSync };
        seguridad.mostrarBloqueoVersion(minima, versionApp || '(anterior a 2026-10-16)', versionSync, fila.mensaje);
        return { ok: false, minima, versionApp, versionSync };
      } catch (e) {
        warn('verificarVersionMinima: no se pudo verificar (se permite trabajar):', e);
        return { ok: true, noVerificado: true };
      }
    },
    mostrarBloqueoVersion(minima, versionApp, versionSync, mensaje) {
      if (document.getElementById('mypecar-bloqueo-version')) return;
      const caja = document.createElement('div');
      caja.id = 'mypecar-bloqueo-version';
      caja.setAttribute('style', 'position:fixed;inset:0;z-index:2147483647;background:rgba(15,23,42,.97);display:flex;align-items:center;justify-content:center;padding:24px;font-family:Segoe UI,Calibri,Arial,sans-serif;');
      caja.innerHTML = '<div style="max-width:560px;background:#fff;border-radius:16px;padding:32px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.5)">' +
        '<div style="font-size:42px;margin-bottom:8px">🔒</div>' +
        '<h2 style="margin:0 0 12px;color:#991b1b;font-size:22px">Actualice los archivos de MYPECAR PLUS</h2>' +
        '<p style="color:#334155;line-height:1.5;margin:0 0 14px">Esta copia del sistema está <b>desactualizada</b> y no incluye las protecciones de seguridad de los datos. Por eso no puede usarse.</p>' +
        '<p style="color:#475569;font-size:14px;margin:0 0 14px">Versión instalada: <b>' + String(versionApp).replace(/</g, '&lt;') + '</b> (sync: ' + String(versionSync).replace(/</g, '&lt;') + ')<br>Versión mínima requerida: <b>' + String(minima).replace(/</g, '&lt;') + '</b></p>' +
        (mensaje ? '<p style="color:#334155;font-size:14px;margin:0 0 14px">' + String(mensaje).replace(/</g, '&lt;') + '</p>' : '') +
        '<p style="color:#334155;font-size:14px;margin:0">Pida al proveedor la <b>última versión de los archivos</b>, reemplace su carpeta de apps y vuelva a abrir. Sus datos en la nube están a salvo.</p>' +
        '</div>';
      document.body.appendChild(caja);
    }
  };


  // =========================================================================
  // ENLACE AUTOMÁTICO ENTRE MÓDULOS (2026-11-20)
  // =========================================================================
  // Antes, para que Reportes, Auditoría, Inventario, Caja o el Libro Diario vieran lo registrado
  // en Ventas, Compras, etc., había que exportar un archivo .json y subirlo a mano en el otro
  // módulo. Ahora cada módulo que produce datos (01, 02, 03, 04, 09) publica solo, unos segundos
  // después de cada cambio, una "foto" de esos mismos datos en la nube de SU empresa
  // (app_config, clave "snap_<tipo>"), con el MISMO contenido que tendría el archivo exportado. Los
  // módulos que consumen (03, 04, 07, 08, 09) leen esa foto y la pasan por la misma rutina de
  // importación que ya usaban con el archivo, así que no cambia ninguna regla de cálculo.
  // - La foto no se copia a localStorage (no ocupa espacio en el equipo) ni entra a los respaldos.
  // - Respeta los permisos: si quien usa el módulo no tiene acceso al módulo de origen, la nube no
  //   le entrega nada y todo sigue funcionando como antes (con el archivo manual).
  // - Nunca se publica una foto vacía encima de una buena.
  const enlace = {
    PREFIJO: 'snap_',
    _timer: null,
    _ultimo: {},
    async publicar(tipo, payload) {
      requiereSupabase();
      const empresaId = empresas.activaId();
      if (!empresaId || !currentApp || !payload) return false;
      let userId = null;
      try { const ses = await auth.sesionActual(); userId = ses && ses.user ? ses.user.id : null; } catch (e) {}
      const { error } = await supabaseClient.from('app_config').upsert([{
        empresa_id: empresaId, app: currentApp, clave: enlace.PREFIJO + tipo, valor: payload,
        actualizado_por: userId, actualizado_en: new Date().toISOString()
      }], { onConflict: 'empresa_id,app,clave' });
      if (error) { warn('enlace.publicar(' + tipo + '):', error.message); return false; }
      return true;
    },
    // Programa la publicación (con espera, para agrupar varios cambios seguidos en uno).
    programar(esperaMs) {
      if (typeof global.mypecarConstruirSnapshots !== 'function') return;
      if (!supabaseClient || !navigator.onLine) return;
      clearTimeout(enlace._timer);
      enlace._timer = setTimeout(enlace.publicarTodo, esperaMs || 5000);
    },
    async publicarTodo() {
      try {
        if (!empresas.activaId() || typeof global.mypecarConstruirSnapshots !== 'function') return;
        const snaps = global.mypecarConstruirSnapshots() || {};
        const empresaId = empresas.activaId();
        for (const tipo of Object.keys(snaps)) {
          const payload = snaps[tipo];
          if (!payload) continue;
          const copia = Object.assign({}, payload); delete copia.generadoEl;
          const firma = empresaId + '|' + JSON.stringify(copia);
          if (enlace._ultimo[tipo] === firma) continue; // sin cambios desde la última publicación
          if (await enlace.publicar(tipo, payload)) enlace._ultimo[tipo] = firma;
        }
      } catch (e) { warn('enlace.publicarTodo:', e && e.message); }
    },
    // Devuelve { payload, actualizado_en } o null (sin foto, sin permiso o sin conexión).
    async leer(app, tipo) {
      try {
        requiereSupabase();
        const empresaId = empresas.activaId();
        if (!empresaId) return null;
        const { data, error } = await supabaseClient.from('app_config')
          .select('valor, actualizado_en').eq('empresa_id', empresaId).eq('app', app).eq('clave', enlace.PREFIJO + tipo).maybeSingle();
        if (error || !data || !data.valor || typeof data.valor !== 'object') return null;
        return { payload: data.valor, actualizado_en: data.actualizado_en };
      } catch (e) { return null; }
    },
    // Igual que leer(), pero entrega un File .json listo para la rutina de importación de siempre.
    async leerComoArchivo(app, tipo, nombre) {
      const r = await enlace.leer(app, tipo);
      if (!r) return null;
      const f = new File([JSON.stringify(r.payload)], nombre || (tipo + '_nube.json'), { type: 'application/json' });
      f.actualizadoEn = r.actualizado_en;
      f.generadoEl = r.payload.generadoEl || null;
      return f;
    },
    // Solo la fecha de la última publicación (liviano: no baja los datos).
    async fechaPublicacion(app, tipo) {
      try {
        requiereSupabase();
        const empresaId = empresas.activaId();
        if (!empresaId) return null;
        const { data, error } = await supabaseClient.from('app_config')
          .select('actualizado_en').eq('empresa_id', empresaId).eq('app', app).eq('clave', enlace.PREFIJO + tipo).maybeSingle();
        return (error || !data) ? null : data.actualizado_en;
      } catch (e) { return null; }
    },
    _marca(app, tipo) { return 'mypecar_enlace_' + (empresas.activaId() || 'x') + '_' + app + '_' + tipo; },
    // Revisa cada fuente [{app, tipo}] y, si hay datos más nuevos que los ya recibidos (o si forzar=true),
    // llama a alRecibir(app, tipo, archivo). Al final llama a alTerminar(listaDeRecibidos) solo si llegó algo.
    async sincronizar(fuentes, alRecibir, alTerminar, forzar) {
      if (enlace._ocupado) return [];
      enlace._ocupado = true;
      const recibidos = [];
      try {
        if (!empresas.activaId() || !navigator.onLine) return [];
        for (const f of fuentes) {
          const fecha = await enlace.fechaPublicacion(f.app, f.tipo);
          if (!fecha) continue;
          const marca = enlace._marca(f.app, f.tipo);
          let visto = null; try { visto = localStorage.getItem(marca); } catch (e) {}
          if (!forzar && visto === fecha) continue;
          const archivo = await enlace.leerComoArchivo(f.app, f.tipo, (f.nombre || (f.app + '_' + f.tipo)) + '_nube.json');
          if (!archivo) continue;
          try {
            await alRecibir(f.app, f.tipo, archivo);
            try { localStorage.setItem(marca, fecha); } catch (e) {}
            recibidos.push(f);
          } catch (e) { warn('enlace.sincronizar: falló al recibir', f.app, f.tipo, e && e.message); }
        }
        if (recibidos.length && typeof alTerminar === 'function') { try { await alTerminar(recibidos); } catch (e) { warn('enlace.alTerminar:', e && e.message); } }
      } finally { enlace._ocupado = false; }
      return recibidos;
    },
    // Programa la revisión automática: al abrir (a los 3 y 12 segundos), al volver a la pestaña, y cada 60 s
    // mientras la pestaña está a la vista. Devuelve una función para forzar la actualización a mano.
    automatico(fuentes, alRecibir, alTerminar) {
      const correr = () => { if (document.visibilityState === 'visible') enlace.sincronizar(fuentes, alRecibir, alTerminar, false); };
      setTimeout(correr, 3000); setTimeout(correr, 12000);
      setInterval(correr, 60000);
      document.addEventListener('visibilitychange', correr);
      return () => enlace.sincronizar(fuentes, alRecibir, alTerminar, true);
    }
  };

  global.MypecarSync = {
    init, getEstado, onEstadoCambio, appActual,
    auth, empresas,
    obtenerClienteSupabase: function () { return supabaseClient; },
    pullAll, storageGet, storageSet, push, flushOutbox, getConflictos,
    removeClave, flushOutboxBorrados,
    instalarInterceptorLocalStorage,
    syncTable, fetchTable,
    // 2026-09-19
    claves, usoAlmacenamiento, compactar: compactarAhora, version: VERSION_SYNC,
    // 2026-09-24b
    empresaFueReiniciada, verificarReinicioDatos,
    // 2026-10-11
    aplicarCatalogoMaestro, mezclarCatalogoMaestroEn, catalogoMaestroAplicado: function () { return ultimoCatalogoMaestro; },
    // 2026-10-15b
    seguridad,
    // 2026-11-20
    enlace
  };

  // Se instala apenas carga este archivo (antes de que cualquier app lea o escriba): a partir
  // de aquí, cualquier localStorage.getItem/setItem de las 9 apps pasa por la compresión
  // transparente — sin que las apps tengan que cambiar una sola línea.
  instalarAlmacenamientoTransparente();
  // Igual de temprano: para que ninguna pestaña abierta se quede desactualizada
  // si la empresa activa cambia en otra (ver "SINCRONIZACIÓN ENTRE PESTAÑAS" arriba).
  instalarSincronizacionEntrePestanas();
})(window);
