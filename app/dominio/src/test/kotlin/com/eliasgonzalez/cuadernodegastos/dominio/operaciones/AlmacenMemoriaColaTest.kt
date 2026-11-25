package com.eliasgonzalez.cuadernodegastos.dominio.operaciones

/** La cola en memoria cumple el contrato común (el mismo que corre la de SQLite). */
class AlmacenMemoriaColaTest : ContratoCola() {
    override fun crear() = AlmacenMemoria()
}
