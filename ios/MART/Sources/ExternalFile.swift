import Foundation

/// A file that comes from outside the app (Files "Open in…", the share sheet, the photo library).
/// The engine needs a file with its sidecar next to it, and the app only has access to the file
/// itself, so it is copied to the app's own images folder (Documents/Images/<sub>, also seen in the
/// Files app) and edited there. The same file sent again keeps its sidecar.
enum ExternalFile {
    /// the path of the copy (or of the file itself if it is already in the app's images folder)
    static func importFile(at url: URL, into sub: String, name: String? = nil) -> String? {
        var result: String?
        var coordinationError: NSError?
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        // coordinated: a file of iCloud Drive may have to be downloaded first
        NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordinationError) { u in
            result = copy(u, into: sub, name: name)
        }
        return result
    }

    private static func copy(_ url: URL, into sub: String, name: String?) -> String? {
        let fm = FileManager.default
        let images = URL(fileURLWithPath: HostController.shared.imagesDir).resolvingSymlinksInPath()
        if url.resolvingSymlinksInPath().path.hasPrefix(images.path + "/") { return url.path }
        let dir = images.appendingPathComponent(sub, isDirectory: true)
        do { try fm.createDirectory(at: dir, withIntermediateDirectories: true) } catch { return nil }
        let fileName = (name ?? url.lastPathComponent).replacingOccurrences(of: "/", with: "_")
        let base = (fileName as NSString).deletingPathExtension, ext = (fileName as NSString).pathExtension
        let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? -1
        var dest = dir.appendingPathComponent(fileName)
        var n = 1
        while fm.fileExists(atPath: dest.path) {
            let have = (try? dest.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? -2
            if size >= 0 && have == size { return dest.path }       // the same picture again
            dest = dir.appendingPathComponent(ext.isEmpty ? "\(base)-\(n)" : "\(base)-\(n).\(ext)")
            n += 1
        }
        do { try fm.copyItem(at: url, to: dest) } catch { return nil }
        return dest.path
    }
}
