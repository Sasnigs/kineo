import Foundation
import KineoCore
import XCTest

final class DomainPrimitiveTests: XCTestCase {
    func testStableIDAcceptsOnlyLowercaseCanonicalUUID() throws {
        XCTAssertNotNil(CheckInID(rawValue: "00000000-0000-0000-0000-000000000001"))
        XCTAssertNil(CheckInID(rawValue: "00000000-0000-0000-0000-00000000000A"))
        XCTAssertNil(CheckInID(rawValue: "not-an-id"))
    }

    func testStableIDDecodeRejectsInvalidValue() {
        XCTAssertThrowsError(try JSONDecoder().decode(CheckInID.self, from: Data("\"bad\"".utf8)))
    }

    func testNonEmptyStringRejectsWhitespace() {
        XCTAssertNil(NonEmptyString(rawValue: " \n "))
        XCTAssertNotNil(NonEmptyString(rawValue: "rules-v1"))
    }

    func testLocalDayRequiresRealISODate() {
        XCTAssertNotNil(LocalDay(rawValue: "2028-02-29"))
        XCTAssertNil(LocalDay(rawValue: "2027-02-29"))
        XCTAssertNil(LocalDay(rawValue: "2027-13-01"))
        XCTAssertNil(LocalDay(rawValue: "2027-01-32"))
        XCTAssertNil(LocalDay(rawValue: "01-01-2027"))
    }

    func testDigestRequiresLowercaseSHA256Shape() {
        XCTAssertNotNil(SHA256Digest(rawValue: String(repeating: "a", count: 64)))
        XCTAssertNil(SHA256Digest(rawValue: String(repeating: "A", count: 64)))
        XCTAssertNil(SHA256Digest(rawValue: String(repeating: "a", count: 63)))
    }

    func testPersistenceEnumsHaveStableRawValues() throws {
        XCTAssertEqual(BodyArea.upperMidBack.rawValue, "upperMidBack")
        XCTAssertEqual(RoutineStatus.safetyStopped.rawValue, "safetyStopped")
        XCTAssertEqual(try JSONEncoder().encode(DurationVariant.quick), Data("\"quick\"".utf8))
    }

    func testRoutineLevelOrdersOnlyByConservatism() {
        XCTAssertLessThan(RoutineLevel.gentle, .balanced)
        XCTAssertLessThan(RoutineLevel.balanced, .active)
    }
}
