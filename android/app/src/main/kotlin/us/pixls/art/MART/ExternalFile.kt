package us.pixls.art.MART

import android.content.ContentUris
import android.content.Context
import android.net.Uri
import android.os.Environment
import android.util.Log
import android.provider.DocumentsContract
import android.provider.MediaStore
import android.provider.OpenableColumns
import java.io.File

/**
 * A picture that another app hands over (a file manager's "open with" or "send to"): a file: or
 * content: address. The engine needs a real file, with its sidecar next to it:
 * - when the address maps to a file that the app may read (it has all files access), the picture is
 *   edited in place;
 * - otherwise it is copied to the app's own folder (Images/Received), and edited there.
 */
object ExternalFile {
    /** the path to open (call from a background thread), or null if the file cannot be read */
    fun resolve(c: Context, uri: Uri, allFiles: Boolean): String? = try {
        (if (allFiles) inPlace(c, uri) else null) ?: copy(c, uri)
    } catch (e: Exception) {   // no read permission for the address, the provider is gone, ...
        Log.w("MART", "cannot read $uri", e)
        null
    }

    /** whether the path is in a folder that the host already allows (the app's own images folder) */
    fun inOwnFolder(c: Context, path: String): Boolean =
        File(path).canonicalPath.startsWith(Host.imagesDir(c).canonicalPath + "/")

    private fun inPlace(c: Context, uri: Uri): String? {
        val path = try {
            when (uri.scheme) {
                "file" -> uri.path
                "content" -> when (uri.authority) {
                    "com.android.externalstorage.documents" -> storagePath(DocumentsContract.getDocumentId(uri))
                    "com.android.providers.downloads.documents" -> {
                        val id = DocumentsContract.getDocumentId(uri)
                        if (id.startsWith("raw:")) id.removePrefix("raw:") else null
                    }
                    "com.android.providers.media.documents" -> {
                        val id = DocumentsContract.getDocumentId(uri)
                        if (id.startsWith("image:"))
                            mediaPath(c, ContentUris.withAppendedId(
                                MediaStore.Images.Media.getContentUri("external"), id.substringAfter(':').toLong()))
                        else null
                    }
                    "media" -> mediaPath(c, uri)
                    else -> null
                }
                else -> null
            }
        } catch (_: Exception) { null }
        val f = path?.let { File(it) } ?: return null
        return if (f.isFile && f.canRead()) f.path else null
    }

    /** "primary:Pictures/x.arw" or "1234-ABCD:x.arw" -> its path */
    private fun storagePath(docId: String): String? {
        val i = docId.indexOf(':'); if (i < 0) return null
        val vol = docId.substring(0, i); val rel = docId.substring(i + 1)
        val base = if (vol == "primary") Environment.getExternalStorageDirectory().path else "/storage/$vol"
        return File(base, rel).path
    }

    @Suppress("DEPRECATION")
    private fun mediaPath(c: Context, uri: Uri): String? =
        c.contentResolver.query(uri, arrayOf(MediaStore.MediaColumns.DATA), null, null, null)?.use {
            if (it.moveToFirst()) it.getString(0) else null
        }

    private fun displayName(c: Context, uri: Uri): String? {
        if (uri.scheme == "file") return uri.lastPathSegment
        return c.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
            if (it.moveToFirst()) it.getString(0) else null
        } ?: uri.lastPathSegment
    }

    private fun copy(c: Context, uri: Uri): String? {
        val dir = File(Host.imagesDir(c), "Received").also { it.mkdirs() }
        val raw = (displayName(c, uri) ?: "image").substringAfterLast('/')
        val name = raw.replace(Regex("[^A-Za-z0-9._ ()-]"), "_").ifEmpty { "image" }
        val dot = name.lastIndexOf('.')
        val stem = if (dot > 0) name.substring(0, dot) else name
        val ext = if (dot > 0) name.substring(dot) else ""
        val size = try { c.contentResolver.openAssetFileDescriptor(uri, "r")?.use { it.length } ?: -1L } catch (_: Exception) { -1L }
        // the same picture sent again keeps its sidecar; another one with the same name gets a new name
        var dest = File(dir, name)
        var n = 1
        while (dest.exists() && !(size >= 0 && dest.length() == size)) dest = File(dir, "$stem-${n++}$ext")
        if (dest.exists()) return dest.path
        return try {
            val input = c.contentResolver.openInputStream(uri) ?: throw java.io.FileNotFoundException("no stream for $uri")
            input.use { i -> dest.outputStream().use { i.copyTo(it) } }
            dest.path
        } catch (e: Exception) { Log.w("MART", "cannot copy $uri", e); dest.delete(); null }
    }
}
