// La bienvenida: sin viajes en el celular, crear uno o unirse a uno con un código.
package com.eliasgonzalez.cuadernodegastos.pantallas.bienvenida

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.eliasgonzalez.cuadernodegastos.R
import com.eliasgonzalez.cuadernodegastos.ui.componentes.botones.BotonPrincipal
import com.eliasgonzalez.cuadernodegastos.ui.componentes.botones.BotonSecundario
import com.eliasgonzalez.cuadernodegastos.ui.tema.Tema
import com.eliasgonzalez.cuadernodegastos.ui.tema.TemaCuaderno

// Medidas propias de esta pantalla (posición del cuaderno y de los botones)
private val margenArriba = 90.dp
private val margenDeLaPortada = 10.dp
private val bajoElTitulo = 8.dp
private val margenAbajo = 34.dp
private val entreBotones = 10.dp
private val tamanoDelCuaderno = 76.sp

// Una sola columna con desplazamiento: con letra grande o pantalla baja, la portada y los botones no se enciman.
@Composable
fun BienvenidaPantalla(alCrearViaje: () -> Unit, alTenerCodigo: () -> Unit) {
    BoxWithConstraints(Modifier.fillMaxSize().background(Tema.colores.fondo).systemBarsPadding()) {
    // al menos el alto de la pantalla: la portada arriba y los botones abajo; si no entra, se desplaza
    Column(
        Modifier.verticalScroll(rememberScrollState()).heightIn(min = maxHeight).padding(horizontal = Tema.espacios.l),
        verticalArrangement = Arrangement.SpaceBetween,
    ) {
        Column(
            Modifier.fillMaxWidth().padding(top = margenArriba, start = margenDeLaPortada, end = margenDeLaPortada),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // decorativo: el lector de pantalla lo salta
            Text("📒", fontSize = tamanoDelCuaderno, modifier = Modifier.clearAndSetSemantics {})
            Spacer(Modifier.height(Tema.espacios.s))
            Text(
                stringResource(R.string.app_name_largo), style = Tema.texto.portada, color = Tema.colores.tinta, textAlign = TextAlign.Center,
                modifier = Modifier.semantics { heading() },
            )
            Spacer(Modifier.height(bajoElTitulo))
            Text(stringResource(R.string.bienvenida_bajada), style = Tema.texto.bajada, color = Tema.colores.apagado, textAlign = TextAlign.Center)
        }
        Column(Modifier.padding(top = Tema.espacios.xl), verticalArrangement = Arrangement.spacedBy(entreBotones)) {
        BotonPrincipal(stringResource(R.string.bienvenida_crear), alCrearViaje)
        BotonSecundario(stringResource(R.string.bienvenida_tengo_codigo), alTenerCodigo)
        Text(
            stringResource(R.string.bienvenida_aclaracion),
            style = Tema.texto.cuerpo.copy(fontSize = 14.sp),
            color = Tema.colores.etiqueta,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().padding(top = Tema.espacios.xs / 2, bottom = margenAbajo),
        )
        }
    }
    }
}

@Preview(widthDp = 390, heightDp = 844)
@Composable
private fun Vista() = TemaCuaderno { BienvenidaPantalla({}, {}) }
