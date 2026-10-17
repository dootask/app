import UIKit
import ImageIO

/// 沿用旧扩展的列表、会话多选、目录面包屑、搜索和逐文件上传协议。
final class ShareViewController: UIViewController, UITableViewDataSource, UITableViewDelegate, UISearchBarDelegate {
  private let transport = ShareTransport()
  private let table = UITableView(frame: .zero, style: .plain)
  private let search = UISearchBar()
  private let breadcrumbs = UIStackView()
  private let breadcrumbScroll = UIScrollView()
  private let sendButton = UIButton(type: .system)
  private let cancelButton = UIButton(type: .system)
  private let retryButton = UIButton(type: .system)
  private let status = UILabel()
  private let spinner = UIActivityIndicatorView(style: .medium)
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
    let title = UILabel()
    title.text = "DooTask"
    title.textAlignment = .center
    title.setContentHuggingPriority(.defaultLow, for: .horizontal)
    cancelButton.setTitle(text("cancelTitle"), for: .normal)
    cancelButton.addTarget(self, action: #selector(cancelShare), for: .touchUpInside)
    sendButton.addTarget(self, action: #selector(send), for: .touchUpInside)
    let header = UIStackView(arrangedSubviews: [cancelButton, title, sendButton])
    header.spacing = 12
    header.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
    search.placeholder = text("searchTitle")
    search.delegate = self
    search.searchBarStyle = .minimal
    breadcrumbs.axis = .horizontal
    breadcrumbs.spacing = 12
    breadcrumbScroll.addSubview(breadcrumbs)
    breadcrumbs.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      breadcrumbs.leadingAnchor.constraint(equalTo: breadcrumbScroll.contentLayoutGuide.leadingAnchor),
      breadcrumbs.trailingAnchor.constraint(equalTo: breadcrumbScroll.contentLayoutGuide.trailingAnchor),
      breadcrumbs.topAnchor.constraint(equalTo: breadcrumbScroll.contentLayoutGuide.topAnchor),
      breadcrumbs.bottomAnchor.constraint(equalTo: breadcrumbScroll.contentLayoutGuide.bottomAnchor),
      breadcrumbs.heightAnchor.constraint(equalTo: breadcrumbScroll.frameLayoutGuide.heightAnchor),
      breadcrumbScroll.heightAnchor.constraint(equalToConstant: 44),
    ])
    status.textAlignment = .center
    status.numberOfLines = 0
    status.textColor = .secondaryLabel
    retryButton.setImage(UIImage(systemName: "arrow.clockwise"), for: .normal)
    retryButton.accessibilityLabel = text("netWorkErrorTitle")
    retryButton.addTarget(self, action: #selector(retry), for: .touchUpInside)
    retryButton.isHidden = true
    table.dataSource = self
    table.delegate = self
    table.rowHeight = 60
    table.keyboardDismissMode = .onDrag
    let stack = UIStackView(arrangedSubviews: [header, search, breadcrumbScroll, spinner, status, retryButton, table])
    stack.axis = .vertical
    stack.spacing = 4
    view.addSubview(stack)
    stack.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
      stack.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
      stack.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 12),
      stack.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -12),
    ])
    spinner.startAnimating()
    updateControls()
  }

  private func updateControls() {
    sendButton.setTitle(text("sendTitle") + (path.isEmpty && !selected.isEmpty ? "(\(selected.count))" : ""), for: .normal)
    sendButton.isEnabled = !loading && !sending && !attachments.isEmpty && (!path.isEmpty || !selected.isEmpty)
    table.isUserInteractionEnabled = !loading && !sending
    search.isUserInteractionEnabled = !sending
    search.isHidden = !path.isEmpty
    breadcrumbScroll.isHidden = path.isEmpty
    breadcrumbs.isUserInteractionEnabled = !loading && !sending
    if loading || sending { spinner.startAnimating() } else { spinner.stopAnimating() }
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
    status.text = nil
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
    status.text = message
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
      let button = UIButton(type: .system)
      button.setTitle(depth == 0 ? name : "› \(name)", for: .normal)
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
    let cell = tableView.dequeueReusableCell(withIdentifier: "destination") ?? UITableViewCell(style: .default, reuseIdentifier: "destination")
    let row = rows[indexPath.row]
    cell.textLabel?.text = row.name
    cell.accessoryType = row.type == "children" ? .disclosureIndicator : (selected.contains { $0.dialogID == row.dialogID } ? .checkmark : .none)
    cell.imageView?.image = UIImage(systemName: row.type == "children" ? "folder" : "person.crop.circle")
    cell.imageView?.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 32)
    if let url = URL(string: row.icon), ["https", "http"].contains(url.scheme ?? "") {
      if let image = avatars.object(forKey: url as NSURL) { cell.imageView?.image = image }
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
            cell.imageView?.image = image
            cell.setNeedsLayout()
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
          self.status.text = "\(self.text("sendingTitle")) \(percent)%"
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
      self.status.text = message
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
