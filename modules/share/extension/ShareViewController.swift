import UIKit
import ImageIO

/// 代码布局复用旧 ChatCell 的头像、昵称和单选图标尺寸。
private final class ShareDestinationCell: UITableViewCell {
  private let avatar = UIImageView()
  private let initials = UILabel()
  private let name = UILabel()
  private let indicator = UIImageView()
  private var nameLeading: NSLayoutConstraint!

  override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
    super.init(style: style, reuseIdentifier: reuseIdentifier)
    backgroundColor = .systemBackground
    selectionStyle = .none
    avatar.contentMode = .scaleAspectFill
    avatar.clipsToBounds = true
    avatar.layer.cornerRadius = 21
    initials.backgroundColor = .systemGreen
    initials.textColor = .white
    initials.font = .systemFont(ofSize: 14)
    initials.textAlignment = .center
    initials.clipsToBounds = true
    initials.layer.cornerRadius = 24
    name.font = .systemFont(ofSize: 15)
    name.textColor = .label
    name.lineBreakMode = .byTruncatingTail
    indicator.contentMode = .scaleAspectFit
    let children: [UIView] = [avatar, initials, name, indicator]
    for child in children {
      contentView.addSubview(child)
      child.translatesAutoresizingMaskIntoConstraints = false
    }
    nameLeading = name.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 58)
    NSLayoutConstraint.activate([
      avatar.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 8),
      avatar.centerYAnchor.constraint(equalTo: contentView.centerYAnchor),
      avatar.widthAnchor.constraint(equalToConstant: 42),
      avatar.heightAnchor.constraint(equalToConstant: 42),
      initials.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 8),
      initials.centerYAnchor.constraint(equalTo: contentView.centerYAnchor),
      initials.widthAnchor.constraint(equalToConstant: 48),
      initials.heightAnchor.constraint(equalToConstant: 48),
      nameLeading,
      name.centerYAnchor.constraint(equalTo: contentView.centerYAnchor),
      name.trailingAnchor.constraint(equalTo: indicator.leadingAnchor, constant: -8),
      indicator.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -20),
      indicator.centerYAnchor.constraint(equalTo: contentView.centerYAnchor),
      indicator.widthAnchor.constraint(equalToConstant: 20),
      indicator.heightAnchor.constraint(equalToConstant: 20),
    ])
    isAccessibilityElement = true
  }

  required init?(coder: NSCoder) { fatalError("仅支持代码布局") }

  func configure(_ destination: ShareDestination, selected: Bool) {
    let isFolder = destination.type == "children"
    name.text = destination.name
    initials.text = String(destination.name.suffix(2))
    avatar.image = nil
    avatar.isHidden = !isFolder
    initials.isHidden = isFolder
    nameLeading.constant = isFolder ? 58 : 64
    if isFolder {
      avatar.image = UIImage(named: "dir")
      indicator.image = UIImage(named: "arrow_black_right")?.withRenderingMode(.alwaysTemplate)
    } else {
      let asset = selected ? "radio-button-selected" : "radio-button-default"
      // 未选中的灰色圆环随深浅色变化，选中时保留旧资源的绿色。
      indicator.image = UIImage(named: asset)?.withRenderingMode(selected ? .alwaysOriginal : .alwaysTemplate)
    }
    indicator.tintColor = .secondaryLabel
    accessibilityLabel = destination.name
    accessibilityTraits = selected && !isFolder ? [.button, .selected] : .button
  }

  func setAvatar(_ image: UIImage) {
    avatar.image = image
    avatar.isHidden = false
    initials.isHidden = true
    nameLeading.constant = 58
  }
}

