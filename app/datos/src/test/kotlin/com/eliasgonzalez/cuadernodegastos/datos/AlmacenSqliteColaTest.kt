package com.eliasgonzalez.cuadernodegastos.datos

import com.eliasgonzalez.cuadernodegastos.dominio.operaciones.ContratoCola

/** La cola sobre SQLite cumple el mismo contrato que la de memoria. */
class AlmacenSqliteColaTest : ContratoCola() {
    override fun crear(): AlmacenSqlite {
        val base = BaseJdbc()
        Migraciones.aplicar(base)
        return AlmacenSqlite(base, "viaje-1")
    }
}
