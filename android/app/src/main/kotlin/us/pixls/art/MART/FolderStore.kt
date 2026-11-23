package us.pixls.art.MART

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
    class Folder(val path: String, val name: String, val needsAccess: Boolean = false)

    private val prefs = c.getSharedPreferences("mart", Context.MODE_PRIVATE)
    private val max = 8

    private fun saved(): MutableList<String> {
        val a = JSONArray(prefs.getString("folders", "[]"))
        return MutableList(a.length()) { a.getString(it) }
    }

    private fun save(l: List<String>) = prefs.edit().putString("folders", JSONArray(l).toString()).apply()

    fun hasAllFilesAccess(): Boolean = Environment.isExternalStorageManager()

    /**
     * The app's own folder, the device's Pictures and Camera (DCIM) folders (they need the all files
     * access: `needsAccess` says that it is not given yet), then the chosen ones (most recent first);
     * the host is told about the ones that can be read.
     */
    fun folders(): List<Folder> {
        val access = hasAllFilesAccess()
        val own = Host.imagesDir(c)
        val out = mutableListOf(Folder(own.path, "MART (this device)"))
        // pictures that other apps sent (the copies, see ExternalFile)
        if (File(own, "Received").isDirectory) out += Folder(File(own, "Received").path, "Received")
        for ((type, label) in listOf(Environment.DIRECTORY_PICTURES to "Pictures", Environment.DIRECTORY_DCIM to "Camera (DCIM)")) {
            val d = Environment.getExternalStoragePublicDirectory(type)
            if (!d.isDirectory) continue
            if (access) Host.addRoot(d.path)
            out += Folder(d.path, label, !access)
        }
        val list = saved()
        val keep = list.filter { File(it).isDirectory }
        if (keep.size != list.size) save(keep)
        if (access) for (p in keep) { Host.addRoot(p); out += Folder(p, File(p).name) }
        return out
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
