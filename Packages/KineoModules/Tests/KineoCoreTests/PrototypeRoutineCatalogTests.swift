import KineoCore
import Testing

@Suite("Prototype routine catalog")
struct PrototypeRoutineCatalogTests {
    @Test("Fixture has the exact required cardinalities and globally unique record IDs")
    func exactCardinalities() throws {
        let catalog = try PrototypeRoutineCatalog.make()
        let recordIDs = catalog.movements.map(\.metadata.id) +
            catalog.fragments.map(\.metadata.id) +
            catalog.primaryTemplates.map(\.metadata.id) +
            catalog.secondaryModules.map(\.metadata.id) +
            catalog.compatibilityRules.map(\.metadata.id)

        #expect(catalog.movements.count == PrototypeFixtureCounts.movements)
        #expect(catalog.fragments.count == PrototypeFixtureCounts.fragments)
        #expect(catalog.primaryTemplates.count == PrototypeFixtureCounts.primaryTemplates)
        #expect(catalog.secondaryModules.count == PrototypeFixtureCounts.secondaryModules)
        #expect(catalog.compatibilityRules.count == PrototypeFixtureCounts.compatibilityRules)
        #expect(Set(recordIDs).count == recordIDs.count)
    }

    @Test("Every area-level-duration variant has exactly one primary, fragment, and module")
    func exactVariantLookups() throws {
        let catalog = try PrototypeRoutineCatalog.make()
        for area in BodyArea.allCases {
            for level in RoutineLevel.allCases {
                for duration in PrototypeFixtureCounts.durations {
                    #expect(
                        catalog.primaryTemplates.count {
                            $0.area == area && $0.level == level && $0.duration == duration
                        } == PrototypeFixtureCounts.exactMatch
                    )
                    #expect(
                        catalog.fragments.count {
                            $0.area == area && $0.level == level && $0.duration == duration
                        } == PrototypeFixtureCounts.exactMatch
                    )
                    #expect(
                        catalog.secondaryModules.count {
                            $0.area == area && $0.level == level && $0.duration == duration
                        } == PrototypeFixtureCounts.exactMatch
                    )
                }
            }
        }
    }

    @Test("Every ordered distinct-area pair has one allowed fully reviewed rule")
    func exactCompatibilityMatrix() throws {
        let catalog = try PrototypeRoutineCatalog.make()
        for primaryArea in BodyArea.allCases {
            for secondaryArea in BodyArea.allCases {
                for level in RoutineLevel.allCases {
                    for duration in PrototypeFixtureCounts.durations {
                        let matches = catalog.compatibilityRules.filter {
                            $0.primaryArea == primaryArea &&
                                $0.secondaryArea == secondaryArea &&
                                $0.level == level &&
                                $0.duration == duration
                        }
                        if primaryArea == secondaryArea {
                            #expect(matches.isEmpty)
                        } else {
                            let rule = try #require(matches.first)
                            #expect(matches.count == PrototypeFixtureCounts.exactMatch)
                            #expect(rule.allowed)
                            #expect(rule.hasCompleteMechanicalReview)
                        }
                    }
                }
            }
        }
    }

    @Test("Prototype primary defaults and secondary modules use the exact authored timing")
    func exactTimingShapes() throws {
        let catalog = try PrototypeRoutineCatalog.make()
        let fragmentsByID = Dictionary(uniqueKeysWithValues: catalog.fragments.map {
            ($0.metadata.id, $0)
        })

        for primary in catalog.primaryTemplates {
            #expect(
                try defaultSeconds(primary: primary, fragmentsByID: fragmentsByID) ==
                    expectedNominalSeconds(for: primary.duration)
            )
        }
        for module in catalog.secondaryModules {
            #expect(sequenceSeconds(module.items) == expectedSlotSeconds(for: module.duration))
        }
    }

    @Test("Every base movement has one terminal same-area alternative")
    func exactAlternativeGraph() throws {
        let catalog = try PrototypeRoutineCatalog.make()
        let movementsByID = Dictionary(uniqueKeysWithValues: catalog.movements.map {
            ($0.metadata.id, $0)
        })
        let baseMovements = catalog.movements.filter { $0.metadata.id.rawValue.contains(".base.") }
        let alternatives = catalog.movements.filter {
            $0.metadata.id.rawValue.contains(".alternative.")
        }

        #expect(baseMovements.count == PrototypeFixtureCounts.baseMovements)
        #expect(alternatives.count == PrototypeFixtureCounts.alternativeMovements)
        for movement in baseMovements {
            let reference = try #require(movement.alternatives.first)
            let target = try #require(movementsByID[reference.movementID])
            #expect(movement.alternatives.count == PrototypeFixtureCounts.exactMatch)
            #expect(target.alternatives.isEmpty)
            #expect(target.supportedAreas == movement.supportedAreas)
            #expect(target.supportedLevels == movement.supportedLevels)
            #expect(reference.dosePolicy == .preserveScheduledDose)
        }
    }

    @Test("Every presented prototype string remains visibly labelled")
    func visiblePrototypeLabels() throws {
        let catalog = try PrototypeRoutineCatalog.make()
        let strings = try PrototypeRoutineCatalog.localizedStrings()
        for record in catalog.movements {
            let title = try #require(strings[record.metadata.displayNameKey.rawValue])
            #expect(title.contains(PrototypeFixtureCopy.label))
        }
        let artifactMetadata = catalog.fragments.map(\.metadata) +
            catalog.primaryTemplates.map(\.metadata) +
            catalog.secondaryModules.map(\.metadata) +
            catalog.compatibilityRules.map(\.metadata)
        for metadata in artifactMetadata {
            #expect(
                strings[metadata.displayNameKey.rawValue] == PrototypeFixtureCopy.contentLabel
            )
        }
    }

    private func defaultSeconds(
        primary: PrimaryTemplateVariant,
        fragmentsByID: [CatalogID: RoutineFragment]
    ) throws -> Int {
        var seconds = 0
        for item in primary.items {
            if let slot = item.slot {
                let fragment = try #require(fragmentsByID[slot.defaultFragmentID])
                seconds += sequenceSeconds(fragment.items)
            } else {
                seconds += itemSeconds(item)
            }
        }
        return seconds
    }

    private func sequenceSeconds(_ items: [SequenceItem]) -> Int {
        items.reduce(0) { $0 + itemSeconds($1) }
    }

    private func itemSeconds(_ item: SequenceItem) -> Int {
        item.dose?.estimatedSeconds ?? item.fixedSeconds ?? 0
    }

    private func expectedNominalSeconds(for duration: DurationVariant) -> Int {
        switch duration {
        case .quick: PrototypeCatalogDurations.quickNominalSeconds
        case .standard: PrototypeCatalogDurations.standardNominalSeconds
        }
    }

    private func expectedSlotSeconds(for duration: DurationVariant) -> Int {
        switch duration {
        case .quick: PrototypeFixtureCounts.quickSlotSeconds
        case .standard: PrototypeFixtureCounts.standardSlotSeconds
        }
    }
}

private enum PrototypeFixtureCounts {
    static let movements = 30
    static let baseMovements = 15
    static let alternativeMovements = 15
    static let fragments = 18
    static let primaryTemplates = 18
    static let secondaryModules = 18
    static let compatibilityRules = 36
    static let exactMatch = 1
    static let quickSlotSeconds = 120
    static let standardSlotSeconds = 240
    static let durations: [DurationVariant] = [.quick, .standard]
}

private enum PrototypeFixtureCopy {
    static let label = "Prototype"
    static let contentLabel = "Prototype content"
}
