import Foundation
import UIKit
import UniformTypeIdentifiers

enum ShareAttachmentLoader {
  private static func copy(_ file: URL, to directory: URL, suggestedName: String?) throws -> URL {
    let access = file.startAccessingSecurityScopedResource()
    defer { if access { file.stopAccessingSecurityScopedResource() } }
    if try file.resourceValues(forKeys: [.isDirectoryKey]).isDirectory == true {
      throw ShareFailure.localized("folderUnsupportTitle")
    }
    let folder = directory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: false)
    var name = suggestedName.map { URL(fileURLWithPath: $0).lastPathComponent } ?? file.lastPathComponent
    if name.isEmpty || name == "." || name == ".." { name = file.lastPathComponent }
    if URL(fileURLWithPath: name).pathExtension.isEmpty && !file.pathExtension.isEmpty { name += ".\(file.pathExtension)" }
    let result = folder.appendingPathComponent(name)
    // provider 的临时 URL 只在回调期间有效，必须在返回回调前复制。
    try FileManager.default.copyItem(at: file, to: result)
    return result
  }

  private static func file(_ provider: NSItemProvider, type: String, directory: URL) async throws -> ShareAttachment {
    try await withCheckedThrowingContinuation { continuation in
      provider.loadFileRepresentation(forTypeIdentifier: type) { url, error in
        do {
          guard let url = url else { throw error ?? ShareFailure.localized("emptyShareTitle") }
          continuation.resume(returning: .file(try copy(url, to: directory, suggestedName: provider.suggestedName)))
        } catch { continuation.resume(throwing: error) }
      }
    }
  }

  private static func item(_ provider: NSItemProvider, type: String, directory: URL) async throws -> ShareAttachment {
    try await withCheckedThrowingContinuation { continuation in
      provider.loadItem(forTypeIdentifier: type, options: nil) { value, error in
        do {
          if let url = value as? URL {
            if url.isFileURL { continuation.resume(returning: .file(try copy(url, to: directory, suggestedName: nil))) }
            else { continuation.resume(returning: .text(url.absoluteString)) }
          } else if let image = value as? UIImage, let data = image.pngData() {
            let url = directory.appendingPathComponent("screenShot_\(UUID().uuidString).png")
            try data.write(to: url, options: .atomic)
            continuation.resume(returning: .file(url))
          } else if let text = value as? String, !text.isEmpty {
            continuation.resume(returning: .text(text))
          } else if let text = value as? NSAttributedString, !text.string.isEmpty {
            continuation.resume(returning: .text(text.string))
          } else if let data = value as? Data, let text = String(data: data, encoding: .utf8), !text.isEmpty {
            continuation.resume(returning: .text(text))
          } else { throw error ?? ShareFailure.localized("emptyShareTitle") }
        } catch { continuation.resume(throwing: error) }
      }
    }
  }

  static func load(_ context: NSExtensionContext, directory: URL) async throws -> [ShareAttachment] {
    var result: [ShareAttachment] = []
    for extensionItem in context.inputItems.compactMap({ $0 as? NSExtensionItem }) {
      let providers = extensionItem.attachments ?? []
      for provider in providers {
        try Task.checkCancellation()
        if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
          result.append(try await item(provider, type: UTType.fileURL.identifier, directory: directory))
        } else if let type = provider.registeredTypeIdentifiers.first(where: {
          guard let type = UTType($0) else { return false }
          return type.conforms(to: .data) && !type.conforms(to: .text) && !type.conforms(to: .url)
        }) {
          do { result.append(try await file(provider, type: type, directory: directory)) }
          catch {
            if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
              result.append(try await item(provider, type: UTType.image.identifier, directory: directory))
            } else { throw error }
          }
        } else if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
          result.append(try await item(provider, type: UTType.url.identifier, directory: directory))
        } else if provider.hasItemConformingToTypeIdentifier(UTType.text.identifier) {
          result.append(try await item(provider, type: UTType.text.identifier, directory: directory))
        } else if let type = provider.registeredTypeIdentifiers.first {
          result.append(try await file(provider, type: type, directory: directory))
        } else { throw ShareFailure.localized("emptyShareTitle") }
      }
      if providers.isEmpty, let text = extensionItem.attributedContentText?.string, !text.isEmpty { result.append(.text(text)) }
    }
    guard !result.isEmpty else { throw ShareFailure.localized("emptyShareTitle") }
    return result
  }
}
