import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
import AppAuth

@main
class AppDelegate: UIResponder, UIApplicationDelegate, RNAppAuthAuthorizationFlowManager {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?
  
  // Required by RNAppAuthAuthorizationFlowManager protocol
  public weak var authorizationFlowManagerDelegate: RNAppAuthAuthorizationFlowManagerDelegate?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    // 무결성 검증 (Release에서만 동작)
    IntegrityChecker.verifyOrTerminateIfNeeded()
    // 탈옥(JB) 탐지
    JailbreakDetector.enforceIfDetected()
    NSLog("🚀 AppDelegate: 앱 시작")
    NSLog("🚀 AppDelegate: authorizationFlowManagerDelegate 초기값: \(authorizationFlowManagerDelegate != nil)")
    
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)

    factory.startReactNative(
      withModuleName: "SmartDoorManager",
      in: window,
      launchOptions: launchOptions
    )

    return true
  }

  func applicationWillResignActive(_ application: UIApplication) {
    // 홈으로 나가거나 앱 전환 화면 진입 직전: 차폐 시작
    PrivacyShield.show()
  }

  func applicationDidBecomeActive(_ application: UIApplication) {
    // 다시 활성화 시 차폐 해제
    PrivacyShield.hide()
  }
  
  // Handle OAuth redirects
  func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey : Any] = [:]
  ) -> Bool {
    NSLog("🔗 AppDelegate: URL 받음: \(url.absoluteString)")
    NSLog("🔗 AppDelegate: authorizationFlowManagerDelegate 존재: \(authorizationFlowManagerDelegate != nil)")
    
    // React Native로도 메시지 전송
    DispatchQueue.main.async {
      NotificationCenter.default.post(name: NSNotification.Name("URLReceived"), object: url.absoluteString)
    }
    
    if let delegate = authorizationFlowManagerDelegate {
      let handled = delegate.resumeExternalUserAgentFlow(with: url)
      NSLog("🔗 AppDelegate: OAuth 처리 결과: \(handled)")
      if handled { return true }
    }
    // Fallback to RN Linking per official guide
    return RCTLinkingManager.application(app, open: url, options: options)
  }
  
  func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    if userActivity.activityType == NSUserActivityTypeBrowsingWeb,
       let url = userActivity.webpageURL,
       let delegate = authorizationFlowManagerDelegate,
       delegate.resumeExternalUserAgentFlow(with: url) {
      return true
    }
    // Fallback to RN Linking per official guide
    return RCTLinkingManager.application(
      application,
      continue: userActivity,
      restorationHandler: restorationHandler
    )
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
