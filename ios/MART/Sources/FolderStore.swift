import Foundation

/// The folders that the user chose in the Files picker. The app opens images in place: a
/// folder keeps its security-scoped access for as long as the app runs, and a bookmark lets it
/// be used again after a restart. Each folder is also allowed to the host (mart_add_root).
final class FolderStore {
    static let shared = FolderStore()
    private let key = "mart.folders"
    private let maxFolders = 8
    private var open: [String: URL] = [:]   // path -> url with access started

    struct Folder { let path: String; let name: String }

    /// The app's own Documents/Images (also in the Files app), then the chosen folders, most
    /// recent first. Their access is started and the host is told.
    func folders() -> [Folder] {
        var out = [Folder(path: HostController.shared.imagesDir, name: "MART (this iPad)")]
        var bookmarks = UserDefaults.standard.array(forKey: key) as? [Data] ?? []
        var changed = false
        for (i, data) in bookmarks.enumerated().reversed() {
            var stale = false
            guard let url = try? URL(resolvingBookmarkData: data, options: [], relativeTo: nil,
                                     bookmarkDataIsStale: &stale),
                  activate(url) else {
                bookmarks.remove(at: i); changed = true   // gone, or no longer allowed
                continue
            }
            if stale, let fresh = try? url.bookmarkData(options: [], includingResourceValuesForKeys: nil,
                                                        relativeTo: nil) {
                bookmarks[i] = fresh; changed = true
            }
        }
        for data in bookmarks {
            var stale = false
            if let url = try? URL(resolvingBookmarkData: data, options: [], relativeTo: nil,
                                  bookmarkDataIsStale: &stale) {
                out.append(Folder(path: url.path, name: url.lastPathComponent))
            }
        }
        if changed { UserDefaults.standard.set(bookmarks, forKey: key) }
        return out
    }

    /// Whether the path is in the app's own images folder or in a folder that was chosen.
    func allowed(_ path: String) -> Bool {
        let p = URL(fileURLWithPath: path).standardizedFileURL.path
        let roots = [HostController.shared.imagesDir] + open.keys
        return roots.contains { p.hasPrefix(URL(fileURLWithPath: $0).standardizedFileURL.path + "/") }
    }

    /// A folder that the user has just picked (the picker gave access to it).
    func add(_ url: URL) -> Folder? {
        guard activate(url),
              let data = try? url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
        else { return nil }
        var list = UserDefaults.standard.array(forKey: key) as? [Data] ?? []
        // the same folder again: move it to the front
        list.removeAll { d in
            var s = false
            return (try? URL(resolvingBookmarkData: d, options: [], relativeTo: nil, bookmarkDataIsStale: &s))?.path == url.path
        }
        list.insert(data, at: 0)
        if list.count > maxFolders { list.removeLast(list.count - maxFolders) }
        UserDefaults.standard.set(list, forKey: key)
        return Folder(path: url.path, name: url.lastPathComponent)
    }

    private func activate(_ url: URL) -> Bool {
        if open[url.path] == nil {
            guard url.startAccessingSecurityScopedResource() else { return false }
            open[url.path] = url
        }
        return mart_add_root(url.path) == 0
    }
}
