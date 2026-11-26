// Los puertos del servicio de viajes en la app: el cliente de identidad y la sincronización.
package com.eliasgonzalez.cuadernodegastos.viajes

import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Operacion
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Resultado as ResultadoDelMotor
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.FinDelCiclo
import com.eliasgonzalez.cuadernodegastos.dominio.sincronizacion.Sincronizador
import com.eliasgonzalez.cuadernodegastos.red.ClienteDeIdentidad
import com.eliasgonzalez.cuadernodegastos.red.Credenciales
import com.eliasgonzalez.cuadernodegastos.red.Perfil
import com.eliasgonzalez.cuadernodegastos.red.Resultado
import com.eliasgonzalez.cuadernodegastos.red.ViajeNuevo
import com.eliasgonzalez.cuadernodegastos.sincronizacion.Sincronizacion

class PuertosDeLaApp(private val identidad: ClienteDeIdentidad, private val sincronizacion: Sincronizacion) : PuertosDeViajes {
    override fun crear(viaje: ViajeNuevo, quien: Perfil): Resultado<Credenciales> = identidad.crearViaje(viaje, quien)

    override fun unirse(codigo: String, quien: Perfil): Resultado<Credenciales> = identidad.unirse(codigo, quien)

    override fun vincular(c: Credenciales) = sincronizacion.vincular(c)

    override fun vinculado(viaje: String): Boolean = viaje in sincronizacion.viajes()

    override fun sincronizar(viaje: String): FinDelCiclo = sincronizacion.cicloDe(viaje)

    override fun registrar(viaje: String, op: (Sincronizador) -> Operacion): ResultadoDelMotor = sincronizacion.registrar(viaje, op)
}
