package com.eliasgonzalez.cuadernodegastos

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.work.NetworkType
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.testing.WorkManagerTestInitHelper
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class TareaPeriodicaTest {
    @Test
    fun quedaUnaSolaTareaCada15MinutosConRed() {
        val ctx = ApplicationProvider.getApplicationContext<Context>()
        WorkManagerTestInitHelper.initializeTestWorkManager(ctx)
        programarTareaPeriodica(ctx)
        programarTareaPeriodica(ctx)
        val tareas = WorkManager.getInstance(ctx).getWorkInfosForUniqueWork(CuadernoApp.TAREA_PERIODICA).get()
        assertEquals(1, tareas.size)
        val t = tareas.single()
        assertEquals(WorkInfo.State.ENQUEUED, t.state)
        assertEquals(NetworkType.CONNECTED, t.constraints.requiredNetworkType)
        assertEquals(15 * 60_000L, t.periodicityInfo!!.repeatIntervalMillis)
    }
}
