package expo.modules.legacystore

import android.content.ContentResolver
import android.content.ContentUris
import android.content.Context
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import android.view.inputmethod.InputMethodManager
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class DooTaskLegacyStoreModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("DooTaskLegacyStore")

    AsyncFunction("readCaches") {
      val context = requireNotNull(appContext.reactContext) { "原生上下文尚未就绪" }
      // eeuiCommon 将全部缓存序列化到此偏好文件的同名键，保留旧数据不作写入。
      context.getSharedPreferences("eeuiCaches", Context.MODE_PRIVATE).getString("eeuiCaches", "{}") ?: "{}"
    }

    AsyncFunction("moveTaskToBack") {
      requireNotNull(appContext.currentActivity) { "当前 Activity 不存在" }.moveTaskToBack(true)
      Unit
    }.runOnQueue(Queues.MAIN)

    // 对齐 eeui keyboardHide（KeyboardUtils.hideSoftInput）：只收起输入法，不清除 WebView 内的焦点
    AsyncFunction("hideSoftInput") {
      val activity = requireNotNull(appContext.currentActivity) { "当前 Activity 不存在" }
      val view = activity.currentFocus ?: activity.window.decorView
      val imm = activity.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
      imm.hideSoftInputFromWindow(view.windowToken, 0)
      Unit
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("isFullscreen") {
      val activity = appContext.currentActivity
      // 旧 eeui 无 Activity 时返回 true，仅 PiP / 多窗口返回 false。
      when {
        activity == null -> true
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && activity.isInPictureInPictureMode -> false
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && activity.isInMultiWindowMode -> false
        else -> true
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("getLatestPhoto") {
      val context = requireNotNull(appContext.reactContext) { "原生上下文尚未就绪" }
      val uri = MediaStore.Images.Media.EXTERNAL_CONTENT_URI
      val projection = arrayOf(
        MediaStore.Images.Media._ID,
        MediaStore.Images.Media.DISPLAY_NAME,
        MediaStore.Images.Media.DATE_ADDED,
        MediaStore.Images.Media.WIDTH,
        MediaStore.Images.Media.HEIGHT
      )
      val sortOrder = "${MediaStore.Images.Media.DATE_ADDED} DESC"
      // Android 11+ 用 queryArgs 传 LIMIT，避免 MediaStore 拒绝排序串中的 LIMIT。
      val cursor = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        val queryArgs = Bundle().apply {
          putString(ContentResolver.QUERY_ARG_SQL_SORT_ORDER, sortOrder)
          putInt(ContentResolver.QUERY_ARG_LIMIT, 1)
        }
        context.contentResolver.query(uri, projection, queryArgs, null)
      } else {
        context.contentResolver.query(uri, projection, null, null, "$sortOrder LIMIT 1")
      }
      cursor?.use {
        if (!it.moveToFirst()) return@use null
        val id = it.getLong(it.getColumnIndexOrThrow(MediaStore.Images.Media._ID))
        mapOf(
          "uri" to ContentUris.withAppendedId(uri, id).toString(),
          "name" to (it.getString(it.getColumnIndexOrThrow(MediaStore.Images.Media.DISPLAY_NAME)) ?: ""),
          "created" to it.getLong(it.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_ADDED)),
          "width" to it.getInt(it.getColumnIndexOrThrow(MediaStore.Images.Media.WIDTH)),
          "height" to it.getInt(it.getColumnIndexOrThrow(MediaStore.Images.Media.HEIGHT))
        )
      }
    }
  }
}
