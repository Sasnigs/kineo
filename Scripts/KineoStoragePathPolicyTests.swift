import Foundation

@main
enum KineoStoragePathPolicyTests {
  private static let databaseName = "kineo.sqlite"
  private static let writeAheadLogName = "kineo.sqlite-wal"
  private static let sharedMemoryName = "kineo.sqlite-shm"

  static func main() throws {
    let root = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
      .appendingPathComponent("Kineo Application Support", isDirectory: true)
    let privateDirectory = root.appendingPathComponent("KineoPrivate", isDirectory: true)
    let databaseURL = privateDirectory.appendingPathComponent(databaseName)

    let decodedURL = KineoStoragePathPolicy.localFileURL(from: databaseURL.absoluteString)
    try require(decodedURL.path == databaseURL.path, "Percent-encoded file URI was not decoded.")

    let candidates = KineoStoragePathPolicy.databaseFileURLs(from: databaseURL.absoluteString)
    try require(
      candidates.map(\.lastPathComponent) == [
        databaseName,
        writeAheadLogName,
        sharedMemoryName,
      ],
      "Database sidecar paths were not derived from the decoded path.",
    )
    try require(
      candidates.allSatisfy { KineoStoragePathPolicy.contains($0, within: privateDirectory) },
      "A valid database sidecar was rejected.",
    )

    let escapedURL = root.appendingPathComponent("outside.sqlite")
    try require(
      !KineoStoragePathPolicy.contains(escapedURL, within: privateDirectory),
      "An out-of-directory path was accepted.",
    )
  }

  private static func require(_ condition: @autoclosure () -> Bool, _ message: String) throws {
    guard condition() else {
      throw TestFailure(message: message)
    }
  }
}

private struct TestFailure: Error, CustomStringConvertible {
  let message: String
  var description: String { message }
}
