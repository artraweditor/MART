import Foundation

/// Runs the MART host (C++, linked into the app) on a thread with a big stack and
/// tells when it is listening.
final class HostController {
    static let shared = HostController()

    private(set) var port: Int = 0
    private(set) var token: String = ""
    private var running = false
    private var finished = DispatchSemaphore(value: 0)
    private let lock = NSLock()

    var url: URL? {
        port == 0 ? nil : URL(string: "http://127.0.0.1:\(port)/?token=\(token)")
    }

    private let fm = FileManager.default

    private func dir(_ base: FileManager.SearchPathDirectory, _ sub: String) -> String {
        let u = fm.urls(for: base, in: .userDomainMask)[0].appendingPathComponent(sub, isDirectory: true)
        try? fm.createDirectory(at: u, withIntermediateDirectories: true)
        return u.path
    }

    /// The folder where the user puts the images (visible in the Files app).
    var imagesDir: String { dir(.documentDirectory, "Images") }
    var exportsDir: String { dir(.documentDirectory, "Exports") }

    private func randomToken() -> String {
        var bytes = [UInt8](repeating: 0, count: 16)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return bytes.map { String(format: "%02x", $0) }.joined()
    }

    private func arguments() -> [String] {
        let bundle = Bundle.main.bundlePath
        let support = dir(.applicationSupportDirectory, "MART")
        // MART_E2E_PORT (set by ios/e2e-sim.sh through simctl): fixed port and no token, for the
        // e2e scripts of host/tests, which do not know about tokens
        let e2ePort = ProcessInfo.processInfo.environment["MART_E2E_PORT"]
        let access = e2ePort != nil ? ["--port", e2ePort!] : ["--port", "0", "--require-token", "--token", token]
        var args = [
            "mart",
            "--listen", "127.0.0.1"] + access + [
            "--www", bundle + "/www",
            "--data", bundle + "/art-data",
            "--library", bundle + "/Frameworks/ART.framework/ART",
            "--root", imagesDir,
            "--profiles", support + "/profiles",
            "--luts", support + "/luts",
            "--export-dir", exportsDir,
            "--art-config", support + "/art",
            "--art-cache", dir(.cachesDirectory, "MART"),
        ]
        // MART_OPEN (debugging, through simctl): open this image at start
        if let img = ProcessInfo.processInfo.environment["MART_OPEN"] { args.append(img) }
        for d in [support + "/art", support + "/profiles", support + "/luts"] {
            try? fm.createDirectory(atPath: d, withIntermediateDirectories: true)
        }
        return args
    }

    /// Start the host (if it is not running); `ready` is called on the main queue
    /// with the address to load, or nil if it did not start in time.
    func start(ready: @escaping (URL?) -> Void) {
        lock.lock()
        if running { lock.unlock(); ready(url); return }
        running = true
        port = 0
        token = randomToken()
        lock.unlock()

        let box = Unmanaged.passRetained(ReadyBox { [weak self] p, t in
            guard let self = self else { return }
            self.port = p
            self.token = t
            DispatchQueue.main.async { ready(self.url) }
        })
        let args = arguments()
        let thread = Thread { [weak self] in
            var cargs: [UnsafeMutablePointer<CChar>?] = args.map { strdup($0) }
            cargs.append(nil)
            let rc = mart_run(Int32(args.count), &cargs, { port, token, user in
                let b = Unmanaged<ReadyBox>.fromOpaque(user!).takeUnretainedValue()
                b.fn(Int(port), token.map { String(cString: $0) } ?? "")
            }, box.toOpaque())
            for p in cargs { free(p) }
            box.release()
            NSLog("MART host stopped (rc=\(rc))")
            self?.lock.lock()
            self?.running = false
            self?.port = 0
            self?.lock.unlock()
            self?.finished.signal()
            if rc != 0 { DispatchQueue.main.async { ready(nil) } }
        }
        thread.stackSize = 8 << 20
        thread.name = "MART host"
        thread.start()
    }

    /// Stop the host and wait until it has returned.
    func stop() {
        lock.lock(); let r = running; lock.unlock()
        guard r else { return }
        mart_stop()
        _ = finished.wait(timeout: .now() + 10)
    }

    func restart(ready: @escaping (URL?) -> Void) {
        DispatchQueue.global().async {
            self.stop()
            DispatchQueue.main.async { self.start(ready: ready) }
        }
    }

    /// Whether the server answers.
    func isAlive(_ done: @escaping (Bool) -> Void) {
        guard port != 0, let u = URL(string: "http://127.0.0.1:\(port)/api/status?token=\(token)") else { return done(false) }
        var req = URLRequest(url: u); req.timeoutInterval = 3
        URLSession.shared.dataTask(with: req) { _, resp, err in
            DispatchQueue.main.async { done(err == nil && (resp as? HTTPURLResponse)?.statusCode == 200) }
        }.resume()
    }
}

private final class ReadyBox {
    let fn: (Int, String) -> Void
    init(_ fn: @escaping (Int, String) -> Void) { self.fn = fn }
}
