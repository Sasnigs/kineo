import ExpoModulesCore
import Foundation
import UIKit

private let privateDirectoryName = "KineoPrivate"
private let deletionMarkerName = ".kineo-deletion-pending"
private let exceptionDomain = "app.kineo.storage-protection"
private let exceptionCode = 1

private struct ProtectedDirectoryRecord: Record {
  @Field var path: String = ""
  @Field var uri: String = ""
  @Field var backupExcluded: Bool = false
  @Field var completeProtectionVerified: Bool = false
  @Field var completeProtectionSupported: Bool = true
}

private func storageException(_ reason: String) -> NSError {
  NSError(
    domain: exceptionDomain,
    code: exceptionCode,
    userInfo: [NSLocalizedDescriptionKey: reason]
  )
}

private func isProtectedDataAvailable() async -> Bool {
  await MainActor.run {
    UIApplication.shared.isProtectedDataAvailable
  }
}

/// Provides verified private-storage operations to the Expo application.
public class KineoStorageProtectionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("KineoStorageProtection")

    AsyncFunction("isProtectedDataAvailableAsync") {
      UIApplication.shared.isProtectedDataAvailable
    }.runOnQueue(.main)

    AsyncFunction("preparePrivateDirectoryAsync") { () async throws -> ProtectedDirectoryRecord in
      guard await isProtectedDataAvailable() else {
        throw storageException("Protected data is unavailable.")
      }
      try resumePendingDeletion()
      let directory = try privateDirectoryURL()
      try FileManager.default.createDirectory(
        at: directory,
        withIntermediateDirectories: true
      )
      return try protectAndInspect(directory)
    }

    AsyncFunction("protectDatabaseFilesAsync") { (databasePath: String) async throws -> [ProtectedDirectoryRecord] in
      guard await isProtectedDataAvailable() else {
        throw storageException("Protected data is unavailable.")
      }
      let directory = try privateDirectoryURL().standardizedFileURL
      let candidateURLs = KineoStoragePathPolicy.databaseFileURLs(from: databasePath)
      guard let databaseURL = candidateURLs.first else {
        throw storageException("The Kineo database path is invalid.")
      }
      guard FileManager.default.fileExists(atPath: databaseURL.path) else {
        throw storageException("The Kineo database does not exist.")
      }
      return try candidateURLs.compactMap { candidate in
        guard KineoStoragePathPolicy.contains(candidate, within: directory) else {
          throw storageException("A path escaped Kineo's private directory.")
        }
        guard FileManager.default.fileExists(atPath: candidate.path) else {
          return nil
        }
        return try protectAndInspect(candidate)
      }
    }

    AsyncFunction("beginDeletionAsync") { () async throws -> ProtectedDirectoryRecord in
      guard await isProtectedDataAvailable() else {
        throw storageException("Protected data is unavailable.")
      }
      let marker = try deletionMarkerURL()
      if !FileManager.default.fileExists(atPath: marker.path) {
        guard FileManager.default.createFile(atPath: marker.path, contents: Data()) else {
          throw storageException("The deletion marker could not be created.")
        }
      }
      return try protectAndInspect(marker)
    }

    AsyncFunction("deletePrivateStorageAsync") { () async throws -> Bool in
      guard await isProtectedDataAvailable() else {
        throw storageException("Protected data is unavailable.")
      }
      let marker = try deletionMarkerURL()
      guard FileManager.default.fileExists(atPath: marker.path) else {
        throw storageException("The deletion marker is missing.")
      }
      try removePrivateDirectoryIfPresent()
      return !FileManager.default.fileExists(atPath: try privateDirectoryURL().path)
    }

    AsyncFunction("finishDeletionAsync") { () async throws -> Bool in
      guard await isProtectedDataAvailable() else {
        throw storageException("Protected data is unavailable.")
      }
      let directory = try privateDirectoryURL()
      guard !FileManager.default.fileExists(atPath: directory.path) else {
        throw storageException("Private storage still exists.")
      }
      let marker = try deletionMarkerURL()
      if FileManager.default.fileExists(atPath: marker.path) {
        try FileManager.default.removeItem(at: marker)
      }
      return !FileManager.default.fileExists(atPath: marker.path)
    }
  }

  private func privateDirectoryURL() throws -> URL {
    try FileManager.default.url(
      for: .applicationSupportDirectory,
      in: .userDomainMask,
      appropriateFor: nil,
      create: true
    ).appendingPathComponent(privateDirectoryName, isDirectory: true)
  }

  private func applicationSupportURL() throws -> URL {
    try FileManager.default.url(
      for: .applicationSupportDirectory,
      in: .userDomainMask,
      appropriateFor: nil,
      create: true
    )
  }

  private func deletionMarkerURL() throws -> URL {
    try applicationSupportURL().appendingPathComponent(deletionMarkerName, isDirectory: false)
  }

  private func removePrivateDirectoryIfPresent() throws {
    let directory = try privateDirectoryURL()
    if FileManager.default.fileExists(atPath: directory.path) {
      try FileManager.default.removeItem(at: directory)
    }
    guard !FileManager.default.fileExists(atPath: directory.path) else {
      throw storageException("Private storage deletion could not be verified.")
    }
  }

  private func resumePendingDeletion() throws {
    let marker = try deletionMarkerURL()
    guard FileManager.default.fileExists(atPath: marker.path) else { return }
    try removePrivateDirectoryIfPresent()
    try FileManager.default.removeItem(at: marker)
    guard !FileManager.default.fileExists(atPath: marker.path) else {
      throw storageException("Pending deletion could not be completed.")
    }
  }

  private func protectAndInspect(_ url: URL) throws -> ProtectedDirectoryRecord {
    try FileManager.default.setAttributes(
      [.protectionKey: FileProtectionType.complete],
      ofItemAtPath: url.path
    )
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    var mutableURL = url
    try mutableURL.setResourceValues(values)

    let resourceValues = try mutableURL.resourceValues(forKeys: [.isExcludedFromBackupKey])
    guard resourceValues.isExcludedFromBackup == true else {
      throw storageException("Backup exclusion could not be verified.")
    }

    #if targetEnvironment(simulator)
    let protectionSupported = false
    let protectionVerified = false
    #else
    let protectionSupported = true
    let attributes = try FileManager.default.attributesOfItem(atPath: mutableURL.path)
    let protectionVerified = attributes[.protectionKey] as? FileProtectionType == .complete
    guard protectionVerified else {
      throw storageException("Complete Protection could not be verified.")
    }
    #endif

    return ProtectedDirectoryRecord(
      path: mutableURL.path,
      uri: mutableURL.absoluteString,
      backupExcluded: true,
      completeProtectionVerified: protectionVerified,
      completeProtectionSupported: protectionSupported
    )
  }
}
