package us.pixls.mart

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.graphics.Bitmap
import android.graphics.Color
import android.media.ThumbnailUtils
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.util.Base64
import android.util.Log
import android.util.Size
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.JsResult
import android.webkit.MimeTypeMap
import android.webkit.URLUtil
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.TextView
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * One full-screen WebView showing the MART client, served by the host that runs in this process
 * (libmart.so). The page talks to the app through window.martAndroid (client/src/native.ts).
 */
class MainActivity : Activity() {
    private lateinit var web: WebView
    private lateinit var status: TextView
    private lateinit var folders: FolderStore
    private var loaded = false
    private val debuggable get() = applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0

    /** the answer to the picker that is on screen (the page asks for one at a time) */
    private var pickerReply: ((JSONObject) -> Unit)? = null
    private var savePath: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        folders = FolderStore(this)
        val root = FrameLayout(this)
        root.setBackgroundColor(Color.BLACK)
        root.setOnApplyWindowInsetsListener { v, ins ->
            val i = ins.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
            v.setPadding(i.left, i.top, i.right, i.bottom)
            WindowInsets.CONSUMED
        }
        web = WebView(this)
        web.setBackgroundColor(Color.BLACK)
        web.overScrollMode = View.OVER_SCROLL_NEVER
        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
        }
        if (debuggable) WebView.setWebContentsDebuggingEnabled(true)
        web.addJavascriptInterface(Bridge(), "martAndroid")
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(v: WebView, r: WebResourceRequest): Boolean =
                !(r.url.host == "127.0.0.1" && r.url.port == Host.port)   // the page never leaves the host

            override fun onPageFinished(v: WebView, url: String) {
                // MART_EVAL (debugging, intent extra): a script to run when the page has loaded
                val js = if (debuggable) intent.getStringExtra("MART_EVAL") else null
                if (js != null) v.postDelayed({ v.evaluateJavascript(js, null) }, 2000)
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onJsAlert(v: WebView, url: String, message: String, r: JsResult): Boolean {
                AlertDialog.Builder(this@MainActivity).setMessage(message)
                    .setPositiveButton(android.R.string.ok) { _, _ -> r.confirm() }
                    .setOnCancelListener { r.cancel() }.show()
                return true
            }

            override fun onJsConfirm(v: WebView, url: String, message: String, r: JsResult): Boolean {
                AlertDialog.Builder(this@MainActivity).setMessage(message)
                    .setPositiveButton(android.R.string.ok) { _, _ -> r.confirm() }
                    .setNegativeButton(android.R.string.cancel) { _, _ -> r.cancel() }
                    .setOnCancelListener { r.cancel() }.show()
                return true
            }
        }
        // downloads (exports): fetched into the exports folder, then offered to the user to save
        web.setDownloadListener { url, _, cd, mime, _ -> download(url, cd, mime) }
        root.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        status = TextView(this)
        status.setTextColor(Color.LTGRAY)
        status.gravity = Gravity.CENTER
        status.textSize = 16f
        root.addView(status, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(root)
        startHost()
    }

    private fun startHost(restart: Boolean = false) {
        status.visibility = View.VISIBLE
        status.text = "Starting MART…"
        // MART_E2E_PORT / MART_OPEN (debugging, intent extras): fixed port and no token; open an image
        val e2e = if (debuggable) intent.getStringExtra("MART_E2E_PORT") else null
        val open = if (debuggable) intent.getStringExtra("MART_OPEN") else null
        Thread {
            try {
                if (restart) Host.stopAndWait()
                Assets.ensure(this)
                Host.start(this, e2e, open) { url ->
                    runOnUiThread {
                        if (url != null) { status.visibility = View.GONE; loaded = true; web.loadUrl(url) }
                        else status.text = "MART could not start."
                    }
                }
            } catch (e: Exception) {
                Log.e("MART", "start failed", e)
                runOnUiThread { status.text = "MART could not start: ${e.message}" }
            }
        }.start()
    }

    /** The app was in the background: the host may have died, restart it if so. */
    override fun onResume() {
        super.onResume()
        if (!loaded) return
        Thread { if (!Host.isAlive()) runOnUiThread { startHost(restart = true) } }.start()
    }

    @Deprecated("predictive back is turned off in the manifest")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else moveTaskToBack(true)
    }

    // ---- the bridge to the page (client/src/native.ts) ----

    private inner class Bridge {
        @JavascriptInterface
        fun post(id: String, json: String) {
            runOnUiThread {
                val answer = { o: JSONObject -> reply(id, o) }
                try { handle(JSONObject(json), answer) }
                catch (e: Exception) { answer(JSONObject().put("error", e.message ?: "error")) }
            }
        }
    }

    private fun reply(id: String, o: JSONObject) {
        val js = "window.__martNativeReply(${JSONObject.quote(id)}, ${JSONObject.quote(o.toString())})"
        runOnUiThread { web.evaluateJavascript(js, null) }
    }

    private fun handle(m: JSONObject, reply: (JSONObject) -> Unit) {
        when (m.optString("cmd")) {
            "folders" -> {
                val a = JSONArray()
                for (f in folders.folders()) a.put(JSONObject().put("path", f.path).put("name", f.name))
                reply(JSONObject().put("folders", a))
            }
            "thumbnail" -> {
                val path = m.optString("path")
                if (!folders.allowed(path)) return reply(JSONObject().put("error", "not an image of a chosen folder"))
                val side = m.optDouble("size", 256.0).coerceIn(32.0, 1024.0).toInt()
                Thread { reply(JSONObject().put("data", thumbnail(path, side) ?: JSONObject.NULL)) }.start()
            }
            "pickFolder" -> {
                if (pickerReply != null) return reply(JSONObject().put("error", "a file picker is already open"))
                if (!folders.hasAllFilesAccess()) {
                    // images are opened in place: that needs access to all files, granted in the settings
                    startActivity(Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:$packageName")))
                    return reply(JSONObject().put("error", "Allow access to all files for MART in the settings that opened, then choose the folder again."))
                }
                pickerReply = reply
                startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT_TREE), REQ_TREE)
            }
            "saveFile" -> {
                if (pickerReply != null) return reply(JSONObject().put("error", "a file picker is already open"))
                val f = File(m.optString("path")).canonicalFile
                if (!f.path.startsWith(Host.exportsDir(this).canonicalPath + "/") || !f.isFile)
                    return reply(JSONObject().put("error", "that file is not an export"))
                pickerReply = reply; savePath = f.path
                val mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(f.extension.lowercase())
                    ?: "application/octet-stream"
                startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                    .setType(mime).putExtra(Intent.EXTRA_TITLE, f.name), REQ_SAVE)
            }
            else -> reply(JSONObject().put("error", "unknown command"))
        }
    }

    /** a thumbnail as the system makes it, as a data: URL (null: none for this format) */
    private fun thumbnail(path: String, side: Int): String? = try {
        val bmp = ThumbnailUtils.createImageThumbnail(File(path), Size(side, side), null)
        val o = ByteArrayOutputStream(); bmp.compress(Bitmap.CompressFormat.JPEG, 80, o)
        "data:image/jpeg;base64," + Base64.encodeToString(o.toByteArray(), Base64.NO_WRAP)
    } catch (_: Exception) { null }

    @Deprecated("plain Activity API, no AndroidX")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        val reply = pickerReply; pickerReply = null
        val uri = if (resultCode == RESULT_OK) data?.data else null
        when (requestCode) {
            REQ_TREE -> {
                if (uri == null) { reply?.invoke(JSONObject().put("folder", JSONObject.NULL)); return }
                val f = folders.pathOf(uri)?.let { folders.add(it) }
                reply?.invoke(if (f == null) JSONObject().put("error", "cannot use that folder")
                              else JSONObject().put("folder", JSONObject().put("path", f.path).put("name", f.name)))
            }
            REQ_SAVE -> {
                val src = savePath; savePath = null
                if (uri == null || src == null) { reply?.invoke(JSONObject().put("saved", false)); return }
                Thread {
                    val ok = try {
                        contentResolver.openOutputStream(uri, "wt")!!.use { o -> File(src).inputStream().use { it.copyTo(o) } }; true
                    } catch (e: Exception) { Log.e("MART", "save failed", e); false }
                    runOnUiThread {
                        if (!ok) Toast.makeText(this, "Saving failed", Toast.LENGTH_LONG).show()
                        reply?.invoke(JSONObject().put("saved", ok))
                    }
                }.start()
            }
            else -> super.onActivityResult(requestCode, resultCode, data)
        }
    }

    // ---- downloads from the page (<a download>, attachments) ----

    private fun download(url: String, cd: String?, mime: String?) {
        val name = URLUtil.guessFileName(url, cd, mime)
        val cookie = CookieManager.getInstance().getCookie(url)
        Thread {
            try {
                val dst = File(Host.exportsDir(this), name)
                val c = URL(url).openConnection() as HttpURLConnection
                if (cookie != null) c.setRequestProperty("Cookie", cookie)
                c.inputStream.use { i -> dst.outputStream().use { i.copyTo(it) } }
                runOnUiThread {
                    if (pickerReply == null) handle(JSONObject().put("cmd", "saveFile").put("path", dst.path)) {}
                }
            } catch (e: Exception) {
                Log.e("MART", "download failed", e)
                runOnUiThread { Toast.makeText(this, "Download failed: ${e.message}", Toast.LENGTH_LONG).show() }
            }
        }.start()
    }

    companion object {
        private const val REQ_TREE = 1
        private const val REQ_SAVE = 2
    }
}