/// 沿用旧扩展的列表、会话多选、目录面包屑、搜索和逐文件上传协议。
final class ShareViewController: UIViewController, UITableViewDataSource, UITableViewDelegate, UISearchBarDelegate {
  private let transport = ShareTransport()
  private let table = UITableView(frame: .zero, style: .plain)
  private let search = UISearchBar()
  private let breadcrumbs = UIStackView()
  private let breadcrumbScroll = UIScrollView()
  private let sendButton = UIButton(type: .custom)
  private let cancelButton = UIButton(type: .custom)
  private let retryButton = UIButton(type: .custom)
  private let status = UILabel()
  private let spinner = UIActivityIndicatorView(style: .large)
  private let listOverlay = UIView()
  private let listState = UIStackView()
  private var language = Bundle.main
  private var rows: [ShareDestination] = []
  private var selected: [ShareDestination] = []
  private var path: [ShareDestination] = []
  private var attachments: [ShareAttachment] = []
  private var settings: [String: String] = [:]
  private var work: Task<Void, Never>?
  private var searchWork: DispatchWorkItem?
  private var revision = 0
  private var loading = true
  private var sending = false
  private var finished = false
  private var temporaryDirectory: URL?
  private let avatars = NSCache<NSURL, UIImage>()

  private var token: String {
    URLComponents(string: settings["chatList"] ?? "")?.queryItems?.first { $0.name == "token" }?.value ?? ""
  }

  private func text(_ key: String) -> String {
    let value = language.localizedString(forKey: key, value: nil, table: nil)
    if value != key { return value }
    // 旧英文语言包把这两个键拼成 sending，兼容复用的资源。
    let alternate = ["sendSuccessTitle": "sendingSuccessTitle", "sendFailTitle": "sendingFailTitle"][key] ?? key
    return language.localizedString(forKey: alternate, value: Bundle(path: Bundle.main.path(forResource: "en", ofType: "lproj") ?? "")?.localizedString(forKey: alternate, value: key, table: nil), table: nil)
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    isModalInPresentation = true
    settings = Dictionary(uniqueKeysWithValues: ShareStorage.keys.map { ($0, ShareStorage.read($0)) })
    if let name = settings["language"], let bundlePath = Bundle.main.path(forResource: name, ofType: "lproj"), let bundle = Bundle(path: bundlePath) {
      language = bundle
    }
    setupView()
    work = Task { [weak self] in
      guard let self = self, let context = self.extensionContext else { return }
      do {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("DooTaskShare-\(UUID().uuidString)", isDirectory: true)
        self.temporaryDirectory = directory
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        self.attachments = try await ShareAttachmentLoader.load(context, directory: directory)
        try Task.checkCancellation()
        self.loadList()
      } catch { if !self.finished { self.showError(error, fatal: true) } }
    }
  }

