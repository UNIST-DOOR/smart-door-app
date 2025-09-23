import UIKit

/// 앱이 백그라운드/앱 전환 화면으로 갈 때 민감정보 노출을 막기 위한 화면 차폐(블러)
enum PrivacyShield {
  private static var blurView: UIVisualEffectView?

  private static func keyWindow() -> UIWindow? {
    return UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
      .first { $0.isKeyWindow } ?? UIApplication.shared.windows.first
  }

  static func show() {
    guard let window = keyWindow() else { return }
    if blurView == nil {
      let effect = UIBlurEffect(style: .regular)
      let view = UIVisualEffectView(effect: effect)
      view.frame = window.bounds
      view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
      blurView = view
    }
    if let view = blurView, view.superview == nil {
      window.addSubview(view)
      window.bringSubviewToFront(view)
    }
  }

  static func hide() {
    blurView?.removeFromSuperview()
  }
}


