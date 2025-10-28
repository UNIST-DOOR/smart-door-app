import Foundation
import MSAL
import UIKit

@objc(MSALModule)
class MSALModule: NSObject {
  private var application: MSALPublicClientApplication?
  private var currentAccount: MSALAccount?

  @objc static func moduleName() -> String! { return "MSALModule" }
  @objc static func requiresMainQueueSetup() -> Bool { true }

  private func makeApplication(clientId: String, redirectUri: String, authority: String) throws -> MSALPublicClientApplication {
    if let app = application { return app }
    let authorityURL = URL(string: authority)!
    let msAuthority = try MSALAuthority(url: authorityURL)
    let config = MSALPublicClientApplicationConfig(clientId: clientId, redirectUri: redirectUri, authority: msAuthority)
    // Use app's own keychain access group to match entitlements (avoids -34018) 강제로 번들id랑 매칭 
    config.cacheConfig.keychainSharingGroup = "org.reactjs.smartdoormanager"
    let app = try MSALPublicClientApplication(configuration: config)
    self.application = app
    return app
  }

  private func topViewController() -> UIViewController {
    // Ensure UI access on main thread
    if Thread.isMainThread {
      return unsafeTopViewController()
    } else {
      var controller: UIViewController?
      DispatchQueue.main.sync { controller = unsafeTopViewController() }
      return controller ?? UIViewController()
    }
  }

  // Must be called on main thread
  private func unsafeTopViewController() -> UIViewController {
    var keyWindow: UIWindow? = nil
    if #available(iOS 13.0, *) {
      keyWindow = UIApplication.shared.connectedScenes
        .compactMap { ($0 as? UIWindowScene)?.keyWindow }
        .first
    } else {
      keyWindow = UIApplication.shared.keyWindow
    }
    var top = keyWindow?.rootViewController
    while let presented = top?.presentedViewController { top = presented }
    return top ?? UIViewController()
  }
}

extension MSALModule: RCTBridgeModule {

  // signInInteractive(config: { clientId, redirectUri, authority, scopes: string[] })
  @objc(signInInteractive:resolver:rejecter:)
  func signInInteractive(_ config: NSDictionary,
                         resolver resolve: @escaping RCTPromiseResolveBlock,
                         rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let clientId = config["clientId"] as? String,
          let redirectUri = config["redirectUri"] as? String,
          let authority = config["authority"] as? String,
          let scopes = config["scopes"] as? [String] else {
      reject("E_CONFIG", "Invalid MSAL config", nil)
      return
    }

    do {
      let app = try makeApplication(clientId: clientId, redirectUri: redirectUri, authority: authority)

      let webParams = MSALWebviewParameters(authPresentationViewController: topViewController())
      let params = MSALInteractiveTokenParameters(scopes: scopes, webviewParameters: webParams)
      params.promptType = .default
      
      // OAuth 인증 시작 알림 (PrivacyShield 비활성화)
      NotificationCenter.default.post(name: NSNotification.Name("MSALAuthenticationStarted"), object: nil)
      
      DispatchQueue.main.async {
        app.acquireToken(with: params) { [weak self] result, error in
          if let error = error {
            let ns = error as NSError
            // OAuth 인증 종료 알림 (실패)
            NotificationCenter.default.post(name: NSNotification.Name("MSALAuthenticationEnded"), object: nil)
            reject("E_MSAL", ns.localizedDescription, ns)
            return
          }
          guard let result = result else { 
            // OAuth 인증 종료 알림 (실패)
            NotificationCenter.default.post(name: NSNotification.Name("MSALAuthenticationEnded"), object: nil)
            reject("E_EMPTY", "No result", nil)
            return 
          }
          self?.currentAccount = result.account
          
          // OAuth 인증 종료 알림 (성공)
          NotificationCenter.default.post(name: NSNotification.Name("MSALAuthenticationEnded"), object: nil)
          let expiresMs: Any = result.expiresOn != nil ? Int(result.expiresOn!.timeIntervalSince1970 * 1000) : NSNull()
          let response: [String: Any] = [
            "accessToken": result.accessToken as Any,
            "idToken": (result.idToken as Any) ?? NSNull(),
            "expiresOn": expiresMs,
            "accountId": result.account.identifier as Any
          ]
          resolve(response)
        }
      }
    } catch {
      let ns = error as NSError
      // OAuth 인증 종료 알림 (초기화 실패)
      NotificationCenter.default.post(name: NSNotification.Name("MSALAuthenticationEnded"), object: nil)
      reject("E_INIT", ns.localizedDescription, ns)
    }
  }

  // acquireTokenSilent(config: { clientId, redirectUri, authority, scopes: string[] })
  @objc(acquireTokenSilent:resolver:rejecter:)
  func acquireTokenSilent(_ config: NSDictionary,
                          resolver resolve: @escaping RCTPromiseResolveBlock,
                          rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let clientId = config["clientId"] as? String,
          let redirectUri = config["redirectUri"] as? String,
          let authority = config["authority"] as? String,
          let scopes = config["scopes"] as? [String] else {
      reject("E_CONFIG", "Invalid MSAL config", nil)
      return
    }

    do {
      let app = try makeApplication(clientId: clientId, redirectUri: redirectUri, authority: authority)

      // Resolve account - accountId 필수 (자동 로그인 방지)
      guard let accountId = config["accountId"] as? String else {
        reject("E_NOACCOUNT", "accountId is required", nil)
        return
      }
      
      guard let account = try? app.account(forIdentifier: accountId) else {
        reject("E_NOACCOUNT", "No account found for accountId", nil)
        return
      }
      
      currentAccount = account

      let authorityURL = URL(string: authority)!
      let msAuthority = try MSALAuthority(url: authorityURL)
      let params = MSALSilentTokenParameters(scopes: scopes, account: account)
      params.authority = msAuthority

      DispatchQueue.main.async {
        app.acquireTokenSilent(with: params) { result, error in
          if let error = error {
            let ns = error as NSError
            reject("E_MSAL_SILENT", ns.localizedDescription, ns)
            return
          }
          guard let result = result else { reject("E_EMPTY", "No result", nil); return }
          let expiresMs: Any = result.expiresOn != nil ? Int(result.expiresOn!.timeIntervalSince1970 * 1000) : NSNull()
          let response: [String: Any] = [
            "accessToken": result.accessToken as Any,
            "idToken": (result.idToken as Any) ?? NSNull(),
            "expiresOn": expiresMs,
            "accountId": result.account.identifier as Any
          ]
          resolve(response)
        }
      }
    } catch {
      let ns = error as NSError
      reject("E_INIT", ns.localizedDescription, ns)
    }
  }

  @objc(signOut:resolver:rejecter:)
  func signOut(_ config: NSDictionary,
               resolver resolve: @escaping RCTPromiseResolveBlock,
               rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let app = application else { resolve(true); return }
    do {
      for acc in try app.allAccounts() { try app.remove(acc) }
      currentAccount = nil
      resolve(true)
    } catch { reject("E_SIGNOUT", error.localizedDescription, error) }
  }
}


