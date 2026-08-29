import AppKit
import Foundation
import Vision

private enum ExitCode {
  static let success: Int32 = 0
  static let failure: Int32 = 1
}

private let requiredArgumentCount = 3
private let screenshotArgumentIndex = 1
private let expectedTextArgumentIndex = 2
private let topCandidateCount = 1

func normalized(_ value: String) -> String {
  value
    .lowercased()
    .split(whereSeparator: { $0.isWhitespace })
    .joined(separator: " ")
}

func verifyScreen(arguments: [String]) throws -> Bool {
  guard arguments.count == requiredArgumentCount else {
    throw ScreenVerificationError.invalidArguments
  }
  let screenshotPath = arguments[screenshotArgumentIndex]
  let expectedText = normalized(arguments[expectedTextArgumentIndex])
  guard
    let image = NSImage(contentsOfFile: screenshotPath),
    let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil)
  else {
    throw ScreenVerificationError.unreadableScreenshot
  }

  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.usesLanguageCorrection = true
  try VNImageRequestHandler(cgImage: cgImage).perform([request])
  let recognizedText = (request.results ?? [])
    .compactMap { $0.topCandidates(topCandidateCount).first?.string }
    .joined(separator: " ")
  let found = normalized(recognizedText).contains(expectedText)
  if !found {
    FileHandle.standardError.write(
      Data("Expected ‘\(arguments[expectedTextArgumentIndex])’; recognized ‘\(recognizedText)’.\n".utf8),
    )
  }
  return found
}

enum ScreenVerificationError: Error {
  case invalidArguments
  case unreadableScreenshot
}

do {
  exit(try verifyScreen(arguments: CommandLine.arguments) ? ExitCode.success : ExitCode.failure)
} catch {
  FileHandle.standardError.write(Data("Screen verification failed: \(error).\n".utf8))
  exit(ExitCode.failure)
}
