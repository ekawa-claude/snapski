package com.snapski.app

import android.app.Application
import com.snapski.app.data.LibraryRepository
import com.snapski.app.data.ScreenshotImporter
import com.snapski.app.data.sync.SyncEngine
import com.snapski.app.data.sync.SyncPrefs
import com.snapski.app.data.sync.SyncScheduler
import com.snapski.app.data.sync.SyncSse
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class SnapSkiApp : Application() {
    lateinit var library: LibraryRepository
        private set
    lateinit var syncPrefs: SyncPrefs
        private set
    lateinit var syncEngine: SyncEngine
        private set
    lateinit var syncSse: SyncSse
        private set
    lateinit var screenshots: ScreenshotImporter
        private set

    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    override fun onCreate() {
        super.onCreate()
        library = LibraryRepository(this)
        screenshots = ScreenshotImporter(this, library)
        syncPrefs = SyncPrefs(this)
        syncEngine = SyncEngine(library, syncPrefs)
        // Live push: an SSE ping just runs the normal sync cycle.
        syncSse = SyncSse(syncPrefs) { appScope.launch { syncEngine.sync() } }
        SyncScheduler.schedulePeriodic(this)
    }
}
