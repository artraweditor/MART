import Foundation
import UIKit
import os

/// Writes the memory use of the app to Library/Caches/MART/memory.log (the log of the run
/// before is kept in memory.prev.log), to find out why iOS kills the app: the last lines
/// before a kill show how much it used. Read it from the Mac with
///   xcrun devicectl device copy from --device ID --domain-type appDataContainer
///       --domain-identifier us.pixls.art.MART --source Library/Caches/MART/memory.log --destination .
final class MemoryLog {
    static let shared = MemoryLog()
    private var handle: FileHandle?
    private var timer: DispatchSourceTimer?
    private var lastLogged: Double = 0
    private var lastTime = Date.distantPast
    private let df: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "HH:mm:ss"; return f
    }()

    /// Memory counted against the app by the system (MB): what jetsam looks at.
    static func footprintMB() -> Double {
        var info = task_vm_info_data_t()
        var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
        let kr = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
            }
        }
        return kr == KERN_SUCCESS ? Double(info.phys_footprint) / 1_048_576 : 0
    }

    func start() {
        let fm = FileManager.default
        let dir = fm.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("MART")
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        let path = dir.appendingPathComponent("memory.log"), prev = dir.appendingPathComponent("memory.prev.log")
        try? fm.removeItem(at: prev)
        try? fm.moveItem(at: path, to: prev)
        fm.createFile(atPath: path.path, contents: nil)
        handle = try? FileHandle(forWritingTo: path)
        log("start, \(ProcessInfo.processInfo.physicalMemory >> 20) MB of RAM, \(ProcessInfo.processInfo.activeProcessorCount) cores")

        let nc = NotificationCenter.default
        nc.addObserver(forName: UIApplication.didReceiveMemoryWarningNotification, object: nil, queue: .main) { [weak self] _ in
            self?.log("MEMORY WARNING")
        }
        nc.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
            self?.log("background")
        }
        nc.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { [weak self] _ in
            self?.log("foreground")
        }
        // every second, written when it changed by 50 MB or every 10 s
        let t = DispatchSource.makeTimerSource(queue: .global(qos: .utility))
        t.schedule(deadline: .now() + 1, repeating: 1)
        t.setEventHandler { [weak self] in
            guard let self = self else { return }
            let m = MemoryLog.footprintMB()
            if abs(m - self.lastLogged) >= 50 || Date().timeIntervalSince(self.lastTime) >= 10 { self.log("") }
        }
        t.resume()
        timer = t
    }

    func log(_ what: String) {
        let m = MemoryLog.footprintMB()
        lastLogged = m; lastTime = Date()
        let line = "\(df.string(from: Date())) \(Int(m)) MB used, \(os_proc_available_memory() >> 20) MB left \(what)\n"
        handle?.write(line.data(using: .utf8)!)
        try? handle?.synchronize()   // survive a kill
        NSLog("MART memory: %@", line.trimmingCharacters(in: .newlines))
    }
}
