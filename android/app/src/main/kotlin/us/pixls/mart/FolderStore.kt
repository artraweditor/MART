package us.pixls.mart

import android.content.Context
import android.os.Environment
import android.provider.DocumentsContract
import android.net.Uri
import org.json.JSONArray
import java.io.File

/**
 * The folders the user chose with the system's folder picker. Images are opened in place (the engine
 * needs real paths and writes the .arp sidecar next to the image), which needs the "all files access"
 * permission for folders outside the app's own. Each folder is also allowed to the host.
 */
class FolderStore(private val c: Context) {
    class Folder(val path: String, val name: String)

    private val prefs = c.getSharedPreferences("mart", Context.MODE_PRIVATE)
    private val max = 8

    private fun saved(): MutableList<String> {
        val a = JSONArray(prefs.getString("folders", "[]"))
        return MutableList(a.length()) { a.getString(it) }
    }

    private fun save(l: List<String>) = prefs.edit().putString("folders", JSONArray(l).toString()).apply()

    fun hasAllFilesAccess(): Boolean = Environment.isExternalStorageManager()

    /** the app's own folder, then the chosen ones (most recent first); the host is told about them */
    fun folders(): List<Folder> {
        val own = Host.imagesDir(c)
        val out = mutableListOf(Folder(own.path, "MART (this device)"))
        val list = saved()
        val keep = list.filter { File(it).isDirectory }
        if (keep.size != list.size) save(keep)
        if (hasAllFilesAccess()) for (p in keep) { Host.addRoot(p); out += Folder(p, File(p).name) }
        return out
    }

    fun allowed(path: String): Boolean {
        val p = File(path).canonicalPath
        val roots = folders().map { File(it.path).canonicalPath }
        return roots.any { p.startsWith("$it/") }
    }

    /** the path of a folder that the tree picker returned, or null (not on shared storage) */
    fun pathOf(tree: Uri): String? {
        val id = DocumentsContract.getTreeDocumentId(tree)           // "primary:Pictures/x" or "1234-ABCD:x"
        val i = id.indexOf(':'); if (i < 0) return null
        val vol = id.substring(0, i); val rel = id.substring(i + 1)
        val base = if (vol == "primary") Environment.getExternalStorageDirectory().path else "/storage/$vol"
        return File(base, rel).path
    }

    fun add(path: String): Folder? {
        val f = File(path)
        if (!f.isDirectory || !f.canRead() || Host.addRoot(f.path) != 0) return null
        val l = saved(); l.remove(f.path); l.add(0, f.path)
        save(l.take(max))
        return Folder(f.path, f.name)
    }
}
