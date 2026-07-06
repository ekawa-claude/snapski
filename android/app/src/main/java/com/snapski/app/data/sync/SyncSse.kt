package com.snapski.app.data.sync

import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import java.util.concurrent.TimeUnit

/**
 * Live push channel: holds the hub's /events SSE stream open while the app is
 * in the foreground and runs a sync on every `changed` ping. Foreground-only —
 * background sync stays with WorkManager. Reconnects with backoff.
 */
class SyncSse(
    private val prefs: SyncPrefs,
    private val onPing: () -> Unit,
) {
    private val TAG = "SyncSse"

    // No read timeout: an SSE stream is meant to stay open indefinitely.
    private val client = OkHttpClient.Builder()
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .retryOnConnectionFailure(true)
        .build()

    private var scope: CoroutineScope? = null
    private var source: EventSource? = null
    private var reconnect: Job? = null

    fun start() {
        if (scope != null) return
        scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        connect(1000)
    }

    fun stop() {
        source?.cancel()
        source = null
        reconnect?.cancel()
        reconnect = null
        scope?.cancel()
        scope = null
    }

    private fun connect(backoffMs: Long) {
        val s = scope ?: return
        if (!prefs.enabled || !prefs.isPaired) return
        val base = prefs.hubUrl?.trimEnd('/') ?: return
        val auth = "Bearer ${prefs.groupId}:${prefs.token}"
        val req = Request.Builder().url("$base/events").header("Authorization", auth).build()

        source = EventSources.createFactory(client).newEventSource(
            req,
            object : EventSourceListener() {
                override fun onEvent(es: EventSource, id: String?, type: String?, data: String) {
                    onPing()
                }

                override fun onFailure(es: EventSource, t: Throwable?, response: Response?) {
                    response?.close()
                    source = null
                    // Reconnect with capped exponential backoff while still wanted.
                    reconnect?.cancel()
                    reconnect = s.launch {
                        delay(backoffMs)
                        connect((backoffMs * 2).coerceAtMost(30_000))
                    }
                    Log.d(TAG, "sse dropped, reconnect in ${backoffMs}ms")
                }
            },
        )
    }
}
