package expo.modules.dootaskshare

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.LruCache
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.BaseAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.ProgressBar
import android.widget.TextView
import org.json.JSONArray
import java.io.File
import java.util.Locale
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.Future

/** 与旧壳一样直接展示原生分享页，冷启动也不需要 MainActivity 或 JS。 */
class ShareActivity : Activity() {
  private val worker = Executors.newFixedThreadPool(2)
  private val imageWorker = Executors.newFixedThreadPool(2)
  private val transport = ShareTransport()
  private var listTransport = ShareTransport()
  private var listWork: Future<*>? = null
  private val selected = linkedMapOf<String, ShareDestination>()
  private val path = mutableListOf<ShareDestination>()
  private val avatars = LruCache<String, Bitmap>(64)
  private val pendingAvatars = mutableSetOf<String>()
  private var rows = emptyList<ShareDestination>()
  private var payloads = emptyList<SharePayload>()
  private var revision = 0
  private var loading = true
  private var sending = false
  @Volatile private var destroyed = false
  private lateinit var directory: File
  private lateinit var list: ListView
  private lateinit var adapter: BaseAdapter
  private lateinit var sendButton: Button
  private lateinit var search: EditText
  private lateinit var breadcrumbs: LinearLayout
  private lateinit var breadcrumbScroll: HorizontalScrollView
  private lateinit var status: TextView
  private lateinit var retry: Button
  private lateinit var progress: ProgressBar
  private var chatList = ""
  private var token = ""

  override fun attachBaseContext(newBase: Context) {
    val language = ShareSettings.read(newBase, "language")
    val locale = when (language) {
      "zh-Hans" -> Locale.SIMPLIFIED_CHINESE
      "zh-Hant", "zh-HK" -> Locale.TRADITIONAL_CHINESE
      "" -> null
      else -> Locale.forLanguageTag(language)
    }
    val configuration = Configuration(newBase.resources.configuration)
    if (locale != null && locale.language.isNotEmpty()) configuration.setLocale(locale)
    super.attachBaseContext(newBase.createConfigurationContext(configuration))
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    chatList = ShareSettings.read(this, "chatList")
    token = runCatching { Uri.parse(chatList).getQueryParameter("token") ?: "" }.getOrDefault("")
    setupView()
    val name = savedInstanceState?.getString("directory")?.takeIf { it.matches(Regex("DooTaskShare-[a-fA-F0-9-]+")) }
      ?: "DooTaskShare-${UUID.randomUUID()}"
    directory = File(cacheDir, name)
    directory.mkdirs()
    worker.execute {
      try {
        // 进程被系统回收时留下的附件仅在缓存目录中保留一天。
        cacheDir.listFiles()?.filter { it.name.startsWith("DooTaskShare-") && it != directory && it.lastModified() < System.currentTimeMillis() - 86400000 }
          ?.forEach { it.deleteRecursively() }
        val saved = savedInstanceState?.getString("payloads")
        val loaded = if (saved != null) {
          runCatching {
            val array = JSONArray(saved)
            (0 until array.length()).map { SharePayload.restore(array.getJSONObject(it), directory) }
          }.getOrElse { SharePayload.load(this, intent, directory) }
        } else SharePayload.load(this, intent, directory)
        require(loaded.isNotEmpty())
        val savedPath = ShareTransport.destinations(savedInstanceState?.getString("path"))
        val savedSelected = ShareTransport.destinations(savedInstanceState?.getString("selected"))
        ui {
          payloads = loaded
          path.addAll(savedPath)
          savedSelected.forEach { selected[it.dialogID] = it }
          updateBreadcrumbs()
          if (token.isEmpty()) showError(ShareException("unLoginTitle"), fatal = true) else loadList()
        }
      } catch (error: Exception) { ui { showError(if (error is ShareException) error else ShareException("emptyShareTitle"), fatal = true) } }
      finally { if (destroyed && !isChangingConfigurations) directory.deleteRecursively() }
    }
  }

