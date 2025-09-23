import Foundation
import UIKit
import MachO

enum JailbreakDetector {
  static func enforceIfDetected() {
    #if targetEnvironment(simulator)
    return
    #else
    if isJailbroken() {
      presentBlockingAlertAndTerminate()
    }
    #endif
  }

  static func isJailbroken() -> Bool {
    #if targetEnvironment(simulator)
    return false
    #else
    // 1) 대표적인 JB 파일/경로 존재
    let suspiciousPaths: [String] = [
      "/Applications/Cydia.app",
      "/Library/MobileSubstrate/MobileSubstrate.dylib",
      "/bin/bash",
      "/usr/sbin/sshd",
      "/etc/apt",
      "/private/var/lib/apt/",
      "/Applications/blackra1n.app",
      "/private/var/stash",
      "/usr/libexec/ssh-keysign"
    ]
    for p in suspiciousPaths where FileManager.default.fileExists(atPath: p) {
      return true
    }

    // 2) 샌드박스 밖 쓰기 시도
    let testPath = "/private/" + UUID().uuidString
    do {
      try "jb".write(toFile: testPath, atomically: true, encoding: .utf8)
      try? FileManager.default.removeItem(atPath: testPath)
      return true
    } catch { /* 정상단말은 여기로 들어옴 */ }

    // 3) 의심 URL 스킴(cydia://) 감지 (Info.plist LSApplicationQueriesSchemes에 'cydia' 있으면 정확도↑)
    if let url = URL(string: "cydia://package/com.example"), UIApplication.shared.canOpenURL(url) {
      return true
    }

    // 4) 환경변수 기반 주입(DYLD_INSERT_LIBRARIES)
    if let val = getenv("DYLD_INSERT_LIBRARIES"), String(cString: val).isEmpty == false {
      return true
    }

    // 5) 로드된 Dylib에 후킹 프레임워크 존재 여부(Substrate/Frida 등)
    let suspiciousDylibKeywords = ["Substrate", "MobileSubstrate", "TweakLoader", "Frida", "frida-gadget"]
    let count = _dyld_image_count()
    for i in 0..<count {
      if let cName = _dyld_get_image_name(i), let name = String(validatingUTF8: cName) {
        for key in suspiciousDylibKeywords where name.localizedCaseInsensitiveContains(key) {
          return true
        }
      }
    }

    return false
    #endif
  }

  private static func presentBlockingAlertAndTerminate() {
    let msg = "보안 정책에 따라 변조된(iOS 탈옥 포함) 환경에서는 실행할 수 없습니다."
    if let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
       let win = scene.windows.first {
      let alert = UIAlertController(title: "보안 경고", message: msg, preferredStyle: .alert)
      alert.addAction(UIAlertAction(title: "종료", style: .destructive, handler: { _ in abort() }))
      win.rootViewController?.present(alert, animated: true)
    } else {
      abort()
    }
  }
}


