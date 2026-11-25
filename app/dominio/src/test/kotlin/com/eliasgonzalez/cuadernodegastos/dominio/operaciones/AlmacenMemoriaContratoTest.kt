package com.eliasgonzalez.cuadernodegastos.dominio.operaciones

/** El almacén en memoria cumple el contrato común (el mismo que corre el de SQLite). */
class AlmacenMemoriaContratoTest : ContratoAlmacen() {
    override fun crear(): AlmacenObservable {
        val m = AlmacenMemoria()
        return object : AlmacenObservable, Almacen by m {
            override fun instantanea() = m.instantanea()
            override fun secuencias() = m.secuencias()
        }
    }
}
