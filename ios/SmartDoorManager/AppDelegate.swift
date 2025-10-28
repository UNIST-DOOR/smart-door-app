import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
import AppAuth
import MSAL

@main
class AppDelegate: UIResponder, UIApplicationDelegate, RNAppAuthAuthorizationFlowManager {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?
  
  // Required by RNAppAuthAuthorizationFlowManager protocol
  public weak var authorizationFlowManagerDelegate: RNAppAuthAuthorizationFlowManagerDelegate?
  
  // OAuth 인증 진행 중 플래그 (PrivacyShield 비활성화용)
  private var isAuthenticationInProgress = false

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    // 무결성 검증 (Release에서만 동작)
    IntegrityChecker.verifyOrTerminateIfNeeded()
    // 탈옥(JB) 탐지
    JailbreakDetector.enforceIfDetected()
    
    // MSAL 인증 시작/종료 알림 구독
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(msalAuthenticationStarted),
      name: NSNotification.Name("MSALAuthenticationStarted"),
      object: nil
    )
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(msalAuthenticationEnded),
      name: NSNotification.Name("MSALAuthenticationEnded"),
      object: nil
    )
    
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
  
  @objc private func msalAuthenticationStarted() {
    isAuthenticationInProgress = true
    PrivacyShield.hide()
  }
  
  @objc private func msalAuthenticationEnded() {
    isAuthenticationInProgress = false
  }

  func applicationWillResignActive(_ application: UIApplication) {
    // OAuth 인증 중에는 PrivacyShield 비활성화 (Face ID 인증 지연 문제 방지)
    if !isAuthenticationInProgress {
      PrivacyShield.show()
    }
  }

  func applicationDidBecomeActive(_ application: UIApplication) {
    // OAuth 인증 중이 아닐 때만 차폐 해제
    if !isAuthenticationInProgress {
      PrivacyShield.hide()
    }
  }
  
  // Handle OAuth redirects
  func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey : Any] = [:]
  ) -> Bool {
    // MSAL Broker 리다이렉트 처리 (msauth 스킴)
    if url.scheme?.hasPrefix("msauth") == true {
      return MSALPublicClientApplication.handleMSALResponse(url, sourceApplication: options[.sourceApplication] as? String)
    }
    
    // RNAppAuth 처리 (Web OAuth)
    if let delegate = authorizationFlowManagerDelegate {
      let handled = delegate.resumeExternalUserAgentFlow(with: url)
      if handled { return true }
    }
    
    // Fallback to RN Linking
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
