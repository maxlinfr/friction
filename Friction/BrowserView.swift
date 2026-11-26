import SwiftUI
import WebKit

/// Full-screen instagram.com with the friction engine injected.
struct BrowserView: UIViewRepresentable {
    static let home = URL(string: "https://www.instagram.com/")!

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()              // keeps you logged in
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        let content = WKUserContentController()
        content.add(context.coordinator, name: "friction")
        config.userContentController = content

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.allowsBackForwardNavigationGestures = true
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.scrollView.contentInsetAdjustmentBehavior = .never

        let refresh = UIRefreshControl()
        refresh.addTarget(context.coordinator, action: #selector(Coordinator.pullToRefresh(_:)), for: .valueChanged)
        webView.scrollView.refreshControl = refresh

        #if DEBUG
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        #endif

        context.coordinator.attach(webView)
        webView.load(URLRequest(url: Self.home))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        private weak var webView: WKWebView?
        private var injectedIntensity: Double = -1

        func attach(_ webView: WKWebView) {
            self.webView = webView
            installScripts()
            NotificationCenter.default.addObserver(
                self, selector: #selector(didBecomeActive),
                name: UIApplication.didBecomeActiveNotification, object: nil)
        }

        /// (Re)injects config + engine. Called at launch and whenever the
        /// intensity is changed in the Settings app.
        private func installScripts() {
            guard let content = webView?.configuration.userContentController else { return }
            content.removeAllUserScripts()
            content.addUserScript(WKUserScript(source: FrictionSettings.configScript(),
                                               injectionTime: .atDocumentStart, forMainFrameOnly: true))
            if let engine = FrictionSettings.engineSource {
                content.addUserScript(WKUserScript(source: engine,
                                                   injectionTime: .atDocumentStart, forMainFrameOnly: true))
            }
            injectedIntensity = FrictionSettings.intensity
        }

        @objc private func didBecomeActive() {
            guard FrictionSettings.intensity != injectedIntensity else { return }
            installScripts()
            webView?.reload()
        }

        @objc func pullToRefresh(_ sender: UIRefreshControl) {
            webView?.reload()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { sender.endRefreshing() }
        }

        // MARK: Navigation: keep Instagram (and its login flow) inside, send everything else out.

        private func isInternal(_ url: URL) -> Bool {
            guard let host = url.host?.lowercased() else { return true } // about:blank, data:, etc.
            let allowed = ["instagram.com", "cdninstagram.com", "facebook.com", "fbcdn.net", "fb.com"]
            return allowed.contains { host == $0 || host.hasSuffix("." + $0) }
        }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url else { return decisionHandler(.allow) }
            let scheme = url.scheme?.lowercased() ?? ""
            if (scheme == "http" || scheme == "https") && !isInternal(url) && action.targetFrame?.isMainFrame != false {
                UIApplication.shared.open(url)
                return decisionHandler(.cancel)
            }
            if scheme != "http" && scheme != "https" && scheme != "about" && scheme != "data" && scheme != "blob" {
                // instagram://, mailto:, tel: etc. — don't bounce the user into the native app.
                return decisionHandler(.cancel)
            }
            decisionHandler(.allow)
        }

        // target=_blank links: open in place if Instagram, externally otherwise.
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                     for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = action.request.url {
                if isInternal(url) { webView.load(action.request) } else { UIApplication.shared.open(url) }
            }
            return nil
        }

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            #if DEBUG
            print("[friction]", message.body)
            #endif
        }
    }
}
