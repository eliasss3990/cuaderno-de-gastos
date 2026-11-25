package com.eliasgonzalez.cuadernodegastos.datos

import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.Almacen
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.AlmacenObservable
import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.ContratoAlmacen

/** El almacén sobre SQLite cumple el mismo contrato que el de memoria. */
class AlmacenSqliteContratoTest : ContratoAlmacen() {
    override fun crear(): AlmacenObservable {
        val base = BaseJdbc()
        Migraciones.aplicar(base)
        val a = AlmacenSqlite(base, "viaje-1")
        return object : AlmacenObservable, Almacen by a {
            override fun instantanea() = a.instantanea()
            override fun secuencias() = a.secuencias()
        }
    }
}
