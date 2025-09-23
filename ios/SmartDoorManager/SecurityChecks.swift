import Foundation
import UIKit
import CryptoKit

/// 간단한 런타임 무결성 점검(리소스 변조 차단)
/// - 배포용(Release)에서만 동작. Debug에선 통과
enum IntegrityChecker {
  static func verifyOrTerminateIfNeeded() {
    #if DEBUG
    return
    #else
    let jsOK = verifyMainJSBundle()
    let assetsCheck = verifyAssetsManifestOptional()
    // 매니페스트가 있으면 둘 다 통과해야 함, 없으면 JS만 검사
    let ok = (assetsCheck == nil) ? jsOK : (jsOK && (assetsCheck == true))
    if !ok { presentBlockingAlertAndTerminate() }
    #endif
  }

  /// main.jsbundle 해시 검증(존재 시)
  /// - Info.plist에 `JSBundleSHA256` 키(소문자 hex)를 넣으면 그 값과 비교
  private static func verifyMainJSBundle() -> Bool {
    guard let jsURL = Bundle.main.url(forResource: "main", withExtension: "jsbundle") else {
      return false
    }
    guard let info = Bundle.main.infoDictionary,
          let expected = (info["JSBundleSHA256"] as? String)?.lowercased(),
          !expected.isEmpty else {
      // 기준값이 없으면 이 검사는 패스하고 다음 단계로
      return false
    }
    do {
      let data = try Data(contentsOf: jsURL)
      let digest = sha256Hex(data)
      return digest == expected
    } catch { return false }
  }

  /// asset_manifest.json 기반 리소스 검증(선택적)
  /// - build 시 생성해 번들에 포함하면 여기서 비교
  /// 매니페스트가 있으면 검증 결과(true/false), 없으면 nil 반환
  private static func verifyAssetsManifestOptional() -> Bool? {
    guard let manifestURL = Bundle.main.url(forResource: "asset_manifest", withExtension: "json") else {
      return nil
    }
    guard let bundleRoot = Bundle.main.resourceURL else { return false }
    do {
      let data = try Data(contentsOf: manifestURL)
      let map = try JSONSerialization.jsonObject(with: data, options: []) as? [String: String] ?? [:]

      for (idx, entry) in map.enumerated() {
        if idx >= 300 { break }
        let rel = entry.key
        let expected = entry.value.lowercased()
        let url = bundleRoot.appendingPathComponent(rel)
        let bytes = try Data(contentsOf: url)
        if sha256Hex(bytes) != expected { return false }
      }
      return true
    } catch { return false }
  }

  private static func sha256Hex(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
  }

  private static func presentBlockingAlertAndTerminate() {
    let message = "앱 무결성 검증에 실패했습니다. 설치 파일이 변조되었거나 리소스가 변경되었습니다."
    if let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
       let window = scene.windows.first {
      let alert = UIAlertController(title: "무결성 오류", message: message, preferredStyle: .alert)
      alert.addAction(UIAlertAction(title: "종료", style: .destructive, handler: { _ in abort() }))
      window.rootViewController?.present(alert, animated: true, completion: nil)
    } else {
      abort()
    }
  }
}


