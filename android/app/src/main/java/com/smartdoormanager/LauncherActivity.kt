package com.smartdoormanager

import android.app.Activity
import android.content.Intent
import android.os.Bundle

class LauncherActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    // 내부에서만 MainActivity를 호출 (MainActivity는 exported=false)
    val intent = Intent(this, MainActivity::class.java)
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
    startActivity(intent)
    finish()
  }
}


