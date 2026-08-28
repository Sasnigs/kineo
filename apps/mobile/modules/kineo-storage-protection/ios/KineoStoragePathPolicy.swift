import Foundation

enum KineoStoragePathPolicy {
  private static let writeAheadLogSuffix = "-wal"
  private static let sharedMemorySuffix = "-shm"

  static func localFileURL(from value: String) -> URL {
    if let url = URL(string: value), url.isFileURL {
      return url.standardizedFileURL
    }
    return URL(fileURLWithPath: value).standardizedFileURL
  }

  static func databaseFileURLs(from value: String) -> [URL] {
    let databaseURL = localFileURL(from: value)
    return [
      databaseURL,
      URL(fileURLWithPath: databaseURL.path + writeAheadLogSuffix).standardizedFileURL,
      URL(fileURLWithPath: databaseURL.path + sharedMemorySuffix).standardizedFileURL,
    ]
  }

  static func contains(_ candidate: URL, within directory: URL) -> Bool {
    let resolvedDirectory = directory.resolvingSymlinksInPath().standardizedFileURL
    let resolvedCandidate = candidate.resolvingSymlinksInPath().standardizedFileURL
    let directoryPrefix = resolvedDirectory.path + "/"
    return resolvedCandidate.path == resolvedDirectory.path ||
      resolvedCandidate.path.hasPrefix(directoryPrefix)
  }
}