  private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

  private fun text(key: String): String {
    // 显式引用资源，避免 Release 资源压缩删除仅由 getIdentifier 动态访问的文案。
    val id = when (key) {
      "cancelTitle" -> R.string.dootask_share_cancelTitle
      "sendTitle" -> R.string.dootask_share_sendTitle
      "sendingTitle" -> R.string.dootask_share_sendingTitle
      "sendSuccessTitle" -> R.string.dootask_share_sendSuccessTitle
      "sendFailTitle" -> R.string.dootask_share_sendFailTitle
      "unLoginTitle" -> R.string.dootask_share_unLoginTitle
      "emptyShareTitle" -> R.string.dootask_share_emptyShareTitle
      "netWorkErrorTitle" -> R.string.dootask_share_netWorkErrorTitle
      "folderUnsupportTitle" -> R.string.dootask_share_folderUnsupportTitle
      "allTitle" -> R.string.dootask_share_allTitle
      "successTotal" -> R.string.dootask_share_successTotal
      "failTotal" -> R.string.dootask_share_failTotal
      "searchTitle" -> R.string.dootask_share_searchTitle
      else -> return key
    }
    return getString(id)
  }

  private fun setupView() {
    val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(12), 0, dp(12), 0) }
    root.setOnApplyWindowInsetsListener { view, insets ->
      if (Build.VERSION.SDK_INT >= 30) {
        val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout() or WindowInsets.Type.ime())
        view.setPadding(bars.left + dp(12), bars.top, bars.right + dp(12), bars.bottom)
      } else {
        @Suppress("DEPRECATION")
        view.setPadding(insets.systemWindowInsetLeft + dp(12), insets.systemWindowInsetTop,
          insets.systemWindowInsetRight + dp(12), insets.systemWindowInsetBottom)
      }
      insets
    }
    val header = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
    header.addView(Button(this).apply { setText(text("cancelTitle")); setOnClickListener { finish() } })
    header.addView(TextView(this).apply { setText("DooTask"); textSize = 18f; gravity = Gravity.CENTER }, LinearLayout.LayoutParams(0, dp(52), 1f))
    sendButton = Button(this).apply { setOnClickListener { send() } }
    header.addView(sendButton)
    root.addView(header)
    search = EditText(this).apply {
      hint = text("searchTitle")
      isSingleLine = true
      imeOptions = EditorInfo.IME_ACTION_SEARCH
      inputType = android.text.InputType.TYPE_CLASS_TEXT
      setOnEditorActionListener { _, action, _ ->
        if (action == EditorInfo.IME_ACTION_SEARCH) { hideKeyboard(); loadList(); true } else false
      }
    }
    root.addView(search, LinearLayout.LayoutParams(-1, dp(52)))
    breadcrumbs = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
    breadcrumbScroll = HorizontalScrollView(this).apply { addView(breadcrumbs); isHorizontalScrollBarEnabled = false }
    root.addView(breadcrumbScroll, LinearLayout.LayoutParams(-1, dp(52)))
    progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply { isIndeterminate = true; max = 100 }
    root.addView(progress, LinearLayout.LayoutParams(-1, dp(4)))
    status = TextView(this).apply { gravity = Gravity.CENTER; setPadding(0, dp(8), 0, dp(8)) }
    root.addView(status)
    retry = Button(this).apply { setText("↻"); contentDescription = text("netWorkErrorTitle"); visibility = View.GONE; setOnClickListener { loadList() } }
    root.addView(retry)
    adapter = object : BaseAdapter() {
      override fun getCount() = rows.size
      override fun getItem(position: Int) = rows[position]
      override fun getItemId(position: Int) = position.toLong()
      override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
        val row = rows[position]
        val container = LinearLayout(this@ShareActivity).apply { gravity = Gravity.CENTER_VERTICAL; setPadding(dp(8), dp(8), dp(8), dp(8)); minimumHeight = dp(60) }
        val icon = ImageView(this@ShareActivity).apply {
          setImageResource(if (row.isFolder) android.R.drawable.ic_menu_agenda else android.R.drawable.ic_menu_myplaces)
          scaleType = ImageView.ScaleType.CENTER_CROP
          tag = row.icon
        }
        container.addView(icon, LinearLayout.LayoutParams(dp(40), dp(40)))
        container.addView(TextView(this@ShareActivity).apply { setText(row.name); textSize = 16f; setPadding(dp(12), 0, dp(8), 0) }, LinearLayout.LayoutParams(0, -2, 1f))
        container.addView(TextView(this@ShareActivity).apply { setText(if (row.isFolder) "›" else if (selected.containsKey(row.dialogID)) "☑" else "☐"); textSize = 24f })
        avatar(row.icon, icon)
        return container
      }
    }
    list = ListView(this).apply {
      adapter = this@ShareActivity.adapter
      setOnItemClickListener { _, _, position, _ ->
        if (!loading && !sending) {
          hideKeyboard()
          val row = rows[position]
          if (row.isFolder) { path.add(row); updateBreadcrumbs(); loadList() }
          else if (row.dialogID.isNotEmpty()) {
            if (selected.containsKey(row.dialogID)) selected.remove(row.dialogID) else selected[row.dialogID] = row
            this@ShareActivity.adapter.notifyDataSetChanged()
          }
          updateControls()
        }
      }
    }
    root.addView(list, LinearLayout.LayoutParams(-1, 0, 1f))
    setContentView(root)
    root.requestApplyInsets()
    updateControls()
  }

  private fun avatar(value: String, image: ImageView) {
    if (!value.startsWith("https://") && !value.startsWith("http://")) return
    avatars.get(value)?.let { image.setImageBitmap(it); return }
    if (!pendingAvatars.add(value)) return
    imageWorker.execute {
      val bitmap = runCatching {
        val data = transport.avatar(value) ?: return@runCatching null
        val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(data, 0, data.size, options)
        options.inSampleSize = maxOf(1, maxOf(options.outWidth, options.outHeight) / dp(48))
        options.inJustDecodeBounds = false
        BitmapFactory.decodeByteArray(data, 0, data.size, options)
      }.getOrNull()
      ui {
        pendingAvatars.remove(value)
        if (bitmap != null) { avatars.put(value, bitmap); if (image.tag == value) image.setImageBitmap(bitmap) }
      }
    }
  }

  private fun updateControls() {
    val count = if (path.isEmpty()) selected.size else 1
    sendButton.text = text("sendTitle") + if (count > 0) "($count)" else ""
    sendButton.isEnabled = !loading && !sending && payloads.isNotEmpty() && count > 0
    list.isEnabled = !loading && !sending
    search.isEnabled = !sending
    breadcrumbs.isEnabled = !loading && !sending
    search.visibility = if (path.isEmpty()) View.VISIBLE else View.GONE
    breadcrumbScroll.visibility = if (path.isEmpty()) View.GONE else View.VISIBLE
    progress.visibility = if (loading || sending) View.VISIBLE else View.GONE
  }

  private fun updateBreadcrumbs() {
    breadcrumbs.removeAllViews()
    (listOf(text("allTitle")) + path.map { it.name }).forEachIndexed { index, name ->
      breadcrumbs.addView(Button(this).apply {
        setText(if (index == 0) name else "› $name")
        setOnClickListener {
          if (!sending) {
            while (path.size > index) path.removeAt(path.lastIndex)
            search.setText("")
            updateBreadcrumbs()
            loadList()
          }
        }
      })
    }
  }

  private fun loadList() {
    if (destroyed || sending || payloads.isEmpty()) return
    revision += 1
    val current = revision
    listTransport.close()
    listWork?.cancel(true)
    val client = ShareTransport()
    listTransport = client
    val parameters = mutableMapOf("token" to token)
    if (path.isEmpty()) {
      parameters["type"] = if (payloads.any { it.file != null }) "file" else "text"
      parameters["key"] = search.text.toString().trim()
    }
    val value = path.lastOrNull()?.url ?: chatList
    rows = emptyList()
    adapter.notifyDataSetChanged()
    loading = true
    status.text = ""
    retry.visibility = View.GONE
    progress.isIndeterminate = true
    updateControls()
    listWork = worker.submit {
      try {
        val result = client.list(ShareTransport.url(value, parameters))
        ui { if (current == revision) { rows = result; loading = false; adapter.notifyDataSetChanged(); updateControls() } }
      } catch (error: Exception) { ui { if (current == revision) showError(error) } }
    }
  }

  private fun showError(error: Exception, fatal: Boolean = false) {
    loading = false
    status.text = if (error is ShareException) error.serverMessage ?: text(error.key) else text("netWorkErrorTitle")
    retry.visibility = if (fatal) View.GONE else View.VISIBLE
    updateControls()
  }

  private fun send() {
    if (!sendButton.isEnabled) return
    hideKeyboard()
    sending = true
    retry.visibility = View.GONE
    updateControls()
    progress.isIndeterminate = false
    val folder = path.lastOrNull()
    val value = (folder?.url ?: selected.values.lastOrNull()?.url).orEmpty().ifBlank {
      ShareSettings.read(this, if (folder == null) "upLoadUrl" else "fileUpLoadUrl")
    }
    val parameters = mapOf("token" to token, (if (folder == null) "dialog_ids" else "upload_file_id") to
      (folder?.folderID ?: selected.keys.joinToString(",")))
    worker.execute {
      var success = 0
      try {
        payloads.forEachIndexed { index, payload ->
          if (destroyed || Thread.currentThread().isInterrupted) return@execute
          val url = if (payload.file == null && folder == null) value.replace("/api/dialog/msg/sendfiles", "/api/dialog/msg/sendtext") else value
          try {
            transport.upload(ShareTransport.url(url, emptyMap()), payload, parameters) { percent ->
              ui {
                val total = ((index * 100 + percent) / payloads.size).coerceAtMost(99)
                progress.progress = total
                status.text = "${text("sendingTitle")} $total%"
              }
            }
            success += 1
          } catch (_: Exception) { if (destroyed || Thread.currentThread().isInterrupted) return@execute }
        }
        val failed = payloads.size - success
        ui {
          val message = when {
            failed == 0 -> text("sendSuccessTitle")
            success == 0 -> text("sendFailTitle")
            else -> "$success${text("successTotal")}, $failed${text("failTotal")}"
          }
          AlertDialog.Builder(this).setMessage(message).setCancelable(false)
            .setPositiveButton(android.R.string.ok) { _, _ -> finish() }.show()
        }
      } finally { if (destroyed && !isChangingConfigurations) directory.deleteRecursively() }
    }
  }

  private fun hideKeyboard() {
    search.clearFocus()
    (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).hideSoftInputFromWindow(search.windowToken, 0)
  }

  private fun ui(action: () -> Unit) { runOnUiThread { if (!destroyed && !isFinishing) action() } }

  override fun onSaveInstanceState(outState: Bundle) {
    if (::directory.isInitialized && payloads.isNotEmpty()) {
      outState.putString("directory", directory.name)
      outState.putString("payloads", JSONArray(payloads.map { it.json() }).toString())
      outState.putString("path", JSONArray(path.map { it.json }).toString())
      outState.putString("selected", JSONArray(selected.values.map { it.json }).toString())
    }
    super.onSaveInstanceState(outState)
  }

  override fun onDestroy() {
    destroyed = true
    listTransport.close()
    transport.close()
    worker.shutdownNow()
    imageWorker.shutdownNow()
    if (::directory.isInitialized && !isChangingConfigurations) directory.deleteRecursively()
    super.onDestroy()
  }
}
