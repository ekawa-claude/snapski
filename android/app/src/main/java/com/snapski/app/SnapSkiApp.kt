package com.snapski.app

import android.app.Application
import com.snapski.app.data.LibraryRepository

class SnapSkiApp : Application() {
    lateinit var library: LibraryRepository
        private set

    override fun onCreate() {
        super.onCreate()
        library = LibraryRepository(this)
    }
}