  private func setupView() {
    view.backgroundColor = .systemBackground
    // 与旧扩展一样自绘顶栏，普通按钮不会套用 iOS 26 导航栏的玻璃样式。
    let header = UIView()
    header.backgroundColor = .systemBackground
    header.heightAnchor.constraint(equalToConstant: 70).isActive = true
    let title = UILabel()
    title.text = text("sendTitle")
    title.textColor = .label
    title.font = .systemFont(ofSize: 17)
    title.textAlignment = .center
    cancelButton.setTitle(text("cancelTitle"), for: .normal)
    cancelButton.addTarget(self, action: #selector(cancelShare), for: .touchUpInside)
    sendButton.addTarget(self, action: #selector(send), for: .touchUpInside)
    for button in [cancelButton, sendButton] {
      button.setTitleColor(.systemBlue, for: .normal)
      button.setTitleColor(.lightGray, for: .disabled)
      button.titleLabel?.font = .systemFont(ofSize: 17)
      button.titleLabel?.lineBreakMode = .byTruncatingTail
      button.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
      header.addSubview(button)
      button.translatesAutoresizingMaskIntoConstraints = false
    }
    cancelButton.contentHorizontalAlignment = .leading
    sendButton.contentHorizontalAlignment = .trailing
    header.addSubview(title)
    title.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      cancelButton.leadingAnchor.constraint(equalTo: header.leadingAnchor, constant: 12),
      cancelButton.centerYAnchor.constraint(equalTo: header.centerYAnchor),
      cancelButton.heightAnchor.constraint(equalToConstant: 44),
      cancelButton.widthAnchor.constraint(greaterThanOrEqualToConstant: 44),
      cancelButton.widthAnchor.constraint(equalTo: sendButton.widthAnchor),
      sendButton.trailingAnchor.constraint(equalTo: header.trailingAnchor, constant: -12),
      sendButton.centerYAnchor.constraint(equalTo: header.centerYAnchor),
      sendButton.heightAnchor.constraint(equalToConstant: 44),
      title.centerXAnchor.constraint(equalTo: header.centerXAnchor),
      title.centerYAnchor.constraint(equalTo: header.centerYAnchor),
      title.leadingAnchor.constraint(greaterThanOrEqualTo: cancelButton.trailingAnchor, constant: 8),
      title.trailingAnchor.constraint(lessThanOrEqualTo: sendButton.leadingAnchor, constant: -8),
    ])
    search.frame = CGRect(x: 0, y: 0, width: view.bounds.width, height: 56)
    search.autoresizingMask = .flexibleWidth
    search.placeholder = text("searchTitle")
    search.delegate = self
    search.searchBarStyle = .minimal
    search.backgroundColor = .systemBackground
    search.backgroundImage = UIImage()
    search.setSearchFieldBackgroundImage(UIImage(), for: .normal)
    search.searchTextField.backgroundColor = .systemBackground
    search.searchTextField.textColor = .label
    search.searchTextField.borderStyle = .none
    search.searchTextField.layer.cornerRadius = 8
    search.searchTextField.clipsToBounds = true
    breadcrumbs.axis = .horizontal
    breadcrumbs.spacing = 12
    breadcrumbs.isLayoutMarginsRelativeArrangement = true
    breadcrumbs.layoutMargins = UIEdgeInsets(top: 0, left: 12, bottom: 0, right: 12)
    breadcrumbScroll.addSubview(breadcrumbs)
    breadcrumbs.translatesAutoresizingMaskIntoConstraints = false
    let breadcrumbHeight = breadcrumbScroll.heightAnchor.constraint(equalToConstant: 44)
    breadcrumbHeight.priority = .defaultHigh
    NSLayoutConstraint.activate([
      breadcrumbs.leadingAnchor.constraint(equalTo: breadcrumbScroll.contentLayoutGuide.leadingAnchor),
      breadcrumbs.trailingAnchor.constraint(equalTo: breadcrumbScroll.contentLayoutGuide.trailingAnchor),
      breadcrumbs.topAnchor.constraint(equalTo: breadcrumbScroll.contentLayoutGuide.topAnchor),
      breadcrumbs.bottomAnchor.constraint(equalTo: breadcrumbScroll.contentLayoutGuide.bottomAnchor),
      breadcrumbs.heightAnchor.constraint(equalTo: breadcrumbScroll.frameLayoutGuide.heightAnchor),
      breadcrumbHeight,
    ])
    status.textAlignment = .center
    status.numberOfLines = 0
    status.font = .systemFont(ofSize: 15)
    status.textColor = .label
    status.isHidden = true
    retryButton.setImage(UIImage(named: "refresh"), for: .normal)
    retryButton.imageView?.contentMode = .scaleAspectFit
    retryButton.accessibilityLabel = text("netWorkErrorTitle")
    retryButton.addTarget(self, action: #selector(retry), for: .touchUpInside)
    retryButton.isHidden = true
    spinner.hidesWhenStopped = true
    spinner.color = .label
    table.dataSource = self
    table.delegate = self
    table.rowHeight = 60
    table.register(ShareDestinationCell.self, forCellReuseIdentifier: "destination")
    table.keyboardDismissMode = .onDrag
    table.backgroundColor = .systemBackground
    table.separatorStyle = .singleLine
    table.separatorColor = .separator
    table.sectionHeaderTopPadding = 0
    table.tableFooterView = UIView()
    let listArea = UIView()
    listArea.addSubview(table)
    table.translatesAutoresizingMaskIntoConstraints = false
    // 透明遮罩拦截列表触摸，圆角 HUD 固定在列表区域中央。
    listArea.addSubview(listOverlay)
    listOverlay.translatesAutoresizingMaskIntoConstraints = false
    listState.addArrangedSubview(spinner)
    listState.addArrangedSubview(retryButton)
    listState.addArrangedSubview(status)
    listState.axis = .vertical
    listState.alignment = .center
    listState.spacing = 12
    listState.layer.cornerRadius = 12
    listState.layer.shadowColor = UIColor.black.cgColor
    listState.layer.shadowRadius = 12
    listState.layer.shadowOffset = CGSize(width: 0, height: 2)
    listState.isLayoutMarginsRelativeArrangement = true
    listState.layoutMargins = UIEdgeInsets(top: 20, left: 20, bottom: 20, right: 20)
    listOverlay.addSubview(listState)
    listState.translatesAutoresizingMaskIntoConstraints = false
    // 隐藏 arrangedSubview 时，UIStackView 会添加零高度约束。
    let retryHeight = retryButton.heightAnchor.constraint(equalToConstant: 70)
    retryHeight.priority = .defaultHigh
    NSLayoutConstraint.activate([
      table.topAnchor.constraint(equalTo: listArea.topAnchor),
      table.bottomAnchor.constraint(equalTo: listArea.bottomAnchor),
      table.leadingAnchor.constraint(equalTo: listArea.leadingAnchor),
      table.trailingAnchor.constraint(equalTo: listArea.trailingAnchor),
      listOverlay.topAnchor.constraint(equalTo: listArea.topAnchor),
      listOverlay.bottomAnchor.constraint(equalTo: listArea.bottomAnchor),
      listOverlay.leadingAnchor.constraint(equalTo: listArea.leadingAnchor),
      listOverlay.trailingAnchor.constraint(equalTo: listArea.trailingAnchor),
      listState.centerXAnchor.constraint(equalTo: listOverlay.centerXAnchor),
      listState.centerYAnchor.constraint(equalTo: listOverlay.centerYAnchor),
      listState.leadingAnchor.constraint(greaterThanOrEqualTo: listOverlay.leadingAnchor, constant: 24),
      listState.trailingAnchor.constraint(lessThanOrEqualTo: listOverlay.trailingAnchor, constant: -24),
      listState.widthAnchor.constraint(greaterThanOrEqualToConstant: 100),
      listState.widthAnchor.constraint(lessThanOrEqualToConstant: 280),
      listState.heightAnchor.constraint(greaterThanOrEqualToConstant: 100),
      status.widthAnchor.constraint(equalTo: listState.layoutMarginsGuide.widthAnchor),
      retryHeight,
      retryButton.widthAnchor.constraint(equalToConstant: 70),
    ])
    let stack = UIStackView(arrangedSubviews: [header, breadcrumbScroll, listArea])
    stack.axis = .vertical
    stack.spacing = 0
    view.addSubview(stack)
    stack.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
      stack.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
      stack.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
      stack.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
    ])
    updateControls()
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    // tableHeaderView 使用 frame，横竖屏和扩展面板宽度变化时同步尺寸。
    if table.tableHeaderView === search && search.frame.width != table.bounds.width {
      search.frame = CGRect(x: 0, y: 0, width: table.bounds.width, height: 56)
      table.tableHeaderView = search
    }
  }

  private func updateControls() {
    sendButton.setTitle(text("sendTitle") + (path.isEmpty && !selected.isEmpty ? "(\(selected.count))" : ""), for: .normal)
    sendButton.isEnabled = !loading && !sending && !attachments.isEmpty && (!path.isEmpty || !selected.isEmpty)
    table.isUserInteractionEnabled = !loading && !sending
    search.isUserInteractionEnabled = !loading && !sending
    if path.isEmpty {
      if table.tableHeaderView !== search { table.tableHeaderView = search }
    } else {
      table.tableHeaderView = nil
    }
    breadcrumbScroll.isHidden = path.isEmpty
    breadcrumbs.isUserInteractionEnabled = !loading && !sending
    if loading || sending { spinner.startAnimating() } else { spinner.stopAnimating() }
    listState.backgroundColor = loading || sending ? .secondarySystemBackground : .clear
    listState.layer.shadowOpacity = loading || sending ? 0.12 : 0
    listOverlay.isHidden = !loading && !sending && status.isHidden && retryButton.isHidden
  }

  private func setStatus(_ message: String?) {
    status.text = message
    status.isHidden = message?.isEmpty != false
  }

  private func loadList() {
    guard !finished && !sending && !attachments.isEmpty else { return }
    revision += 1
    work?.cancel()
    let requestRevision = revision
    loading = true
    rows = []
    table.reloadData()
    retryButton.isHidden = true
    setStatus(nil)
    updateControls()
    work = Task { [weak self] in
      guard let self = self else { return }
      do {
        guard !self.token.isEmpty else { throw ShareFailure.localized("unLoginTitle") }
        let value = self.path.last?.url ?? self.settings["chatList"] ?? ""
        var parameters = ["token": self.token]
        if self.path.isEmpty {
          parameters["type"] = self.attachments.contains { $0.isFile } ? "file" : "text"
          parameters["key"] = self.search.text ?? ""
        }
        let url = try ShareTransport.url(value, parameters: parameters)
        let result = try await self.transport.list(url)
        guard !self.finished && requestRevision == self.revision else { return }
        self.rows = result
        self.loading = false
        self.table.reloadData()
        self.updateControls()
      } catch {
        guard !self.finished && requestRevision == self.revision else { return }
        self.showError(error, fatal: false)
      }
    }
  }

  private func showError(_ error: Error, fatal: Bool) {
    loading = false
    let message: String
    switch error {
    case ShareFailure.localized(let key): message = text(key)
    case ShareFailure.server(let value): message = value.isEmpty ? text("netWorkErrorTitle") : value
    default: message = text("netWorkErrorTitle")
    }
    setStatus(message)
    retryButton.isHidden = fatal
    updateControls()
  }

  @objc private func retry() { loadList() }

  private func navigate(to depth: Int) {
    guard !sending else { return }
    path = Array(path.prefix(depth))
    search.text = ""
    searchWork?.cancel()
    updateBreadcrumbs()
    loadList()
  }

  private func updateBreadcrumbs() {
    for child in breadcrumbs.arrangedSubviews { breadcrumbs.removeArrangedSubview(child); child.removeFromSuperview() }
    for (depth, name) in ([text("allTitle")] + path.map { $0.name }).enumerated() {
      let button = UIButton(type: .custom)
      button.setTitle(depth == 0 ? name : "› \(name)", for: .normal)
      button.setTitleColor(.systemBlue, for: .normal)
      button.titleLabel?.font = .systemFont(ofSize: 15)
      button.addAction(UIAction { [weak self] _ in self?.navigate(to: depth) }, for: .touchUpInside)
      breadcrumbs.addArrangedSubview(button)
    }
  }

  func searchBar(_ searchBar: UISearchBar, textDidChange searchText: String) {
    searchWork?.cancel()
    // 立即使在途结果失效，避免旧关键词响应覆盖新搜索。
    revision += 1
    let work = DispatchWorkItem { [weak self] in self?.loadList() }
    searchWork = work
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3, execute: work)
  }

  func searchBarSearchButtonClicked(_ searchBar: UISearchBar) {
    searchWork?.cancel()
    searchBar.resignFirstResponder()
    loadList()
  }

  func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { rows.count }

  func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
    let cell = tableView.dequeueReusableCell(withIdentifier: "destination", for: indexPath) as! ShareDestinationCell
    let row = rows[indexPath.row]
    cell.configure(row, selected: selected.contains { $0.dialogID == row.dialogID })
    if let url = URL(string: row.icon), ["https", "http"].contains(url.scheme ?? "") {
      if let image = avatars.object(forKey: url as NSURL) { cell.setAvatar(image) }
      else {
        let currentRevision = revision
        URLSession.shared.dataTask(with: url) { [weak self, weak cell] data, _, _ in
          guard let data = data, data.count < 2 * 1024 * 1024,
                let source = CGImageSourceCreateWithData(data as CFData, nil),
                let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                  kCGImageSourceCreateThumbnailFromImageAlways: true,
                  kCGImageSourceThumbnailMaxPixelSize: 80,
                  kCGImageSourceCreateThumbnailWithTransform: true,
                ] as CFDictionary) else { return }
          let image = UIImage(cgImage: thumbnail, scale: 2, orientation: .up)
          DispatchQueue.main.async {
            guard let self = self, !self.finished, self.revision == currentRevision,
                  let cell = cell, self.table.indexPath(for: cell) == indexPath else { return }
            self.avatars.setObject(image, forKey: url as NSURL)
            cell.setAvatar(image)
          }
        }.resume()
      }
    }
    return cell
  }

  func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
    tableView.deselectRow(at: indexPath, animated: false)
    let row = rows[indexPath.row]
    if row.type == "children" {
      path.append(row)
      search.resignFirstResponder()
      searchWork?.cancel()
      updateBreadcrumbs()
      loadList()
    } else if let index = selected.firstIndex(where: { $0.dialogID == row.dialogID }) {
      selected.remove(at: index)
    } else if !row.dialogID.isEmpty { selected.append(row) }
    table.reloadData()
    updateControls()
  }

  @objc private func send() {
    guard sendButton.isEnabled, let directory = temporaryDirectory else { return }
    searchWork?.cancel()
    view.endEditing(true)
    sending = true
    retryButton.isHidden = true
    setStatus("\(text("sendingTitle")) 0%")
    updateControls()
    let folder = path.last
    let baseURL = folder?.url ?? selected.last?.url ?? settings[folder == nil ? "upLoadUrl" : "fileUpLoadUrl"] ?? ""
    let parameters = folder.map { ["token": token, "upload_file_id": $0.folderID] }
      ?? ["token": token, "dialog_ids": selected.map { $0.dialogID }.joined(separator: ",")]
    work = Task { [weak self] in
      guard let self = self else { return }
      var success = 0
      for (index, attachment) in self.attachments.enumerated() {
        if self.finished || Task.isCancelled { return }
        self.transport.onProgress = { [weak self] fraction in
          guard let self = self, !self.finished else { return }
          let percent = min(99, Int((Double(index) + fraction) / Double(self.attachments.count) * 100))
          self.setStatus("\(self.text("sendingTitle")) \(percent)%")
        }
        do {
          var value = baseURL
          // 混合图片/文本分享时，文本仍使用后端的 sendtext 接口。
          if !attachment.isFile && folder == nil { value = value.replacingOccurrences(of: "/api/dialog/msg/sendfiles", with: "/api/dialog/msg/sendtext") }
          let url = try ShareTransport.url(value, parameters: [:])
          try await self.transport.upload(attachment, to: url, parameters: parameters, directory: directory)
          success += 1
        } catch { if self.finished || Task.isCancelled { return } }
      }
      self.transport.onProgress = nil
      let failed = self.attachments.count - success
      let message = failed == 0 ? self.text("sendSuccessTitle") : (success == 0 ? self.text("sendFailTitle") : "\(success)\(self.text("successTotal")), \(failed)\(self.text("failTotal"))")
      self.spinner.stopAnimating()
      self.setStatus(message)
      let completed = success > 0
      DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in self?.finish(success: completed) }
    }
  }

  @objc private func cancelShare() { finish(success: false) }

  private func finish(success: Bool) {
    guard !finished else { return }
    finished = true
    revision += 1
    searchWork?.cancel()
    work?.cancel()
    transport.cancel()
    if let directory = temporaryDirectory { try? FileManager.default.removeItem(at: directory) }
    if success { extensionContext?.completeRequest(returningItems: nil, completionHandler: nil) }
    else { extensionContext?.cancelRequest(withError: NSError(domain: "DooTaskShare", code: NSUserCancelledError)) }
  }
}
