import UIKit
import WebKit
import QuickLookThumbnailing

final class ViewController: UIViewController, WKNavigationDelegate, WKDownloadDelegate, WKUIDelegate,
                            WKScriptMessageHandlerWithReply, UIDocumentPickerDelegate {
    private var web: WKWebView!
    private let status = UILabel()
    private var downloadURL: URL?
    private var loaded = false
    /// the answer to the file picker that is on screen (the page asks for one at a time)
    private var pickerReply: ((Any?, String?) -> Void)?
    private var pickerKind = ""

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        let cfg = WKWebViewConfiguration()
        cfg.allowsInlineMediaPlayback = true
        // the page (client/src/native.ts) asks the app for the system's file pickers
        cfg.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "mart")
        web = WKWebView(frame: view.bounds, configuration: cfg)
        web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        web.navigationDelegate = self
        web.uiDelegate = self
        web.isOpaque = false
        web.backgroundColor = .black
        web.scrollView.backgroundColor = .black
        web.scrollView.bounces = false
        web.scrollView.contentInsetAdjustmentBehavior = .never
        if #available(iOS 16.4, *) { web.isInspectable = true }
        view.addSubview(web)

        status.textColor = .lightGray
        status.numberOfLines = 0
        status.textAlignment = .center
        status.font = .preferredFont(forTextStyle: .body)
        status.text = "Starting MART…"
        status.frame = view.bounds.insetBy(dx: 24, dy: 24)
        status.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(status)

        NotificationCenter.default.addObserver(self, selector: #selector(foreground),
                                               name: UIApplication.willEnterForegroundNotification, object: nil)
        startHost()
    }

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }

    private func startHost(restart: Bool = false) {
        status.isHidden = false
        status.text = "Starting MART…"
        let done: (URL?) -> Void = { [weak self] url in
            guard let self = self else { return }
            if let url = url {
                self.status.isHidden = true
                self.loaded = true
                self.web.load(URLRequest(url: url))
            } else {
                self.status.text = "MART could not start."
            }
        }
        if restart { HostController.shared.restart(ready: done) } else { HostController.shared.start(ready: done) }
    }

    /// The app was suspended: the sockets may be dead, restart the host if so.
    @objc private func foreground() {
        guard loaded else { return }
        HostController.shared.isAlive { [weak self] alive in
            if !alive { self?.startHost(restart: true) }
        }
    }

    /// MART_EVAL (debugging, through simctl): a script to run when the page has loaded
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if let js = ProcessInfo.processInfo.environment["MART_EVAL"] {
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { webView.evaluateJavaScript(js) }
        }
    }

    // MARK: downloads (exports): saved in Documents/Exports, then offered to the user

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if let http = navigationResponse.response as? HTTPURLResponse,
           let cd = http.value(forHTTPHeaderField: "Content-Disposition"), cd.lowercased().hasPrefix("attachment") {
            decisionHandler(.download)
        } else if !navigationResponse.canShowMIMEType {
            decisionHandler(.download)
        } else {
            decisionHandler(.allow)
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(navigationAction.shouldPerformDownload ? .download : .allow)
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                  suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let dir = URL(fileURLWithPath: HostController.shared.exportsDir, isDirectory: true)
        var dest = dir.appendingPathComponent(suggestedFilename)
        let fm = FileManager.default
        if fm.fileExists(atPath: dest.path) {
            let base = dest.deletingPathExtension().lastPathComponent, ext = dest.pathExtension
            dest = dir.appendingPathComponent("\(base)-\(Int(Date().timeIntervalSince1970)).\(ext)")
        }
        downloadURL = dest
        completionHandler(dest)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let url = downloadURL else { return }
        let vc = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        vc.popoverPresentationController?.sourceView = view
        vc.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
        vc.popoverPresentationController?.permittedArrowDirections = []
        present(vc, animated: true)
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        let a = UIAlertController(title: "Download failed", message: error.localizedDescription, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default))
        present(a, animated: true)
    }

    // window.alert/confirm from the page
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(a, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(a, animated: true)
    }

    // MARK: bridge to the page (client/src/native.ts): folders of Files, saving an export to Files

    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any], let cmd = body["cmd"] as? String else {
            return replyHandler(nil, "bad message")
        }
        if cmd == "folders" {
            let list = FolderStore.shared.folders().map { ["path": $0.path, "name": $0.name] }
            return replyHandler(["folders": list], nil)
        }
        if cmd == "thumbnail" {
            guard let path = body["path"] as? String, FolderStore.shared.allowed(path) else {
                return replyHandler(["error": "not an image of a chosen folder"], nil)
            }
            let side = min(max((body["size"] as? Double) ?? 256, 32), 1024)
            return thumbnail(path, side: CGFloat(side), reply: replyHandler)
        }
        if pickerReply != nil { return replyHandler(["error": "a file picker is already open"], nil) }
        let picker: UIDocumentPickerViewController
        switch cmd {
        case "pickFolder":
            // in place: no copy, the app keeps access to the folder
            picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder], asCopy: false)
        case "saveFile":
            // only what the host exported
            guard let path = body["path"] as? String else { return replyHandler(["error": "no file"], nil) }
            let url = URL(fileURLWithPath: path).standardizedFileURL
            let exports = URL(fileURLWithPath: HostController.shared.exportsDir).standardizedFileURL.path + "/"
            guard url.path.hasPrefix(exports), FileManager.default.fileExists(atPath: url.path) else {
                return replyHandler(["error": "that file is not an export"], nil)
            }
            picker = UIDocumentPickerViewController(forExporting: [url], asCopy: true)
        default:
            return replyHandler(nil, "unknown command")
        }
        pickerKind = cmd
        pickerReply = { value, _ in replyHandler(value, nil) }
        picker.delegate = self
        picker.allowsMultipleSelection = false
        present(picker, animated: true)
    }

    /// A thumbnail of the file as the system makes it (what Files shows), as a data: URL.
    private func thumbnail(_ path: String, side: CGFloat, reply: @escaping (Any?, String?) -> Void) {
        let scale = UIScreen.main.scale
        let req = QLThumbnailGenerator.Request(fileAt: URL(fileURLWithPath: path),
                                               size: CGSize(width: side, height: side), scale: scale,
                                               representationTypes: .thumbnail)
        QLThumbnailGenerator.shared.generateBestRepresentation(for: req) { rep, error in
            guard let img = rep?.uiImage, let jpeg = img.jpegData(compressionQuality: 0.8) else {
                // no thumbnail for this format: the page shows a placeholder
                return reply(["data": NSNull()], nil)
            }
            reply(["data": "data:image/jpeg;base64," + jpeg.base64EncodedString()], nil)
        }
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        let reply = pickerReply; pickerReply = nil
        if pickerKind == "saveFile" { reply?(["saved": true], nil); return }
        guard let url = urls.first, let f = FolderStore.shared.add(url) else {
            reply?(["error": "cannot use that folder"], nil); return
        }
        reply?(["folder": ["path": f.path, "name": f.name]], nil)
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        let reply = pickerReply; pickerReply = nil
        reply?(pickerKind == "saveFile" ? ["saved": false] : ["folder": NSNull()], nil)
    }
}
