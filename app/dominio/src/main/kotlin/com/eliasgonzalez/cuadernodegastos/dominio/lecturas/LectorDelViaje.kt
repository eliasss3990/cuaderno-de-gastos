// Lee el viaje del almacén local y lo devuelve con tipos. Una consulta por tipo de entidad (nunca una por gasto).
// Los campos que faltan o vienen con otra forma no rompen la lectura: se toman como ausentes (la validación ya los
// filtró al entrar; esto solo protege a las pantallas).
package com.eliasgonzalez.cuadernodegastos.dominio.lecturas

import com.eliasgonzalez.cuadernodegastos.dominio.base.EstadoViaje
import com.eliasgonzalez.cuadernodegastos.dominio.base.Moneda
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Validacion
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.Cola
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.EstadoOp
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.Sincronizador
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive

class LectorDelViaje(private val cola: Cola) {
    // por nombre como lo lee una persona (sin distinguir mayúsculas ni acentos) y, a igual nombre, por id. Un Collator
    // por llamada: no se puede compartir entre hilos
    private fun <T> porNombre(nombre: (T) -> String, id: (T) -> String): Comparator<T> {
        val collator = java.text.Collator.getInstance(java.util.Locale.forLanguageTag("es")).apply { strength = java.text.Collator.PRIMARY }
        return Comparator<T> { a, b -> collator.compare(nombre(a), nombre(b)) }.thenBy(id)
    }

    private fun texto(c: Map<String, JsonElement>, campo: String) = (c[campo] as? JsonPrimitive)?.takeIf { it.isString }?.content

    // con el mismo criterio que la validación: 1500.0 es el entero 1500 (así llega a veces y así se guarda)
    private fun numero(c: Map<String, JsonElement>, campo: String) = c[campo]?.let { Validacion.enteroSeguro(it) }

    private fun si(c: Map<String, JsonElement>, campo: String) = numero(c, campo) == 1L

    /** El viaje, o null si todavía no bajó su alta. */
    fun viaje(): Viaje? {
        val id = cola.idDelViaje() ?: return null
        val c = cola.entidadesDe("trip")[id] ?: return null
        return Viaje(
            id = id,
            nombre = texto(c, "nombre") ?: return null,
            zonaHoraria = texto(c, "zona_horaria") ?: return null,
            fechaInicio = texto(c, "fecha_inicio"),
            fechaFin = texto(c, "fecha_fin"),
            objetivos = texto(c, "objetivos"),
            estadoManual = texto(c, "estado_manual")?.let { e -> EstadoViaje.entries.firstOrNull { it.name == e && it != EstadoViaje.PLANIFICADO } },
        )
    }

    /** Las monedas del viaje (también las deshabilitadas: los gastos viejos en esa moneda siguen contando), por código. */
    fun monedas(): List<MonedaDelPlan> = cola.entidadesDe("trip_currency").mapNotNull { (codigo, c) ->
        MonedaDelPlan(
            moneda = Moneda(codigo, (numero(c, "decimales") ?: return@mapNotNull null).toInt(), texto(c, "simbolo") ?: return@mapNotNull null),
            habilitada = si(c, "habilitada"),
            topeMinor = numero(c, "tope_minor"),
            efectivoInicialMinor = numero(c, "efectivo_inicial_minor"),
        )
    }.sortedBy { it.moneda.codigo }

    fun integrantes(): List<Integrante> = cola.entidadesDe("member").mapNotNull { (id, c) ->
        Integrante(id, texto(c, "apodo") ?: return@mapNotNull null, texto(c, "color") ?: "", texto(c, "emoji") ?: "", si(c, "es_organizador"))
    }.sortedWith(porNombre({ it.apodo }, { it.id }))

    fun categorias(): List<Categoria> = cola.entidadesDe("category").mapNotNull { (id, c) ->
        Categoria(id, texto(c, "nombre") ?: return@mapNotNull null, texto(c, "color") ?: "", texto(c, "emoji") ?: "", si(c, "archivada"))
    }.sortedWith(porNombre({ it.nombre }, { it.id }))

    /**
     * Las entidades con una terminal propia (purga, borrado definitivo) todavía sin confirmar: no se muestran, aunque no
     * haya conexión. Si el servidor la rechaza, la operación pasa a cuarentena y la entidad vuelve a verse.
     */
    private fun quitandose(tipo: String): Set<String> =
        (cola.enEstado(EstadoOp.PENDIENTE) + cola.enEstado(EstadoOp.ENVIANDO))
            .filter { it.op.tipo in Sincronizador.TERMINALES && it.op.entidadTipo == tipo }
            .map { it.op.entidadId }.toSet()

    /** Todos los gastos, también los de la papelera (`eliminado`): cada pantalla elige. */
    fun gastos(): List<Gasto> = cola.transaccion {
        // todo en una lectura coherente: una sincronización en el medio no deja marcas desfasadas
        val autores = cola.autoresDe("expense")
        val sinConfirmar = cola.sinConfirmar()
        val enCuarentena = cola.enEstado(EstadoOp.CUARENTENA).map { it.op.entidadTipo to it.op.entidadId }.toSet()
        val quitandose = quitandose("expense")
        cola.entidadesDe("expense").filterKeys { it !in quitandose }.mapNotNull { (id, c) ->
            Gasto(
                id = id,
                montoMinor = numero(c, "monto_minor") ?: return@mapNotNull null,
                moneda = texto(c, "moneda") ?: return@mapNotNull null,
                categoriaId = texto(c, "categoria_id") ?: return@mapNotNull null,
                cuandoOcurrio = numero(c, "cuando_ocurrio") ?: return@mapNotNull null,
                diaImputado = texto(c, "dia_imputado") ?: return@mapNotNull null,
                concepto = texto(c, "concepto"),
                lugar = texto(c, "lugar"),
                metodoPago = texto(c, "metodo_pago"),
                aliasTarjeta = texto(c, "alias_tarjeta"),
                nota = texto(c, "nota"),
                eliminado = si(c, "eliminado"),
                autor = autores[id],
                sinConfirmar = ("expense" to id) in sinConfirmar,
                enCuarentena = ("expense" to id) in enCuarentena,
            )
        }.sortedWith(compareByDescending<Gasto> { it.cuandoOcurrio }.thenBy { it.id })
    }

    fun gastosFijos(): List<GastoFijo> = cola.entidadesDe("fixed_cost").mapNotNull { (id, c) ->
        GastoFijo(
            id = id,
            nombre = texto(c, "nombre") ?: return@mapNotNull null,
            moneda = texto(c, "moneda") ?: return@mapNotNull null,
            montoUnitarioMinor = numero(c, "monto_unitario_minor") ?: return@mapNotNull null,
            cantidad = numero(c, "cantidad") ?: return@mapNotNull null,
            metodoPago = texto(c, "metodo_pago"),
            pagadoEn = numero(c, "pagado_en"),
        )
    }.sortedWith(porNombre({ it.nombre }, { it.id }))
}
