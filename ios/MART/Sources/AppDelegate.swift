import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        MemoryLog.shared.start()
        let w = UIWindow(frame: UIScreen.main.bounds)
        w.rootViewController = ViewController()
        w.makeKeyAndVisible()
        window = w
        return true
    }

    /// "Open in MART" / "Share" from the Files app and other apps: the file is copied to the app's
    /// images folder and opened.
    func application(_ app: UIApplication, open url: URL,
                     options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        guard url.isFileURL else { return false }
        DispatchQueue.global().async {
            guard let path = ExternalFile.importFile(at: url, into: "Received") else { return }
            DispatchQueue.main.async { (self.window?.rootViewController as? ViewController)?.openExternal(path) }
        }
        return true
    }

    func applicationWillTerminate(_ application: UIApplication) {
        HostController.shared.stop()
    }
}
