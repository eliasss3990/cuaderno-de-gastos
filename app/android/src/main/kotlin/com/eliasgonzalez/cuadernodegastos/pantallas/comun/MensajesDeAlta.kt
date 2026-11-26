// Qué se le dice a la persona según cómo terminó crear el viaje o unirse.
package com.eliasgonzalez.cuadernodegastos.pantallas.comun

import com.eliasgonzalez.cuadernodegastos.R
import com.eliasgonzalez.cuadernodegastos.red.Rechazo
import com.eliasgonzalez.cuadernodegastos.red.Resultado

/** El recurso del mensaje para una falla de crear o unirse. */
fun mensajeDeFalla(motivo: Resultado<Nothing>): Int = when (motivo) {
    Resultado.SinConexion -> R.string.alta_sin_conexion
    Resultado.Incierto -> R.string.alta_incierta
    Resultado.AppDesactualizada -> R.string.alta_app_desactualizada
    is Resultado.Rechazado -> when (motivo.motivo) {
        Rechazo.CODIGO_INVALIDO -> R.string.alta_codigo_invalido
        Rechazo.VIAJE_COMPLETO -> R.string.alta_viaje_completo
        Rechazo.DEMASIADOS_INTENTOS -> R.string.alta_demasiados_intentos
        else -> R.string.alta_rechazada
    }
    is Resultado.Ok -> R.string.alta_rechazada
}
