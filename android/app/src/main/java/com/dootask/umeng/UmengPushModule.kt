package com.dootask.umeng

import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Stub wrapper that mirrors the UMeng Push API surface the Vue layer expects.
 *
 * The methods currently log and resolve with null so the app compiles without the UMeng SDK.
 * To enable real push:
 *   1. Add UMeng Maven repo + dependencies via `plugins/withUmengPush.js` (options section).
 *   2. Uncomment the UMeng SDK imports + calls below.
 *   3. Provide UMENG_APPKEY / UMENG_MESSAGE_SECRET / channel via plugin options.
 *   4. Call UMConfigure.init before PushAgent.register.
 */
class UmengPushModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "UmengPush"

    @ReactMethod
    fun initPush(promise: Promise) {
        // TODO(UMeng): move UMConfigure.init and PushAgent.register here.
        // val appKey = BuildConfig.UMENG_APPKEY
        // val messageSecret = BuildConfig.UMENG_MESSAGE_SECRET
        // UMConfigure.init(
        //     reactApplicationContext,
        //     appKey,
        //     "expo",
        //     UMConfigure.DEVICE_TYPE_PHONE,
        //     messageSecret,
        // )
        // PushAgent.getInstance(reactApplicationContext).register(object : UPushRegisterCallback {
        //     override fun onSuccess(deviceToken: String) { promise.resolve(deviceToken) }
        //     override fun onFailure(errCode: String, errDesc: String) {
        //         promise.reject(errCode, errDesc)
        //     }
        // })
        Log.w(TAG, "initPush stub — wire UMeng SDK to enable push")
        promise.resolve(null)
    }

    @ReactMethod
    fun setAlias(alias: String, type: String, promise: Promise) {
        // TODO(UMeng):
        // PushAgent.getInstance(reactApplicationContext)
        //     .setAlias(alias, type, UPushAliasCallback { isSuccess, message ->
        //         if (isSuccess) promise.resolve(null) else promise.reject("setAlias", message)
        //     })
        Log.w(TAG, "setAlias stub: $type=$alias")
        promise.resolve(null)
    }

    @ReactMethod
    fun removeAlias(alias: String, type: String, promise: Promise) {
        // TODO(UMeng):
        // PushAgent.getInstance(reactApplicationContext)
        //     .deleteAlias(alias, type, UPushAliasCallback { isSuccess, message ->
        //         if (isSuccess) promise.resolve(null) else promise.reject("removeAlias", message)
        //     })
        Log.w(TAG, "removeAlias stub: $type=$alias")
        promise.resolve(null)
    }

    @ReactMethod
    fun getDeviceToken(promise: Promise) {
        // TODO(UMeng):
        // promise.resolve(PushAgent.getInstance(reactApplicationContext).registrationId)
        promise.resolve(null)
    }

    companion object {
        private const val TAG = "UmengPush"
    }
}
