package com.snapski.app.data.sync

import com.snapski.app.data.PendingOp
import com.snapski.app.data.Shot
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.File
import java.util.concurrent.TimeUnit

/** Non-2xx response from the hub. code 507 == group storage full. */
class HubException(val code: Int, message: String) : Exception("hub $code: $message")

data class ChangeItem(
    val seq: Long,
    val kind: String,           // shot | favorite | delete
    val shotId: String,
    val ts: Long?,
    val value: Boolean?,        // favorite
    val meta: JSONObject?,      // shot: {id, createdAt, favorite, source, editedFrom}
)

data class ChangesResponse(
    val changes: List<ChangeItem>,
    val next: Long,
    val hasMore: Boolean,
    val usage: Long,
    val quota: Long,
)

/**
 * Thin okhttp wrapper over the SnapSki hub. Android only joins a group (the
 * token arrives via QR), so there's no register() here — just push and pull.
 */
class HubApi(private val prefs: SyncPrefs) {

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    private fun base(): String =
        prefs.hubUrl?.trimEnd('/') ?: throw IllegalStateException("not paired: no hub url")

    private fun auth(): String {
        val g = prefs.groupId ?: throw IllegalStateException("not paired: no group")
        val t = prefs.token ?: throw IllegalStateException("not paired: no token")
        return "Bearer $g:$t"
    }

    /** POST /shots. Returns the server seq for this shot. */
    fun uploadShot(shot: Shot, file: File): Long {
        val meta = JSONObject().apply {
            put("id", shot.id)
            put("createdAt", shot.createdAt)
            put("favorite", shot.favorite)
            put("source", shot.source)
            shot.editedFrom?.let { put("editedFrom", it) }
        }.toString()

        val body = MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart("meta", meta)
            .addFormDataPart(
                "file", "${shot.id}.png",
                file.asRequestBody("image/png".toMediaType()),
            )
            .build()

        val req = Request.Builder()
            .url("${base()}/shots")
            .header("Authorization", auth())
            .post(body)
            .build()

        client.newCall(req).execute().use { resp ->
            val text = resp.body?.string().orEmpty()
            if (!resp.isSuccessful) throw HubException(resp.code, text)
            return JSONObject(text).getLong("seq")
        }
    }

    /** POST /ops. Returns the server seq. */
    fun postOp(op: PendingOp): Long {
        val json = JSONObject().apply {
            put("kind", op.kind)
            put("shot_id", op.shotId)
            op.value?.let { put("value", it) }
            put("ts", op.ts)
        }.toString()

        val req = Request.Builder()
            .url("${base()}/ops")
            .header("Authorization", auth())
            .post(json.toRequestBody("application/json".toMediaType()))
            .build()

        client.newCall(req).execute().use { resp ->
            val text = resp.body?.string().orEmpty()
            if (!resp.isSuccessful) throw HubException(resp.code, text)
            return JSONObject(text).getLong("seq")
        }
    }

    /** GET /changes?since= */
    fun getChanges(since: Long): ChangesResponse {
        val req = Request.Builder()
            .url("${base()}/changes?since=$since")
            .header("Authorization", auth())
            .get()
            .build()

        client.newCall(req).execute().use { resp ->
            val text = resp.body?.string().orEmpty()
            if (!resp.isSuccessful) throw HubException(resp.code, text)
            val o = JSONObject(text)
            val arr = o.getJSONArray("changes")
            val items = (0 until arr.length()).map { i ->
                val c = arr.getJSONObject(i)
                ChangeItem(
                    seq = c.getLong("seq"),
                    kind = c.getString("kind"),
                    shotId = c.getString("shot_id"),
                    ts = if (c.has("ts") && !c.isNull("ts")) c.getLong("ts") else null,
                    value = if (c.has("value") && !c.isNull("value")) c.getBoolean("value") else null,
                    meta = if (c.has("meta") && !c.isNull("meta")) c.getJSONObject("meta") else null,
                )
            }
            return ChangesResponse(
                changes = items,
                next = o.getLong("next"),
                hasMore = o.optBoolean("has_more"),
                usage = o.optLong("usage"),
                quota = o.optLong("quota"),
            )
        }
    }

    /** GET /shots/{id}/file → write bytes into [dest]. */
    fun downloadFile(shotId: String, dest: File) {
        val req = Request.Builder()
            .url("${base()}/shots/$shotId/file")
            .header("Authorization", auth())
            .get()
            .build()

        client.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) throw HubException(resp.code, "download failed")
            val bytes = resp.body?.bytes() ?: throw HubException(resp.code, "empty body")
            dest.outputStream().use { it.write(bytes) }
        }
    }
}
