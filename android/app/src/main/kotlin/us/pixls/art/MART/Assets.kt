package us.pixls.art.MART

import android.content.Context
import java.io.File

/**
 * The client (www) and the engine's data (art-data) are in the APK's assets; the host needs
 * plain files, so they are copied to filesDir. A stamp (the install time of this version) says
 * that the copy is complete and current.
 */
object Assets {
    private fun stamp(c: Context): String {
        val pi = c.packageManager.getPackageInfo(c.packageName, 0)
        return "${pi.longVersionCode}-${pi.lastUpdateTime}"
    }

    fun ensure(c: Context) {
        val s = stamp(c)
        val mark = File(c.filesDir, "assets.stamp")
        if (mark.exists() && mark.readText() == s && Host.wwwDir(c).isDirectory && Host.dataDir(c).isDirectory) return
        mark.delete()
        for (name in listOf("www", "art-data")) {
            val dst = File(c.filesDir, name)
            dst.deleteRecursively()
            copy(c, name, dst)
        }
        mark.writeText(s)
    }

    private fun copy(c: Context, path: String, dst: File) {
        val list = c.assets.list(path) ?: emptyArray()
        if (list.isEmpty()) {
            dst.parentFile?.mkdirs()
            c.assets.open(path).use { i -> dst.outputStream().use { o -> i.copyTo(o) } }
        } else {
            dst.mkdirs()
            for (n in list) copy(c, "$path/$n", File(dst, n))
        }
    }
}
