package com.smartdoormanager

import android.app.Application
import android.content.pm.PackageManager
import android.os.Build
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.facebook.react.defaults.DefaultReactNativeHost
import java.security.MessageDigest
import java.util.Locale
import java.io.File
import java.util.concurrent.TimeUnit
import android.os.Debug
import java.net.InetSocketAddress
import java.net.Socket
import java.io.BufferedReader
import java.io.FileReader

class MainApplication : Application(), ReactApplication {

  override val reactNativeHost: ReactNativeHost =
      object : DefaultReactNativeHost(this) {
        override fun getPackages(): List<ReactPackage> =
            PackageList(this).packages.apply {
              // Packages that cannot be autolinked yet can be added manually here, for example:
              // add(MyReactNativePackage())
            }

        override fun getJSMainModuleName(): String = "index"

        override fun getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG

        override val isNewArchEnabled: Boolean = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
        override val isHermesEnabled: Boolean = BuildConfig.IS_HERMES_ENABLED
      }

  override val reactHost: ReactHost
    get() = getDefaultReactHost(applicationContext, reactNativeHost)

  override fun onCreate() {
    super.onCreate()
    // 루팅/후킹 환경 차단 (release 전용)
    try {
      if (!BuildConfig.DEBUG && isDeviceCompromised()) {
        android.util.Log.e("RootDetect", "Compromised environment detected. Aborting.")
        throw RuntimeException("Device rooted or tampered")
      }
    } catch (_: Throwable) {
    }
    // 프로그램 무결성 검증: 앱 서명 인증서 SHA-256 지문 비교
    try {
      val allowed = BuildConfig.ALLOWED_CERT_SHA256?.trim().orEmpty()
      if (allowed.isNotEmpty()) {
        val actual = getCurrentCertSha256()
        if (!allowed.equals(actual, ignoreCase = true)) {
          // 서명 지문 불일치: 즉시 크래시로 중단 (리패키징/변조 차단을 명확히 표시)
          android.util.Log.e("Integrity", "Signature mismatch. Allowed=$allowed, Actual=$actual")
          throw RuntimeException("App signature verification failed")
        }
      }
    } catch (_: Throwable) {
      // 검증 중 예외는 앱 크래시를 방지하되, 필요시 실패로 간주하여 차단하도록 변경 가능
    }
    loadReactNative(this)
  }

  private fun isDeviceCompromised(): Boolean {
    return checkSuFiles() || canExecuteSu() || checkDangerousProps() || isDebuggerAttached() || hasFridaServer() || hasMagiskTraces()
  }

  private fun checkSuFiles(): Boolean {
    val paths = arrayOf(
      "/system/bin/su", "/system/xbin/su", "/sbin/su", 
      "/system/bin/.ext/su", "/system/usr/we-need-root/su",
      "/system/app/Superuser.apk", "/system/app/SuperSU.apk",
      "/system/xbin/daemonsu", "/system/bin/daemonsu"
    )
    return paths.any { path -> runCatching { File(path).exists() }.getOrDefault(false) }
  }

  private fun canExecuteSu(): Boolean {
    return try {
      val proc = Runtime.getRuntime().exec(arrayOf("/system/xbin/which", "su"))
      if (!proc.waitFor(500, java.util.concurrent.TimeUnit.MILLISECONDS)) {
        proc.destroy()
      }
      proc.exitValue() == 0
    } catch (_: Throwable) {
      false
    }
  }

  private fun checkDangerousProps(): Boolean {
    return try {
      // Build tags에 test-keys가 있고 su도 발견되면 더 확실히 판단
      val hasTestKeys = (android.os.Build.TAGS ?: "").contains("test-keys", ignoreCase = true)
      val hasSu = checkSuFiles() || canExecuteSu()
      hasTestKeys && hasSu
    } catch (_: Throwable) {
      false
    }
  }

  private fun isDebuggerAttached(): Boolean {
    return try { Debug.isDebuggerConnected() || Debug.waitingForDebugger() } catch (_: Throwable) { false }
  }

  private fun hasFridaServer(): Boolean {
    // 흔한 Frida 포트(27042/27043) 스캔
    val ports = intArrayOf(27042, 27043)
    return ports.any { port ->
      runCatching {
        Socket().use { s ->
          s.connect(InetSocketAddress("127.0.0.1", port), 200)
          true
        }
      }.getOrDefault(false)
    }
  }

  private fun hasMagiskTraces(): Boolean {
    val paths = arrayOf("/sbin/.magisk", "/data/adb/magisk", "/dev/magisk" )
    val foundPath = paths.any { path -> runCatching { File(path).exists() }.getOrDefault(false) }
    val mountsFlag = runCatching {
      BufferedReader(FileReader("/proc/mounts")).use { br ->
        var line: String?
        var hit = false
        while (br.readLine().also { line = it } != null) {
          if (line!!.contains("magisk", ignoreCase = true)) { hit = true; break }
        }
        hit
      }
    }.getOrDefault(false)
    return foundPath || mountsFlag
  }

  private fun getCurrentCertSha256(): String {
    return try {
      val pm = packageManager
      val pkgName = packageName
      val signatures: Array<android.content.pm.Signature> = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        val pi = pm.getPackageInfo(pkgName, PackageManager.GET_SIGNING_CERTIFICATES)
        val si = pi.signingInfo
        when {
          si == null -> emptyArray()
          si.hasMultipleSigners() -> si.apkContentsSigners ?: emptyArray()
          else -> si.signingCertificateHistory ?: emptyArray()
        }
      } else {
        @Suppress("DEPRECATION")
        pm.getPackageInfo(pkgName, PackageManager.GET_SIGNATURES).signatures ?: emptyArray()
      }
      val cert = signatures.firstOrNull() ?: return ""
      val md = MessageDigest.getInstance("SHA-256")
      val digest = md.digest(cert.toByteArray())
      digest.joinToString(":") { b -> String.format(Locale.US, "%02X", b) }
    } catch (_: Throwable) {
      ""
    }
  }
}
