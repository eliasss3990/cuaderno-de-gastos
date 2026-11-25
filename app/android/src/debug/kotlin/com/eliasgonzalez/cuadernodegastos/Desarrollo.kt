// Solo en la app de desarrollo: manejar la sincronización desde adb mientras no hay pantallas. Cada orden escribe su
// resultado en el registro con la etiqueta CuadernoDev (nunca el token). Ejemplos (con --user 0 y -p del paquete):
//   am broadcast -a com.eliasgonzalez.cuadernodegastos.DEV --es orden crear --es nombre Brasil
//   … --es orden invitar          … --es orden unirse --es codigo ABCD2345
//   … --es orden gasto --el monto 1500        … --es orden estado        … --es orden sincronizar
package com.eliasgonzalez.cuadernodegastos

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Operacion
import com.eliasgonzalez.cuadernodegastos.red.ClienteDeIdentidad
import com.eliasgonzalez.cuadernodegastos.red.MonedaNueva
import com.eliasgonzalez.cuadernodegastos.red.Perfil
import com.eliasgonzalez.cuadernodegastos.red.Resultado
import com.eliasgonzalez.cuadernodegastos.red.ViajeNuevo
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import java.util.UUID

class Desarrollo : BroadcastReceiver() {
    private fun log(s: String) {
        Log.i("CuadernoDev", s)
    }

    private fun uuid7(): String {
        val r = UUID.randomUUID()
        val alto = (System.currentTimeMillis() shl 16) or 0x7000L or (r.mostSignificantBits and 0x0FFFL)
        return UUID(alto, (r.leastSignificantBits and 0x3FFFFFFFFFFFFFFFL) or Long.MIN_VALUE).toString()
    }

    override fun onReceive(context: Context, intent: Intent) {
        val app = context.applicationContext as CuadernoApp
        val pendiente = goAsync()
        Thread {
            try {
                ordenar(app, intent)
            } catch (e: Exception) {
                log("error: ${e::class.simpleName}: ${e.message}")
            } finally {
                pendiente.finish()
            }
        }.start()
    }

    private fun ordenar(app: CuadernoApp, intent: Intent) {
        val s = app.sincronizacion
        val identidad = ClienteDeIdentidad(BuildConfig.SERVIDOR, versionParaElServidor(BuildConfig.VERSION_NAME))
        val viaje = intent.getStringExtra("viaje") ?: s.viajes().lastOrNull()
        val yo = Perfil("${android.os.Build.MODEL} (dev)", intent.getStringExtra("apodo") ?: "Dev", "#E8E4F3", "🙂")
        when (intent.getStringExtra("orden")) {
            "crear" -> when (val r = identidad.crearViaje(ViajeNuevo(intent.getStringExtra("nombre") ?: "Prueba", "America/Asuncion", listOf(MonedaNueva("PYG", 0, "₲"), MonedaNueva("BRL", 2, "R$"))), yo)) {
                is Resultado.Ok -> s.vincular(r.valor).also { log("creado viaje ${r.valor.viaje}") }
                else -> log("crear: $r")
            }
            "unirse" -> when (val r = identidad.unirse(intent.getStringExtra("codigo") ?: "", yo)) {
                is Resultado.Ok -> s.vincular(r.valor).also { log("unido al viaje ${r.valor.viaje}") }
                else -> log("unirse: $r")
            }
            "invitar" -> {
                val c = s.credenciales(viaje ?: return log("sin viaje")) ?: return log("sin credenciales")
                log("invitar: ${identidad.invitar(c)}")
            }
            "gasto" -> {
                val monto = intent.getLongExtra("monto", 1000)
                val r = s.registrar(viaje ?: return log("sin viaje")) { sinc ->
                    Operacion(
                        uuid7(), "expense.create", "expense", uuid7(), sinc.nuevaMarca(),
                        Json.parseToJsonElement("""{"monto_minor":$monto,"moneda":"PYG","categoria_id":"otro","cuando_ocurrio":${System.currentTimeMillis()},"dia_imputado":"2027-02-18","nota":"desde adb"}""").jsonObject, 1,
                    )
                }
                log("gasto $monto: $r")
            }
            "sincronizar" -> s.sincronizarAhora(viaje ?: return log("sin viaje")).also { log("sincronizar pedido") }
            "estado" -> for (v in s.viajes()) log("estado ${s.resumen(v)}")
            else -> log("orden desconocida: ${intent.getStringExtra("orden")}")
        }
    }
}
