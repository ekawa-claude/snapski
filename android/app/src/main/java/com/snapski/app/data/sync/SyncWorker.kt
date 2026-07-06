package com.snapski.app.data.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.snapski.app.SnapSkiApp

/** Runs one push+pull cycle. Retries on transient (network/hub) errors. */
class SyncWorker(context: Context, params: WorkerParameters) :
    CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val app = applicationContext as SnapSkiApp
        val status = app.syncEngine.sync()
        return if (status.lastError != null) Result.retry() else Result.success()
    }
}
