package com.snapski.app.data.sync

import android.content.Context
import android.content.SharedPreferences
import android.net.Uri
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/** Parsed pairing payload: snapski://pair?v=1&url=<hub>&g=<group_id>&t=<token> */
data class Pairing(val hubUrl: String, val groupId: String, val token: String) {
    companion object {
        fun parse(raw: String): Pairing? {
            val s = raw.trim()
            val uri = runCatching { Uri.parse(s) }.getOrNull() ?: return null
            if (uri.scheme != "snapski" || uri.host != "pair") return null
            val url = uri.getQueryParameter("url")?.trimEnd('/') ?: return null
            val g = uri.getQueryParameter("g") ?: return null
            val t = uri.getQueryParameter("t") ?: return null
            if (url.isBlank() || g.isBlank() || t.isBlank()) return null
            return Pairing(url, g, t)
        }
    }
}

/**
 * Encrypted store for pairing secrets + sync bookkeeping. The token never
 * touches plain SharedPreferences or the index.
 */
class SyncPrefs(context: Context) {

    private val prefs: SharedPreferences = run {
        val key = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            "snapski_sync",
            key,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    var hubUrl: String?
        get() = prefs.getString("hubUrl", null)
        set(v) = prefs.edit().putString("hubUrl", v).apply()

    var groupId: String?
        get() = prefs.getString("groupId", null)
        set(v) = prefs.edit().putString("groupId", v).apply()

    var token: String?
        get() = prefs.getString("token", null)
        set(v) = prefs.edit().putString("token", v).apply()

    /** Last server seq we've applied from /changes. */
    var cursor: Long
        get() = prefs.getLong("cursor", 0)
        set(v) = prefs.edit().putLong("cursor", v).apply()

    /** Master on/off. Off = queue stands still, nothing uploads or pulls. */
    var enabled: Boolean
        get() = prefs.getBoolean("enabled", false)
        set(v) = prefs.edit().putBoolean("enabled", v).apply()

    var lastSyncAt: Long
        get() = prefs.getLong("lastSyncAt", 0)
        set(v) = prefs.edit().putLong("lastSyncAt", v).apply()

    /** Bytes used on the server for this group (from last /changes). */
    var serverUsed: Long
        get() = prefs.getLong("serverUsed", 0)
        set(v) = prefs.edit().putLong("serverUsed", v).apply()

    var serverQuota: Long
        get() = prefs.getLong("serverQuota", 0)
        set(v) = prefs.edit().putLong("serverQuota", v).apply()

    val isPaired: Boolean
        get() = !hubUrl.isNullOrBlank() && !groupId.isNullOrBlank() && !token.isNullOrBlank()

    fun applyPairing(p: Pairing) {
        prefs.edit()
            .putString("hubUrl", p.hubUrl)
            .putString("groupId", p.groupId)
            .putString("token", p.token)
            .putBoolean("enabled", true)
            .apply()
    }

    fun unpair() {
        prefs.edit()
            .remove("hubUrl").remove("groupId").remove("token")
            .remove("cursor").remove("lastSyncAt")
            .remove("serverUsed").remove("serverQuota")
            .putBoolean("enabled", false)
            .apply()
    }
}
