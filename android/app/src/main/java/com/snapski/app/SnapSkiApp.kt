package com.snapski.app

import android.app.Application
import com.snapski.app.data.LibraryRepository
import com.snapski.app.data.sync.SyncEngine
import com.snapski.app.data.sync.SyncPrefs
import com.snapski.app.data.sync.SyncScheduler

class SnapSkiApp : Application() {
    lateinit var library: LibraryRepository
        private set
    lateinit var syncPrefs: SyncPrefs
        private set
    lateinit var syncEngine: SyncEngine
        private set

    override fun onCreate() {
        super.onCreate()
        library = LibraryRepository(this)
        syncPrefs = SyncPrefs(this)
        syncEngine = SyncEngine(library, syncPrefs)
        SyncScheduler.schedulePeriodic(this)
    }
}
