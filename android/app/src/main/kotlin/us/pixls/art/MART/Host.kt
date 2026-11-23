package us.pixls.art.MART

import android.content.Context
import android.system.Os
import android.util.Log
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.SecureRandom

/**
 * The MART host (C++, in libmart.so): runs on a thread with a big stack and tells when it is
 * listening. libART.so is loaded by the host itself, with dlopen() of its path.
 */
object Host {
    fun interface Ready { fun ready(port: Int, token: String) }

    init { System.loadLibrary("mart") }

    @JvmStatic external fun run(args: Array<String>, cb: Ready): Int
    @JvmStatic external fun stop()
    @JvmStatic external fun addRoot(dir: String): Int

    @Volatile var port = 0
        private set
    @Volatile var token = ""
        private set
    private var running = false
    private var thread: Thread? = null
    private val lock = Object()

    val url: String? get() = if (port == 0) null else "http://127.0.0.1:$port/?token=$token"

    private fun randomToken(): String {
        val b = ByteArray(16); SecureRandom().nextBytes(b)
        return b.joinToString("") { "%02x".format(it) }
    }

    /** the files that the host reads: the client and the engine's data, copied out of the APK */
    fun wwwDir(c: Context) = File(c.filesDir, "www")
    fun dataDir(c: Context) = File(c.filesDir, "art-data")
    /** the app's own images folder (also reachable with adb and the Files app) */
    fun imagesDir(c: Context): File =
        (c.getExternalFilesDir("Images") ?: File(c.filesDir, "Images")).also { it.mkdirs() }
    fun exportsDir(c: Context) = File(c.cacheDir, "exports").also { it.mkdirs() }

    private fun arguments(c: Context, e2ePort: String?, open: String?): Array<String> {
        val support = File(c.filesDir, "MART").also { it.mkdirs() }
        for (d in listOf("art", "profiles", "luts")) File(support, d).mkdirs()
        val cache = File(c.cacheDir, "art").also { it.mkdirs() }
        val access = if (e2ePort != null) listOf("--port", e2ePort)
                     else listOf("--port", "0", "--require-token", "--token", token)
        var args = listOf("mart", "--listen", "127.0.0.1") + access + listOf(
            "--www", wwwDir(c).path,
            "--data", dataDir(c).path,
            "--library", c.applicationInfo.nativeLibraryDir + "/libART.so",
            "--root", imagesDir(c).path,
            "--profiles", File(support, "profiles").path,
            "--luts", File(support, "luts").path,
            "--export-dir", exportsDir(c).path,
            "--art-config", File(support, "art").path,
            "--art-cache", cache.path,
        )
        if (open != null) args += open
        return args.toTypedArray()
    }

    /** Start the host (if it is not running); `ready` is called (on the host's thread) with the address, or null. */
    fun start(c: Context, e2ePort: String? = null, open: String? = null, ready: (String?) -> Unit) {
        synchronized(lock) {
            if (running) { ready(url); return }
            running = true; port = 0; token = randomToken()
        }
        // the host uses $TMPDIR and $HOME (the app's folders; the defaults do not exist on Android)
        Os.setenv("TMPDIR", c.cacheDir.path, true)
        Os.setenv("HOME", c.filesDir.path, true)
        val args = arguments(c.applicationContext, e2ePort, open)
        val t = Thread(null, {
            val rc = run(args) { p, tk ->
                port = p
                if (tk.isNotEmpty()) token = tk
                ready(url)
            }
            Log.i("MART", "host returned rc=$rc")
            synchronized(lock) { running = false; port = 0; lock.notifyAll() }
            if (rc != 0) ready(null)
        }, "MART host", 8L shl 20)
        thread = t
        t.start()
    }

    /** Stop the host and wait until it has returned. */
    fun stopAndWait() {
        synchronized(lock) { if (!running) return }
        stop()
        synchronized(lock) {
            val end = System.currentTimeMillis() + 10_000
            while (running && System.currentTimeMillis() < end) lock.wait(500)
        }
    }

    /** Whether the server answers (call from a background thread). */
    fun isAlive(): Boolean {
        val p = port; if (p == 0) return false
        return try {
            val c = URL("http://127.0.0.1:$p/api/status?token=$token").openConnection() as HttpURLConnection
            c.connectTimeout = 3000; c.readTimeout = 3000
            val ok = c.responseCode == 200
            c.disconnect(); ok
        } catch (_: Exception) { false }
    }
}
