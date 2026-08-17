import Foundation
import KineoCore

/// Wall-clock adapter kept outside deterministic Core rules.
public struct SystemProductClock: ProductClock {
    public init() {}

    public func now() -> ProductMoment? {
        let date = Date()
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .autoupdatingCurrent
        let components = calendar.dateComponents([.year, .month, .day], from: date)
        guard let year = components.year,
              let month = components.month,
              let day = components.day else { return nil }
        let dayText = String(
            format: ProductTimeFormat.localDay,
            year,
            month,
            day
        )
        let timestamp = Int64((date.timeIntervalSince1970 * ProductTimeFormat.millisecondsPerSecond).rounded())
        guard let localDay = LocalDay(rawValue: dayText),
              let timeZoneID = NonEmptyString(rawValue: calendar.timeZone.identifier),
              let calendarID = NonEmptyString(rawValue: ProductTimeFormat.gregorian) else {
            return nil
        }
        return ProductMoment(
            timestamp: TimestampMilliseconds(rawValue: timestamp),
            dayContext: LocalDayContext(
                localDay: localDay,
                timeZoneID: timeZoneID,
                calendarID: calendarID
            )
        )
    }
}

/// Monotonic process clock used only for active routine elapsed time.
public struct SystemRoutineMonotonicClock: RoutineMonotonicClock {
    public init() {}

    public func nowMilliseconds() async -> Int64? {
        let value = ProcessInfo.processInfo.systemUptime * ProductTimeFormat.millisecondsPerSecond
        guard value.isFinite,
              value >= TimeInterval.zero,
              value <= Double(Int64.max) else { return nil }
        return Int64(value.rounded(.down))
    }
}

/// Real local-store orchestration for the functional internal prototype flow.
public actor PrototypeProductService: KineoProductServing {
    private let location: KineoStoreLocation?
    private let protectedData: any KineoProtectedDataAvailability
    private let storageProtector: any KineoStorageProtecting
    private let clock: any ProductClock
    private let monotonicClock: any RoutineMonotonicClock
    private let catalogProvider: any InstalledPrototypeCatalogProviding
    private var store: KineoGRDBStore?
    private var activeStepStartedAt = [RoutineSessionID: Int64]()

    public init(
        location: KineoStoreLocation? = nil,
        protectedData: (any KineoProtectedDataAvailability)? = nil,
        storageProtector: any KineoStorageProtecting = FoundationKineoStorageProtector(),
        clock: any ProductClock = SystemProductClock(),
        monotonicClock: any RoutineMonotonicClock = SystemRoutineMonotonicClock(),
        catalogProvider: any InstalledPrototypeCatalogProviding = BundledInstalledPrototypeCatalogProvider()
    ) {
        self.location = location
        #if canImport(UIKit)
        self.protectedData = protectedData ?? SystemProtectedDataAvailability()
        #else
        self.protectedData = protectedData ?? AlwaysAvailableProtectedData()
        #endif
        self.storageProtector = storageProtector
        self.clock = clock
        self.monotonicClock = monotonicClock
        self.catalogProvider = catalogProvider
    }

    public func initialState() async -> AppLaunchState {
        guard let resolvedLocation = location ?? Self.defaultLocation() else {
            return .foundationUnavailable
        }
        do {
            let candidate = try await KineoGRDBStore.open(
                location: resolvedLocation,
                protectedData: protectedData,
                storageProtector: storageProtector
            )
            _ = try await candidate.loadSnapshot()
            _ = try await catalogProvider.load()
            store = candidate
            return .foundationReady
        } catch KineoPersistenceFailure.deletedStore {
            return await retryAfterCompletedDeletion(at: resolvedLocation)
        } catch KineoPersistenceFailure.protectedDataUnavailable,
                KineoCore.PersistenceError.protectedDataUnavailable {
            return .protectedDataUnavailable
        } catch {
            return .foundationUnavailable
        }
    }

    public func loadProductStartState() async throws(ProductFlowError) -> ProductStartState {
        do {
            let snapshot = try await requiredStore().loadSnapshot()
            guard let profile = snapshot.profileState?.profile else {
                return .onboarding(.welcome)
            }
            guard profile.adultAcknowledged else { return .onboarding(.welcome) }
            guard let primaryArea = profile.primaryArea else { return .onboarding(.primaryArea) }
            guard profile.safetyBoundaryVersion != nil,
                  profile.safetyAcknowledgedAt != nil else {
                return .onboarding(.safetyBoundary(primaryArea))
            }
            guard profile.onboardingCompletedAt != nil else {
                return .onboarding(.firstCheckIn(primaryArea))
            }
            if let session = snapshot.routineSessions.first(where: { !$0.status.isTerminal }) {
                return .unfinishedRoutine(
                    try await restoreUnfinishedRoutine(session, snapshot: snapshot)
                )
            }
            if let attention = firstAttention(in: snapshot) {
                return .attentionRequired(attentionPrompt(for: attention))
            }
            let currentMoment = try moment()
            if let draft = latestNormalDraft(in: snapshot) {
                if draft.primaryArea == primaryArea,
                   draft.dayContext == currentMoment.dayContext {
                    return .unfinishedCheckIn(checkInDraft(from: draft))
                }
                try await abandon(draft, store: try requiredStore())
            }
            if let decision = latestUnconsumedDecision(in: snapshot),
               let checkIn = snapshot.checkIns.first(where: { $0.id == decision.checkInID }),
               checkIn.primaryArea == primaryArea,
               checkIn.dayContext == currentMoment.dayContext {
                return .unfinishedPlan(try await preparePlan(
                    checkInID: checkIn.id,
                    duration: decision.durationVariant,
                    requestedLevel: decision.requestedOverride
                ))
            }
            return .today(primaryArea)
        } catch {
            throw map(error)
        }
    }

    public func confirmAdultEligibility() async throws(ProductFlowError) {
        do {
            let store = try requiredStore()
            let snapshot = try await store.loadSnapshot()
            let moment = try moment()
            let existing = snapshot.profileState?.profile
            let profile = try UserProfile(
                onboardingCompletedAt: existing?.onboardingCompletedAt,
                adultAcknowledged: true,
                safetyBoundaryVersion: existing?.safetyBoundaryVersion,
                safetyAcknowledgedAt: existing?.safetyAcknowledgedAt,
                primaryArea: existing?.primaryArea,
                secondaryArea: nil,
                routinePreference: nil,
                weeklyGoalDays: existing?.weeklyGoalDays ?? UserProfile.defaultWeeklyGoalDays,
                telemetryChoice: existing?.telemetryChoice ?? .notOffered,
                createdAt: existing?.createdAt ?? moment.timestamp,
                updatedAt: moment.timestamp
            )
            try await store.saveProfile(SaveProfileCommand(
                state: ProfileState(
                    profile: profile,
                    reminderSettings: snapshot.profileState?.reminderSettings
                )
            ))
        } catch {
            throw map(error)
        }
    }

    public func savePrimaryArea(_ area: BodyArea) async throws(ProductFlowError) {
        do {
            try await updateProfile { existing, moment in
                try UserProfile(
                    onboardingCompletedAt: existing.onboardingCompletedAt,
                    adultAcknowledged: existing.adultAcknowledged,
                    safetyBoundaryVersion: existing.safetyBoundaryVersion,
                    safetyAcknowledgedAt: existing.safetyAcknowledgedAt,
                    primaryArea: area,
                    secondaryArea: nil,
                    routinePreference: existing.routinePreference,
                    weeklyGoalDays: existing.weeklyGoalDays,
                    telemetryChoice: existing.telemetryChoice,
                    createdAt: existing.createdAt,
                    updatedAt: moment.timestamp
                )
            }
        } catch {
            throw map(error)
        }
    }

    public func acknowledgeSafetyBoundary() async throws(ProductFlowError) {
        do {
            try await updateProfile { existing, moment in
                guard existing.primaryArea != nil else { throw ProductFlowError.invalidState }
                return try UserProfile(
                    onboardingCompletedAt: existing.onboardingCompletedAt,
                    adultAcknowledged: existing.adultAcknowledged,
                    safetyBoundaryVersion: try NonEmptyString(
                        validating: PrototypeProductConfiguration.safetyBoundaryVersion
                    ),
                    safetyAcknowledgedAt: moment.timestamp,
                    primaryArea: existing.primaryArea,
                    secondaryArea: nil,
                    routinePreference: existing.routinePreference,
                    weeklyGoalDays: existing.weeklyGoalDays,
                    telemetryChoice: existing.telemetryChoice,
                    createdAt: existing.createdAt,
                    updatedAt: moment.timestamp
                )
            }
        } catch {
            throw map(error)
        }
    }

    public func completeOnboarding() async throws(ProductFlowError) -> BodyArea {
        do {
            var completedArea: BodyArea?
            try await updateProfile { existing, moment in
                guard let area = existing.primaryArea,
                      existing.adultAcknowledged,
                      existing.safetyBoundaryVersion != nil,
                      existing.safetyAcknowledgedAt != nil else {
                    throw ProductFlowError.invalidState
                }
                completedArea = area
                return try UserProfile(
                    onboardingCompletedAt: existing.onboardingCompletedAt ?? moment.timestamp,
                    adultAcknowledged: existing.adultAcknowledged,
                    safetyBoundaryVersion: existing.safetyBoundaryVersion,
                    safetyAcknowledgedAt: existing.safetyAcknowledgedAt,
                    primaryArea: area,
                    secondaryArea: nil,
                    routinePreference: existing.routinePreference,
                    weeklyGoalDays: existing.weeklyGoalDays,
                    telemetryChoice: existing.telemetryChoice,
                    createdAt: existing.createdAt,
                    updatedAt: moment.timestamp
                )
            }
            guard let completedArea else { throw ProductFlowError.invalidState }
            return completedArea
        } catch {
            throw map(error)
        }
    }

    public func respondToAttentionReturn(
        _ prompt: AttentionPrompt,
        answer: ConditionalSafetyAnswer
    ) async throws(ProductFlowError) -> AttentionResolution {
        do {
            let store = try requiredStore()
            let snapshot = try await store.loadSnapshot()
            if let existing = snapshot.safetyEvents.first(where: { $0.id == prompt.responseEventID }) {
                guard existing.area == prompt.area,
                      existing.returnAnswer == answer,
                      existing.kind == (answer == .yes ? .attentionClearedReturnedToUsual : .attentionReaffirmed)
                else { throw ProductFlowError.invalidState }
                return try attentionResolution(from: snapshot)
            }
            guard let attention = snapshot.attentionStates.first(where: { $0.area == prompt.area }),
                  attention.updatedAt == prompt.expectedAttentionUpdatedAt else {
                throw ProductFlowError.invalidState
            }
            let eventMoment = try moment(after: attention.updatedAt)
            let clearsAttention = answer == .yes
            let event = try SafetyEvent(
                id: prompt.responseEventID,
                area: prompt.area,
                kind: clearsAttention ? .attentionClearedReturnedToUsual : .attentionReaffirmed,
                sourceCheckInEntryID: nil,
                returnAnswer: answer,
                occurredAt: eventMoment.timestamp,
                dayContext: eventMoment.dayContext
            )
            let mutation = try SafetyMutation(
                event: event,
                statusAfter: clearsAttention ? .normal : .attentionRequired,
                expectedAttentionUpdatedAt: attention.updatedAt
            )
            try await store.applySafetyMutation(try ApplySafetyMutationCommand(mutation: mutation))
            return try attentionResolution(from: try await store.loadSnapshot())
        } catch {
            throw map(error)
        }
    }

    public func beginAttentionCorrection(
        _ prompt: AttentionPrompt
    ) async throws(ProductFlowError) -> AttentionCorrectionDraft {
        do {
            let store = try requiredStore()
            let snapshot = try await store.loadSnapshot()
            guard let attention = snapshot.attentionStates.first(where: { $0.area == prompt.area }),
                  attention.updatedAt == prompt.expectedAttentionUpdatedAt else {
                throw ProductFlowError.invalidState
            }
            let moment = try moment()
            let existing = snapshot.checkIns
                .filter {
                    $0.status == .draft &&
                        $0.kind == .attentionCorrection &&
                        $0.correctionSource?.area == prompt.area &&
                        $0.dayContext.localDay == moment.dayContext.localDay
                }
                .max { $0.startedAt < $1.startedAt }
            let checkInDraft: SingleAreaCheckInDraft
            if let existing {
                checkInDraft = SingleAreaCheckInDraft(
                    checkInID: existing.id,
                    entryID: CheckInEntryID(UUID()),
                    area: prompt.area,
                    startedAt: existing.startedAt,
                    dayContext: existing.dayContext
                )
            } else {
                checkInDraft = SingleAreaCheckInDraft(
                    checkInID: CheckInID(UUID()),
                    entryID: CheckInEntryID(UUID()),
                    area: prompt.area,
                    startedAt: moment.timestamp,
                    dayContext: moment.dayContext
                )
                let sourceEvent = snapshot.safetyEvents
                    .filter {
                        $0.area == prompt.area &&
                            $0.sourceCheckInEntryID != nil &&
                            $0.occurredAt <= attention.updatedAt
                    }
                    .max { $0.occurredAt < $1.occurredAt }
                let checkIn = try CheckIn(
                    id: checkInDraft.checkInID,
                    status: .draft,
                    kind: .attentionCorrection,
                    correctionSource: CorrectionSource(
                        area: prompt.area,
                        triggeringEntryID: sourceEvent?.sourceCheckInEntryID
                    ),
                    primaryArea: prompt.area,
                    secondaryArea: nil,
                    startedAt: checkInDraft.startedAt,
                    completedAt: nil,
                    dayContext: checkInDraft.dayContext,
                    entries: []
                )
                try await store.saveCheckInDraft(try SaveCheckInDraftCommand(checkIn: checkIn))
            }
            return AttentionCorrectionDraft(
                checkIn: checkInDraft,
                safetyEventID: SafetyEventID(UUID()),
                expectedAttentionUpdatedAt: attention.updatedAt
            )
        } catch {
            throw map(error)
        }
    }

    public func submitAttentionCorrection(
        _ draft: AttentionCorrectionDraft,
        change: ChangeReport,
        comfort: MovementComfort,
        safetyAnswer: ConditionalSafetyAnswer?
    ) async throws(ProductFlowError) -> AttentionResolution {
        do {
            let store = try requiredStore()
            let snapshot = try await store.loadSnapshot()
            if let existing = snapshot.safetyEvents.first(where: { $0.id == draft.safetyEventID }) {
                let expectedKind: SafetyEventKind = safetyAnswer == .yes || safetyAnswer == .notSure ?
                    .attentionReaffirmedCorrection : .attentionClearedCorrection
                guard let completed = snapshot.checkIns.first(where: { $0.id == draft.checkIn.checkInID }),
                      let entry = completed.entries.first(where: { $0.id == draft.checkIn.entryID }),
                      completed.status == .completed,
                      completed.kind == .attentionCorrection,
                      entry.area == draft.checkIn.area,
                      entry.changeReport == change,
                      entry.movementComfort == comfort,
                      entry.conditionalSafetyAnswer == safetyAnswer,
                      existing.area == draft.checkIn.area,
                      existing.sourceCheckInEntryID == entry.id,
                      existing.returnAnswer == nil,
                      existing.kind == expectedKind
                else { throw ProductFlowError.invalidState }
                return try attentionResolution(from: snapshot)
            }
            guard let attention = snapshot.attentionStates.first(where: { $0.area == draft.checkIn.area }),
                  attention.updatedAt == draft.expectedAttentionUpdatedAt,
                  let persisted = snapshot.checkIns.first(where: { $0.id == draft.checkIn.checkInID }),
                  persisted.status == .draft,
                  persisted.kind == .attentionCorrection,
                  persisted.correctionSource?.area == draft.checkIn.area,
                  persisted.primaryArea == draft.checkIn.area,
                  persisted.startedAt == draft.checkIn.startedAt,
                  persisted.dayContext == draft.checkIn.dayContext else {
                throw ProductFlowError.invalidState
            }
            let completedAt = try timestamp(after: max(attention.updatedAt, persisted.startedAt))
            let entry = try CheckInEntry(
                id: draft.checkIn.entryID,
                area: draft.checkIn.area,
                role: .primary,
                changeReport: change,
                movementComfort: comfort,
                conditionalSafetyAnswer: safetyAnswer,
                submittedAt: completedAt
            )
            let completed = try CheckIn(
                id: persisted.id,
                status: .completed,
                kind: .attentionCorrection,
                correctionSource: persisted.correctionSource,
                primaryArea: persisted.primaryArea,
                secondaryArea: nil,
                startedAt: persisted.startedAt,
                completedAt: completedAt,
                dayContext: persisted.dayContext,
                entries: [entry]
            )
            let event = try SafetyEvent(
                id: draft.safetyEventID,
                area: entry.area,
                kind: entry.triggersAttention ? .attentionReaffirmedCorrection : .attentionClearedCorrection,
                sourceCheckInEntryID: entry.id,
                occurredAt: completedAt,
                dayContext: persisted.dayContext
            )
            let mutation = try SafetyMutation(
                event: event,
                statusAfter: entry.triggersAttention ? .attentionRequired : .normal,
                expectedAttentionUpdatedAt: attention.updatedAt
            )
            try await store.completeCheckIn(
                try CompleteCheckInCommand(checkIn: completed, safetyMutations: [mutation])
            )
            return try attentionResolution(from: try await store.loadSnapshot())
        } catch {
            throw map(error)
        }
    }

    public func beginSingleAreaCheckIn() async throws(ProductFlowError) -> SingleAreaCheckInDraft {
        do {
            let store = try requiredStore()
            let snapshot = try await store.loadSnapshot()
            guard snapshot.attentionStates.isEmpty else {
                throw ProductFlowError.attentionRequired(orderedAreas(snapshot.attentionStates.map(\.area)))
            }
            guard let profile = snapshot.profileState?.profile,
                  profile.onboardingCompletedAt != nil,
                  let area = profile.primaryArea else {
                throw ProductFlowError.invalidState
            }
            let moment = try moment()
            if let existing = latestNormalDraft(in: snapshot) {
                if existing.primaryArea == area,
                   existing.dayContext == moment.dayContext {
                    return checkInDraft(from: existing)
                }
                try await abandon(existing, store: store)
            }
            let draft = SingleAreaCheckInDraft(
                checkInID: CheckInID(UUID()),
                entryID: CheckInEntryID(UUID()),
                area: area,
                startedAt: moment.timestamp,
                dayContext: moment.dayContext
            )
            let checkIn = try CheckIn(
                id: draft.checkInID,
                status: .draft,
                primaryArea: area,
                secondaryArea: nil,
                startedAt: draft.startedAt,
                completedAt: nil,
                dayContext: draft.dayContext,
                entries: []
            )
            try await store.saveCheckInDraft(try SaveCheckInDraftCommand(checkIn: checkIn))
            return draft
        } catch {
            throw map(error)
        }
    }

    public func submitSingleAreaCheckIn(
        _ draft: SingleAreaCheckInDraft,
        change: ChangeReport,
        comfort: MovementComfort,
        safetyAnswer: ConditionalSafetyAnswer?
    ) async throws(ProductFlowError) -> SingleAreaCheckInResult {
        do {
            let store = try requiredStore()
            let entry = try CheckInEntry(
                id: draft.entryID,
                area: draft.area,
                role: .primary,
                changeReport: change,
                movementComfort: comfort,
                conditionalSafetyAnswer: safetyAnswer,
                submittedAt: draft.startedAt
            )
            let completed = try CheckIn(
                id: draft.checkInID,
                status: .completed,
                primaryArea: draft.area,
                secondaryArea: nil,
                startedAt: draft.startedAt,
                completedAt: draft.startedAt,
                dayContext: draft.dayContext,
                entries: [entry]
            )
            let mutations: [SafetyMutation]
            if entry.triggersAttention {
                let event = try SafetyEvent(
                    id: SafetyEventID(UUID()),
                    area: draft.area,
                    kind: .attentionEntered,
                    sourceCheckInEntryID: entry.id,
                    occurredAt: draft.startedAt,
                    dayContext: draft.dayContext
                )
                mutations = [try SafetyMutation(event: event, statusAfter: .attentionRequired)]
            } else {
                mutations = []
            }
            try await store.completeCheckIn(
                try CompleteCheckInCommand(checkIn: completed, safetyMutations: mutations)
            )
            if entry.triggersAttention {
                let updated = try await store.loadSnapshot()
                guard let attention = updated.attentionStates.first(where: { $0.area == draft.area }) else {
                    throw ProductFlowError.invalidData
                }
                return .attentionRequired(attentionPrompt(for: attention))
            }
            return .plan(try await preparePlan(
                checkInID: draft.checkInID,
                duration: .standard,
                requestedLevel: nil
            ))
        } catch {
            throw map(error)
        }
    }

    public func revisePlan(
        checkInID: CheckInID,
        duration: DurationVariant,
        requestedLevel: RoutineLevel?
    ) async throws(ProductFlowError) -> PlanPresentation {
        do {
            return try await preparePlan(
                checkInID: checkInID,
                duration: duration,
                requestedLevel: requestedLevel
            )
        } catch {
            throw map(error)
        }
    }

    public func pauseToday(checkInID: CheckInID) async throws(ProductFlowError) -> BodyArea {
        do {
            let store = try requiredStore()
            let snapshot = try await store.loadSnapshot()
            let checkIn = try requiredCheckIn(checkInID, snapshot: snapshot)
            guard checkIn.status == .completed else { throw ProductFlowError.invalidState }
            if snapshot.pauseTodayEvents.contains(where: { $0.checkInID == checkInID }) {
                return checkIn.primaryArea
            }
            let chosenAt = try timestamp(notBefore: checkIn.completedAt ?? checkIn.startedAt)
            try await store.recordPauseToday(RecordPauseTodayCommand(event: PauseTodayEvent(
                id: PauseTodayEventID(UUID()),
                checkInID: checkInID,
                chosenAt: chosenAt,
                dayContext: checkIn.dayContext
            )))
            return checkIn.primaryArea
        } catch {
            throw map(error)
        }
    }

    public func startRoutine(
        decisionID: SelectionDecisionID
    ) async throws(ProductFlowError) -> RoutinePresentation {
        do {
            let store = try requiredStore()
            var snapshot = try await store.loadSnapshot()
            guard let decision = snapshot.decisions.first(where: { $0.id == decisionID }),
                  decision.outcome == .selected else {
                throw ProductFlowError.invalidState
            }
            if let existing = snapshot.routineSessions.first(where: { $0.decisionID == decisionID }) {
                if existing.status == .abandoned { throw ProductFlowError.contentUnavailable }
                if existing.status.isTerminal { throw ProductFlowError.invalidState }
                return try await startPreparedSessionIfNeeded(existing, snapshot: snapshot, store: store)
            }

            let installed = try await catalogProvider.load()
            let composition = try composition(for: decision, installed: installed)
            guard composition.fingerprint == decision.compositionFingerprint else {
                throw ProductFlowError.invalidData
            }
            let checkIn = try requiredCheckIn(decision.checkInID, snapshot: snapshot)
            let sessionID = RoutineSessionID(UUID())
            let frozen = try RoutineSessionSnapshotBuilder.make(
                sessionID: sessionID,
                decisionID: decision.id,
                composition: composition,
                catalog: installed.catalog,
                resources: installed.resources,
                rulesVersion: decision.rulesVersion,
                notices: try decision.notices.map { try NonEmptyString(validating: $0.code.rawValue) },
                explanationKeys: decision.reasons.map(\.code),
                explanationParameters: try decision.reasons.map { try decodeParameters($0.parameters) },
                createdAt: try moment().timestamp
            )
            let moment = try moment()
            let session = try RoutineSession(
                id: sessionID,
                decisionID: decision.id,
                checkInID: decision.checkInID,
                status: .prepared,
                snapshot: try frozen.opaqueRepresentation(),
                currentStepIndex: PrototypeProductConfiguration.firstStepIndex,
                stepElapsedMilliseconds: PrototypeProductConfiguration.noElapsedMilliseconds,
                startedAt: nil,
                updatedAt: moment.timestamp,
                endedAt: nil,
                dayContext: checkIn.dayContext
            )
            try await store.createRoutine(try CreateRoutineCommand(session: session))
            snapshot = try await store.loadSnapshot()
            let persisted = try requiredSession(sessionID, snapshot: snapshot)
            return try await startPreparedSessionIfNeeded(persisted, snapshot: snapshot, store: store)
        } catch {
            throw map(error)
        }
    }

    public func refreshRoutine(
        sessionID: RoutineSessionID
    ) async throws(ProductFlowError) -> RoutinePresentation {
        do {
            let snapshot = try await requiredStore().loadSnapshot()
            let session = try requiredSession(sessionID, snapshot: snapshot)
            let frozen = try decodeSnapshot(session.snapshot)
            return try presentation(
                session: session,
                frozen: frozen,
                snapshot: snapshot,
                elapsedOverride: try await elapsedMilliseconds(for: session)
            )
        } catch {
            throw map(error)
        }
    }

    public func pauseRoutine(
        sessionID: RoutineSessionID
    ) async throws(ProductFlowError) -> RoutinePresentation {
        do {
            let store = try requiredStore()
            let snapshot = try await store.loadSnapshot()
            let session = try requiredSession(sessionID, snapshot: snapshot)
            let frozen = try decodeSnapshot(session.snapshot)
            if session.status == .paused || session.status.isTerminal {
                activeStepStartedAt.removeValue(forKey: session.id)
                return try presentation(session: session, frozen: frozen, snapshot: snapshot)
            }
            guard session.status == .inProgress else { throw ProductFlowError.invalidState }
            let elapsed = try await elapsedMilliseconds(for: session)
            let updated = try await recordRoutineEvent(
                session: session,
                snapshot: snapshot,
                kind: .paused,
                checkpoint: try RoutineCheckpoint(
                    status: .paused,
                    currentStepIndex: session.currentStepIndex,
                    stepElapsedMilliseconds: elapsed,
                    updatedAt: try timestamp(notBefore: session.updatedAt),
                    endedAt: nil
                ),
                store: store
            )
            activeStepStartedAt.removeValue(forKey: session.id)
            let updatedSnapshot = try await store.loadSnapshot()
            return try presentation(session: updated, frozen: frozen, snapshot: updatedSnapshot)
        } catch {
            throw map(error)
        }
    }

    public func resumeRoutine(
        sessionID: RoutineSessionID
    ) async throws(ProductFlowError) -> RoutinePresentation {
        do {
            let store = try requiredStore()
            let snapshot = try await store.loadSnapshot()
            let session = try requiredSession(sessionID, snapshot: snapshot)
            let frozen = try decodeSnapshot(session.snapshot)
            if session.status == .inProgress {
                return try presentation(
                    session: session,
                    frozen: frozen,
                    snapshot: snapshot,
                    elapsedOverride: try await elapsedMilliseconds(for: session)
                )
            }
            guard session.status == .paused,
                  frozen.items.indices.contains(session.currentStepIndex) else {
                throw ProductFlowError.invalidState
            }
            try await validateInstalledContent(for: frozen)
            let monotonicStart = try await monotonicMilliseconds()
            let updatedAt = try timestamp(notBefore: session.updatedAt)
            let updated = try await recordRoutineEvent(
                session: session,
                snapshot: snapshot,
                kind: .resumed,
                checkpoint: try RoutineCheckpoint(
                    status: .inProgress,
                    currentStepIndex: session.currentStepIndex,
                    stepElapsedMilliseconds: session.stepElapsedMilliseconds,
                    updatedAt: updatedAt,
                    endedAt: nil
                ),
                store: store
            )
            activeStepStartedAt[session.id] = monotonicStart
            let updatedSnapshot = try await store.loadSnapshot()
            return try presentation(session: updated, frozen: frozen, snapshot: updatedSnapshot)
        } catch {
            throw map(error)
        }
    }

    public func skipRoutineStep(
        sessionID: RoutineSessionID,
        expectedStepIndex: Int,
        reason: RoutineEventReason?
    ) async throws(ProductFlowError) -> RoutinePresentation {
        do {
            let store = try requiredStore()
            var snapshot = try await store.loadSnapshot()
            var session = try requiredSession(sessionID, snapshot: snapshot)
            let frozen = try decodeSnapshot(session.snapshot)
            if session.status.isTerminal || session.currentStepIndex > expectedStepIndex {
                return try presentation(session: session, frozen: frozen, snapshot: snapshot)
            }
            guard session.status == .inProgress,
                  session.currentStepIndex == expectedStepIndex,
                  frozen.items.indices.contains(expectedStepIndex) else {
                throw ProductFlowError.invalidState
            }
            let item = frozen.items[expectedStepIndex]
            let nextIndex = expectedStepIndex + PrototypeProductConfiguration.stepIncrement
            let isLast = nextIndex == frozen.items.endIndex
            let nextMonotonicStart = isLast ? nil : try await monotonicMilliseconds()
            let updatedAt = try timestamp(notBefore: session.updatedAt)
            session = try await recordRoutineEvent(
                session: session,
                snapshot: snapshot,
                kind: .skipped,
                stepID: try NonEmptyString(validating: item.itemID.rawValue),
                moduleID: try NonEmptyString(validating: item.sourceOwnerID.rawValue),
                localReason: reason,
                checkpoint: try RoutineCheckpoint(
                    status: .inProgress,
                    currentStepIndex: nextIndex,
                    stepElapsedMilliseconds: PrototypeProductConfiguration.noElapsedMilliseconds,
                    updatedAt: updatedAt,
                    endedAt: nil
                ),
                store: store
            )
            activeStepStartedAt.removeValue(forKey: session.id)
            snapshot = try await store.loadSnapshot()
            if isLast {
                session = try await completeRoutineAfterLastSkipped(
                    session,
                    snapshot: snapshot,
                    store: store
                )
                snapshot = try await store.loadSnapshot()
            } else if let nextMonotonicStart {
                activeStepStartedAt[session.id] = nextMonotonicStart
            }
            return try presentation(session: session, frozen: frozen, snapshot: snapshot)
        } catch {
            throw map(error)
        }
    }

    public func selectRoutineAlternative(
        sessionID: RoutineSessionID,
        expectedStepIndex: Int,
        movementID: CatalogID
    ) async throws(ProductFlowError) -> RoutinePresentation {
        do {
            let store = try requiredStore()
            var snapshot = try await store.loadSnapshot()
            var session = try requiredSession(sessionID, snapshot: snapshot)
            let frozen = try decodeSnapshot(session.snapshot)
            guard session.currentStepIndex == expectedStepIndex,
                  frozen.items.indices.contains(expectedStepIndex) else {
                throw ProductFlowError.invalidState
            }
            let item = frozen.items[expectedStepIndex]
            _ = try frozen.alternative(movementID, forItem: item.itemID)
            if try selectedAlternativeID(
                for: item,
                sessionID: session.id,
                in: snapshot
            ) == movementID {
                return try presentation(session: session, frozen: frozen, snapshot: snapshot)
            }
            if session.status == .inProgress {
                _ = try await pauseRoutine(sessionID: session.id)
                snapshot = try await store.loadSnapshot()
                session = try requiredSession(session.id, snapshot: snapshot)
            }
            guard session.status == .paused else { throw ProductFlowError.invalidState }
            let updatedAt = try timestamp(notBefore: session.updatedAt)
            session = try await recordRoutineEvent(
                session: session,
                snapshot: snapshot,
                kind: .alternativeSelected,
                stepID: try NonEmptyString(validating: item.itemID.rawValue),
                moduleID: try NonEmptyString(validating: item.sourceOwnerID.rawValue),
                alternativeID: try NonEmptyString(validating: movementID.rawValue),
                checkpoint: try RoutineCheckpoint(
                    status: .paused,
                    currentStepIndex: session.currentStepIndex,
                    stepElapsedMilliseconds: session.stepElapsedMilliseconds,
                    updatedAt: updatedAt,
                    endedAt: nil
                ),
                store: store
            )
            snapshot = try await store.loadSnapshot()
            return try presentation(session: session, frozen: frozen, snapshot: snapshot)
        } catch {
            throw map(error)
        }
    }

    public func endRoutine(
        sessionID: RoutineSessionID,
        forSafety: Bool
    ) async throws(ProductFlowError) -> RoutinePresentation {
        do {
            let store = try requiredStore()
            var snapshot = try await store.loadSnapshot()
            var session = try requiredSession(sessionID, snapshot: snapshot)
            let frozen = try decodeSnapshot(session.snapshot)
            if session.status.isTerminal {
                return try presentation(session: session, frozen: frozen, snapshot: snapshot)
            }
            if session.status == .inProgress {
                _ = try await pauseRoutine(sessionID: session.id)
                snapshot = try await store.loadSnapshot()
                session = try requiredSession(session.id, snapshot: snapshot)
            }
            guard session.status == .paused else { throw ProductFlowError.invalidState }
            let endedAt = try timestamp(notBefore: session.updatedAt)
            session = try await recordRoutineEvent(
                session: session,
                snapshot: snapshot,
                kind: forSafety ? .safetyStopped : .stopped,
                checkpoint: try RoutineCheckpoint(
                    status: forSafety ? .safetyStopped : .stopped,
                    currentStepIndex: session.currentStepIndex,
                    stepElapsedMilliseconds: session.stepElapsedMilliseconds,
                    updatedAt: endedAt,
                    endedAt: endedAt
                ),
                store: store
            )
            activeStepStartedAt.removeValue(forKey: session.id)
            snapshot = try await store.loadSnapshot()
            return try presentation(session: session, frozen: frozen, snapshot: snapshot)
        } catch {
            throw map(error)
        }
    }

    public func advanceRoutine(
        sessionID: RoutineSessionID,
        expectedStepIndex: Int
    ) async throws(ProductFlowError) -> RoutinePresentation {
        do {
            let store = try requiredStore()
            let snapshot = try await store.loadSnapshot()
            let session = try requiredSession(sessionID, snapshot: snapshot)
            let frozen = try decodeSnapshot(session.snapshot)
            if session.status.isTerminal || session.currentStepIndex > expectedStepIndex {
                return try presentation(session: session, frozen: frozen, snapshot: snapshot)
            }
            guard session.status == .inProgress,
                  session.currentStepIndex == expectedStepIndex,
                  frozen.items.indices.contains(expectedStepIndex) else {
                throw ProductFlowError.invalidState
            }
            let isLast = expectedStepIndex == frozen.items.index(before: frozen.items.endIndex)
            let currentItem = frozen.items[expectedStepIndex]
            let eventKind: RoutineEventKind = isLast ? .completed : .stepCompleted
            let nextIndex = expectedStepIndex + PrototypeProductConfiguration.stepIncrement
            let nextMonotonicStart = isLast ? nil : try await monotonicMilliseconds()
            let updatedAt = try timestamp(notBefore: session.updatedAt)
            let updated = try await recordRoutineEvent(
                session: session,
                snapshot: snapshot,
                kind: eventKind,
                stepID: isLast ? nil : try NonEmptyString(validating: currentItem.itemID.rawValue),
                moduleID: isLast ? nil : try NonEmptyString(validating: currentItem.sourceOwnerID.rawValue),
                checkpoint: try RoutineCheckpoint(
                    status: isLast ? .completed : .inProgress,
                    currentStepIndex: nextIndex,
                    stepElapsedMilliseconds: PrototypeProductConfiguration.noElapsedMilliseconds,
                    updatedAt: updatedAt,
                    endedAt: isLast ? updatedAt : nil
                ),
                store: store
            )
            activeStepStartedAt.removeValue(forKey: session.id)
            if let nextMonotonicStart {
                activeStepStartedAt[session.id] = nextMonotonicStart
            }
            let updatedSnapshot = try await store.loadSnapshot()
            return try presentation(session: updated, frozen: frozen, snapshot: updatedSnapshot)
        } catch {
            throw map(error)
        }
    }

    public func submitFeedback(
        sessionID: RoutineSessionID,
        response: AreaResponse?
    ) async throws(ProductFlowError) {
        do {
            let store = try requiredStore()
            let snapshot = try await store.loadSnapshot()
            if snapshot.feedbackSubmissions.contains(where: { $0.routineSessionID == sessionID }) {
                return
            }
            let session = try requiredSession(sessionID, snapshot: snapshot)
            guard session.status.acceptsFeedback,
                  let endedAt = session.endedAt else {
                throw ProductFlowError.invalidState
            }
            let frozen = try decodeSnapshot(session.snapshot)
            guard let area = frozen.includedAreas.first else { throw ProductFlowError.invalidData }
            let responses = response.map {
                [FeedbackResponse(id: AreaFeedbackID(UUID()), area: area, response: $0)]
            } ?? []
            let submittedAt = try timestamp(notBefore: endedAt)
            let submission = try FeedbackSubmission(
                id: FeedbackSubmissionID(UUID()),
                routineSessionID: session.id,
                responses: responses,
                submittedAt: submittedAt,
                dayContext: session.dayContext
            )
            try await store.submitFeedback(SubmitFeedbackCommand(submission: submission))
        } catch {
            throw map(error)
        }
    }
}

private extension PrototypeProductService {
    func preparePlan(
        checkInID: CheckInID,
        duration: DurationVariant,
        requestedLevel: RoutineLevel?
    ) async throws -> PlanPresentation {
        let store = try requiredStore()
        let snapshot = try await store.loadSnapshot()
        guard snapshot.attentionStates.isEmpty else {
            throw ProductFlowError.attentionRequired(orderedAreas(snapshot.attentionStates.map(\.area)))
        }
        let checkIn = try requiredCheckIn(checkInID, snapshot: snapshot)
        guard checkIn.status == .completed,
              let entry = checkIn.entries.first(where: { $0.area == checkIn.primaryArea }) else {
            throw ProductFlowError.invalidState
        }
        let latestDecision = snapshot.decisions
            .filter { $0.checkInID == checkInID }
            .max { $0.revision < $1.revision }
        let existing = latestDecision.flatMap { decision in
            decision.durationVariant == duration && decision.requestedOverride == requestedLevel ?
                decision : nil
        }
        let decisionID = existing?.id ?? SelectionDecisionID(UUID())
        let revision = existing?.revision ?? nextDecisionRevision(for: checkInID, in: snapshot)
        let installed = try await catalogProvider.load()
        let catalogVersion = try NonEmptyString(validating: installed.catalog.catalogVersion.rawValue)
        let history = try historyState(for: checkIn.primaryArea, snapshot: snapshot)
        let request = PlanSelectionRequest(
            decisionID: decisionID,
            checkInID: checkInID,
            decisionRevision: revision,
            primaryArea: checkIn.primaryArea,
            secondaryArea: nil,
            secondaryParticipation: nil,
            checkInsByArea: [
                checkIn.primaryArea: SelectionAreaCheckIn(
                    checkInEntryID: entry.id,
                    entryRevision: PrototypeProductConfiguration.firstEntryRevision,
                    area: entry.area,
                    changeReport: entry.changeReport,
                    movementComfort: entry.movementComfort,
                    conditionalSafetyAnswer: entry.conditionalSafetyAnswer
                )
            ],
            safetyByArea: safetySnapshots(snapshot.attentionStates),
            historyByArea: [checkIn.primaryArea: history],
            requestedOverride: requestedLevel,
            duration: duration,
            rulesVersion: PrototypeSelectionRules.version,
            catalogVersion: catalogVersion
        )
        guard case .selected(let selected) = PlanSelectionEngine.prototype.select(request) else {
            throw ProductFlowError.invalidState
        }
        let compositionRequest = try CatalogCompositionRequest(
            decisionID: decisionID,
            primaryArea: selected.compositionRequest.primaryArea,
            secondaryArea: selected.compositionRequest.secondaryArea,
            selectedLevel: selected.selectedLevel,
            duration: duration,
            catalogVersion: installed.catalog.catalogVersion,
            buildChannel: .internalPrototype
        )
        guard case .composed(let composition) = RoutineComposer.compose(
            request: compositionRequest,
            catalog: installed.catalog,
            resources: installed.resources
        ) else {
            throw ProductFlowError.contentUnavailable
        }
        if let existing {
            guard existing.compositionFingerprint == composition.fingerprint else {
                throw ProductFlowError.invalidData
            }
        } else {
            let decision = try makeDecision(
                request: request,
                selected: selected,
                composition: composition,
                history: history,
                createdAt: try moment().timestamp
            )
            try await store.appendDecision(AppendDecisionCommand(decision: decision))
        }
        return PlanPresentation(
            decisionID: decisionID,
            checkInID: checkInID,
            area: checkIn.primaryArea,
            recommendedLevel: selected.recommendedLevel,
            selectedLevel: selected.selectedLevel,
            deliveredLevel: composition.deliveredLevel,
            duration: duration,
            explanationKeys: selected.explanations.map(\.key),
            itemCount: composition.orderedItems.count,
            nominalSeconds: composition.nominalSeconds,
            pauseTodayAvailable: selected.pauseTodayAvailable
        )
    }

    func makeDecision(
        request: PlanSelectionRequest,
        selected: SelectedPlan,
        composition: ComposedRoutine,
        history: ActiveHistoryState,
        createdAt: TimestampMilliseconds
    ) throws -> SelectionDecision {
        let areaInputs = try selected.includedAreaDecisions.map { area in
            try DecisionAreaInput(
                area: area.area,
                role: area.role,
                checkInEntryID: area.checkInEntryID,
                baseLevel: area.baseLevel,
                activeUnlocked: area.activeUnlocked,
                qualifyingCount: history.qualifyingOutcomeCount,
                latestResponse: history.mostRecentRecordedResponse,
                included: true
            )
        }
        let reasons = try selected.explanations.enumerated().map { position, explanation in
            try DecisionReason(
                kind: .selection,
                position: position,
                code: NonEmptyString(validating: explanation.key.rawValue),
                parameters: try canonicalJSON(explanation.parameters)
            )
        }
        let notices = try selected.notices.enumerated().map { position, notice in
            try DecisionNotice(
                position: position,
                code: NonEmptyString(validating: notice.key.rawValue),
                area: notice.area,
                parameters: try canonicalJSON([:])
            )
        }
        return try SelectionDecision(
            id: request.decisionID,
            checkInID: request.checkInID,
            revision: request.decisionRevision,
            rulesVersion: NonEmptyString(validating: request.rulesVersion),
            catalogVersionRequested: request.catalogVersion,
            catalogVersionDelivered: NonEmptyString(rawValue: composition.catalogVersion.rawValue),
            outcome: .selected,
            recommendedLevel: selected.recommendedLevel,
            requestedOverride: selected.requestedOverride,
            overrideDisposition: selected.overrideDisposition,
            selectedLevel: selected.selectedLevel,
            deliveredLevel: composition.deliveredLevel,
            durationVariant: selected.duration,
            secondaryOmissionReason: composition.omissionReason,
            validationResult: composition.status == .exact ? .exact : .fallback,
            primaryTemplateID: NonEmptyString(rawValue: composition.primaryTemplate.id.rawValue),
            primaryTemplateRevision: composition.primaryTemplate.revision.rawValue,
            secondaryModuleID: composition.secondaryModule.flatMap {
                NonEmptyString(rawValue: $0.id.rawValue)
            },
            secondaryModuleRevision: composition.secondaryModule?.revision.rawValue,
            compatibilityRuleID: composition.compatibilityRule.flatMap {
                NonEmptyString(rawValue: $0.id.rawValue)
            },
            compositionFingerprint: composition.fingerprint,
            createdAt: createdAt,
            areaInputs: areaInputs,
            reasons: reasons,
            notices: notices
        )
    }

    func composition(
        for decision: SelectionDecision,
        installed: InstalledPrototypeCatalog
    ) throws -> ComposedRoutine {
        guard let primary = decision.areaInputs.first(where: { $0.role == .primary }) else {
            throw ProductFlowError.invalidData
        }
        let request = try CatalogCompositionRequest(
            decisionID: decision.id,
            primaryArea: primary.area,
            secondaryArea: decision.areaInputs.first(where: { $0.role == .secondary && $0.included })?.area,
            selectedLevel: decision.selectedLevel,
            duration: decision.durationVariant,
            catalogVersion: installed.catalog.catalogVersion,
            buildChannel: .internalPrototype
        )
        guard case .composed(let routine) = RoutineComposer.compose(
            request: request,
            catalog: installed.catalog,
            resources: installed.resources
        ) else {
            throw ProductFlowError.contentUnavailable
        }
        return routine
    }

    func startPreparedSessionIfNeeded(
        _ session: RoutineSession,
        snapshot: KineoDataSnapshot,
        store: KineoGRDBStore
    ) async throws -> RoutinePresentation {
        let frozen = try decodeSnapshot(session.snapshot)
        do {
            try await validateInstalledContent(for: frozen)
        } catch ProductFlowError.contentUnavailable {
            if session.status == .prepared {
                _ = try await abandonPreparedSession(session, snapshot: snapshot, store: store)
            }
            throw ProductFlowError.contentUnavailable
        }
        guard session.status == .prepared else {
            return try presentation(session: session, frozen: frozen, snapshot: snapshot)
        }
        let monotonicStart = try await monotonicMilliseconds()
        let updatedAt = try timestamp(notBefore: session.updatedAt)
        let updated = try await recordRoutineEvent(
            session: session,
            snapshot: snapshot,
            kind: .started,
            checkpoint: try RoutineCheckpoint(
                status: .inProgress,
                currentStepIndex: session.currentStepIndex,
                stepElapsedMilliseconds: session.stepElapsedMilliseconds,
                updatedAt: updatedAt,
                endedAt: nil
            ),
            store: store
        )
        activeStepStartedAt[session.id] = monotonicStart
        let updatedSnapshot = try await store.loadSnapshot()
        return try presentation(session: updated, frozen: frozen, snapshot: updatedSnapshot)
    }

    func presentation(
        session: RoutineSession,
        frozen: RoutineSessionSnapshot,
        snapshot: KineoDataSnapshot,
        elapsedOverride: Int64? = nil,
        contentAvailable: Bool = true
    ) throws -> RoutinePresentation {
        guard let area = frozen.includedAreas.first else { throw ProductFlowError.invalidData }
        let item = frozen.items.indices.contains(session.currentStepIndex) ?
            frozen.items[session.currentStepIndex] : nil
        let selectedAlternative: PresentedAlternative?
        if let item,
           let movementID = try selectedAlternativeID(
               for: item,
               sessionID: session.id,
               in: snapshot
           ) {
            selectedAlternative = try frozen.alternative(movementID, forItem: item.itemID)
        } else {
            selectedAlternative = nil
        }
        return RoutinePresentation(
            sessionID: session.id,
            area: area,
            selectedLevel: frozen.selectedLevel,
            deliveredLevel: frozen.deliveredLevel,
            duration: frozen.duration,
            status: session.status,
            currentStepIndex: session.currentStepIndex,
            totalStepCount: frozen.items.count,
            currentItem: item,
            selectedAlternative: selectedAlternative,
            stepElapsedMilliseconds: elapsedOverride ?? session.stepElapsedMilliseconds,
            contentAvailable: contentAvailable
        )
    }

    func restoreUnfinishedRoutine(
        _ session: RoutineSession,
        snapshot: KineoDataSnapshot
    ) async throws -> RoutinePresentation {
        let store = try requiredStore()
        switch session.status {
        case .prepared:
            let started = try await startPreparedSessionIfNeeded(session, snapshot: snapshot, store: store)
            return try await pauseRoutine(sessionID: started.sessionID)
        case .inProgress:
            activeStepStartedAt.removeValue(forKey: session.id)
            _ = try await pauseRoutine(sessionID: session.id)
            let pausedSnapshot = try await store.loadSnapshot()
            let paused = try requiredSession(session.id, snapshot: pausedSnapshot)
            return try await restoredPausedPresentation(paused, snapshot: pausedSnapshot)
        case .paused:
            return try await restoredPausedPresentation(session, snapshot: snapshot)
        case .completed, .stopped, .safetyStopped, .abandoned:
            throw ProductFlowError.invalidState
        }
    }

    func restoredPausedPresentation(
        _ session: RoutineSession,
        snapshot: KineoDataSnapshot
    ) async throws -> RoutinePresentation {
        let frozen = try decodeSnapshot(session.snapshot)
        do {
            try await validateInstalledContent(for: frozen)
            return try presentation(session: session, frozen: frozen, snapshot: snapshot)
        } catch ProductFlowError.contentUnavailable {
            return try presentation(
                session: session,
                frozen: frozen,
                snapshot: snapshot,
                contentAvailable: false
            )
        }
    }

    func abandonPreparedSession(
        _ session: RoutineSession,
        snapshot: KineoDataSnapshot,
        store: KineoGRDBStore
    ) async throws -> RoutineSession {
        let endedAt = try timestamp(notBefore: session.updatedAt)
        return try await recordRoutineEvent(
            session: session,
            snapshot: snapshot,
            kind: .abandoned,
            checkpoint: try RoutineCheckpoint(
                status: .abandoned,
                currentStepIndex: session.currentStepIndex,
                stepElapsedMilliseconds: session.stepElapsedMilliseconds,
                updatedAt: endedAt,
                endedAt: endedAt
            ),
            store: store
        )
    }

    func validateInstalledContent(
        for frozen: RoutineSessionSnapshot
    ) async throws {
        let installed: InstalledPrototypeCatalog
        do {
            installed = try await catalogProvider.load()
        } catch {
            throw ProductFlowError.contentUnavailable
        }
        guard installed.catalog.catalogVersion == frozen.catalogVersion else {
            throw ProductFlowError.contentUnavailable
        }
        var mediaByID = [String: MediaReference]()
        for media in installed.catalog.movements.compactMap(\.media) {
            if let existing = mediaByID[media.assetID.rawValue], existing != media {
                throw ProductFlowError.contentUnavailable
            }
            mediaByID[media.assetID.rawValue] = media
        }
        let referencedAssetIDs = frozen.items.flatMap { item in
            [item.mediaAssetID] + item.availableAlternatives.map(\.mediaAssetID)
        }.compactMap { $0?.rawValue }
        for assetID in referencedAssetIDs {
            guard let media = mediaByID[assetID],
                  installed.resources.assetDigestsByPath[media.localBundlePath.rawValue] == media.sha256 else {
                throw ProductFlowError.contentUnavailable
            }
        }
    }

    func recordRoutineEvent(
        session: RoutineSession,
        snapshot: KineoDataSnapshot,
        kind: RoutineEventKind,
        stepID: NonEmptyString? = nil,
        moduleID: NonEmptyString? = nil,
        alternativeID: NonEmptyString? = nil,
        localReason: RoutineEventReason? = nil,
        checkpoint: RoutineCheckpoint,
        store: KineoGRDBStore
    ) async throws -> RoutineSession {
        let event = try RoutineEvent(
            id: RoutineEventID(UUID()),
            routineSessionID: session.id,
            sequenceNumber: nextSequenceNumber(for: session.id, in: snapshot),
            kind: kind,
            stepID: stepID,
            moduleID: moduleID,
            alternativeID: alternativeID,
            localReason: localReason,
            occurredAt: checkpoint.updatedAt
        )
        try await store.recordRoutineEvent(
            try RecordRoutineEventCommand(event: event, checkpoint: checkpoint)
        )
        return try requiredSession(session.id, snapshot: try await store.loadSnapshot())
    }

    func completeRoutineAfterLastSkipped(
        _ session: RoutineSession,
        snapshot: KineoDataSnapshot,
        store: KineoGRDBStore
    ) async throws -> RoutineSession {
        guard session.status == .inProgress else { throw ProductFlowError.invalidState }
        let endedAt = try timestamp(notBefore: session.updatedAt)
        return try await recordRoutineEvent(
            session: session,
            snapshot: snapshot,
            kind: .completed,
            checkpoint: try RoutineCheckpoint(
                status: .completed,
                currentStepIndex: session.currentStepIndex,
                stepElapsedMilliseconds: session.stepElapsedMilliseconds,
                updatedAt: endedAt,
                endedAt: endedAt
            ),
            store: store
        )
    }

    func elapsedMilliseconds(for session: RoutineSession) async throws -> Int64 {
        guard session.status == .inProgress,
              let startedAt = activeStepStartedAt[session.id] else {
            return session.stepElapsedMilliseconds
        }
        let current = try await monotonicMilliseconds()
        guard current >= startedAt else { throw ProductFlowError.invalidData }
        let (elapsedSinceStart, deltaOverflow) = current.subtractingReportingOverflow(startedAt)
        let (total, totalOverflow) = session.stepElapsedMilliseconds.addingReportingOverflow(elapsedSinceStart)
        guard !deltaOverflow, !totalOverflow else { throw ProductFlowError.invalidData }
        return total
    }

    func monotonicMilliseconds() async throws -> Int64 {
        guard let value = await monotonicClock.nowMilliseconds(), value >= Int64.zero else {
            throw ProductFlowError.invalidData
        }
        return value
    }

    func selectedAlternativeID(
        for item: PresentedRoutineItem,
        sessionID: RoutineSessionID,
        in snapshot: KineoDataSnapshot
    ) throws -> CatalogID? {
        let selectedEvent = snapshot.routineEvents
            .filter {
                $0.routineSessionID == sessionID &&
                    $0.kind == .alternativeSelected &&
                    $0.stepID?.rawValue == item.itemID.rawValue
            }
            .max(by: { $0.sequenceNumber < $1.sequenceNumber })
        guard let rawValue = selectedEvent?.alternativeID?.rawValue else {
            return nil
        }
        guard let value = CatalogID(rawValue: rawValue) else { throw ProductFlowError.invalidData }
        return value
    }

    func decodeSnapshot(_ opaque: OpaqueRoutineSnapshot) throws -> RoutineSessionSnapshot {
        let decoded = try JSONDecoder().decode(RoutineSessionSnapshot.self, from: opaque.bytes)
        let exact = try decoded.opaqueRepresentation()
        guard exact.checksum == opaque.checksum else { throw ProductFlowError.invalidData }
        return decoded
    }

    func updateProfile(
        _ transform: (UserProfile, ProductMoment) throws -> UserProfile
    ) async throws {
        let store = try requiredStore()
        let snapshot = try await store.loadSnapshot()
        guard let state = snapshot.profileState else { throw ProductFlowError.invalidState }
        let profile = try transform(state.profile, try moment())
        try await store.saveProfile(SaveProfileCommand(
            state: ProfileState(profile: profile, reminderSettings: state.reminderSettings)
        ))
    }

    func historyState(
        for area: BodyArea,
        snapshot: KineoDataSnapshot
    ) throws -> ActiveHistoryState {
        var state = try ActiveHistoryState(
            area: area,
            qualifyingOutcomeCount: PrototypeProductConfiguration.emptyHistoryCount,
            mostRecentRecordedResponse: nil
        )
        let sessions = snapshot.routineSessions
            .filter { $0.status.isTerminal && $0.snapshot.includedAreas.contains(area) }
            .sorted { ($0.endedAt ?? $0.updatedAt) < ($1.endedAt ?? $1.updatedAt) }
        for session in sessions {
            guard let decision = snapshot.decisions.first(where: { $0.id == session.decisionID }),
                  let deliveredLevel = decision.deliveredLevel else { throw ProductFlowError.invalidData }
            let response = snapshot.feedbackSubmissions
                .first(where: { $0.routineSessionID == session.id })?
                .responses.first(where: { $0.area == area })?.response
            state = try ActiveHistoryReducer(configuration: .prototype).reducing(
                state,
                with: RoutineAreaOutcome(
                    area: area,
                    routineStatus: session.status,
                    deliveredLevel: deliveredLevel,
                    response: response,
                    wasIncludedInDeliveredRoutine: true
                )
            )
        }
        return state
    }

    func safetySnapshots(
        _ attention: [AttentionState]
    ) -> [BodyArea: SelectionSafetySnapshot] {
        let flagged = Set(attention.map(\.area))
        return Dictionary(uniqueKeysWithValues: PrototypeSelectionRules.supportedAreas.map { area in
            (area, SelectionSafetySnapshot(
                area: area,
                status: flagged.contains(area) ? .attentionRequired : .normal
            ))
        })
    }

    func firstAttention(in snapshot: KineoDataSnapshot) -> AttentionState? {
        let byArea = Dictionary(uniqueKeysWithValues: snapshot.attentionStates.map { ($0.area, $0) })
        return PrototypeSelectionRules.supportedAreas.compactMap { byArea[$0] }.first
    }

    func attentionPrompt(for attention: AttentionState) -> AttentionPrompt {
        AttentionPrompt(
            area: attention.area,
            responseEventID: SafetyEventID(UUID()),
            expectedAttentionUpdatedAt: attention.updatedAt
        )
    }

    func attentionResolution(from snapshot: KineoDataSnapshot) throws -> AttentionResolution {
        if let attention = firstAttention(in: snapshot) {
            return .attentionRequired(attentionPrompt(for: attention))
        }
        guard let area = snapshot.profileState?.profile.primaryArea else {
            throw ProductFlowError.invalidState
        }
        return .ready(area)
    }

    func requiredStore() throws -> KineoGRDBStore {
        guard let store else { throw ProductFlowError.foundationNotReady }
        return store
    }

    func requiredCheckIn(
        _ id: CheckInID,
        snapshot: KineoDataSnapshot
    ) throws -> CheckIn {
        guard let value = snapshot.checkIns.first(where: { $0.id == id }) else {
            throw ProductFlowError.invalidState
        }
        return value
    }

    func requiredSession(
        _ id: RoutineSessionID,
        snapshot: KineoDataSnapshot
    ) throws -> RoutineSession {
        guard let value = snapshot.routineSessions.first(where: { $0.id == id }) else {
            throw ProductFlowError.invalidState
        }
        return value
    }

    func nextDecisionRevision(for checkInID: CheckInID, in snapshot: KineoDataSnapshot) -> Int {
        (snapshot.decisions.filter { $0.checkInID == checkInID }.map(\.revision).max() ??
            PrototypeProductConfiguration.beforeFirstRevision) + PrototypeProductConfiguration.revisionIncrement
    }

    func nextSequenceNumber(for sessionID: RoutineSessionID, in snapshot: KineoDataSnapshot) -> Int {
        (snapshot.routineEvents.filter { $0.routineSessionID == sessionID }.map(\.sequenceNumber).max() ??
            PrototypeProductConfiguration.beforeFirstSequence) + PrototypeProductConfiguration.sequenceIncrement
    }

    func timestamp(notBefore minimum: TimestampMilliseconds) throws -> TimestampMilliseconds {
        max(try moment().timestamp, minimum)
    }

    func timestamp(after minimum: TimestampMilliseconds) throws -> TimestampMilliseconds {
        try moment(after: minimum).timestamp
    }

    func moment(after minimum: TimestampMilliseconds) throws -> ProductMoment {
        let current = try moment()
        let (nextRawValue, overflow) = minimum.rawValue.addingReportingOverflow(
            PrototypeProductConfiguration.timestampIncrement
        )
        guard !overflow else { throw ProductFlowError.invalidData }
        return ProductMoment(
            timestamp: max(current.timestamp, TimestampMilliseconds(rawValue: nextRawValue)),
            dayContext: current.dayContext
        )
    }

    func moment() throws -> ProductMoment {
        guard let value = clock.now() else { throw ProductFlowError.invalidData }
        return value
    }

    func orderedAreas(_ areas: [BodyArea]) -> [BodyArea] {
        let values = Set(areas)
        return PrototypeSelectionRules.supportedAreas.filter(values.contains)
    }

    func latestNormalDraft(in snapshot: KineoDataSnapshot) -> CheckIn? {
        snapshot.checkIns
            .filter { $0.status == .draft && $0.kind == .normal }
            .max { $0.startedAt < $1.startedAt }
    }

    func checkInDraft(from checkIn: CheckIn) -> SingleAreaCheckInDraft {
        SingleAreaCheckInDraft(
            checkInID: checkIn.id,
            entryID: CheckInEntryID(UUID()),
            area: checkIn.primaryArea,
            startedAt: checkIn.startedAt,
            dayContext: checkIn.dayContext
        )
    }

    func abandon(_ checkIn: CheckIn, store: KineoGRDBStore) async throws {
        let abandoned = try CheckIn(
            id: checkIn.id,
            status: .abandoned,
            kind: checkIn.kind,
            correctionSource: checkIn.correctionSource,
            primaryArea: checkIn.primaryArea,
            secondaryArea: checkIn.secondaryArea,
            startedAt: checkIn.startedAt,
            completedAt: nil,
            dayContext: checkIn.dayContext,
            entries: checkIn.entries
        )
        try await store.abandonCheckIn(try AbandonCheckInCommand(checkIn: abandoned))
    }

    func latestUnconsumedDecision(in snapshot: KineoDataSnapshot) -> SelectionDecision? {
        let consumedCheckInIDs = Set(snapshot.routineSessions.map(\.checkInID))
            .union(snapshot.pauseTodayEvents.map(\.checkInID))
        return snapshot.decisions
            .filter { $0.outcome == .selected && !consumedCheckInIDs.contains($0.checkInID) }
            .max { first, second in
                if first.createdAt == second.createdAt {
                    return first.revision < second.revision
                }
                return first.createdAt < second.createdAt
            }
    }

    func canonicalJSON(_ parameters: [String: String]) throws -> CanonicalJSON {
        try CanonicalJSON(bytes: JSONSerialization.data(withJSONObject: parameters, options: [.sortedKeys]))
    }

    func decodeParameters(_ parameters: CanonicalJSON) throws -> [String: String] {
        guard let value = try JSONSerialization.jsonObject(with: parameters.bytes) as? [String: String] else {
            throw ProductFlowError.invalidData
        }
        return value
    }

    func map(_ error: any Error) -> ProductFlowError {
        if let error = error as? ProductFlowError { return error }
        if let error = error as? PersistenceError { return .persistence(error) }
        if error is InstalledPrototypeCatalogError { return .contentUnavailable }
        if error is RoutineAlternativeSelectionError { return .invalidState }
        return .invalidData
    }

    static func defaultLocation() -> KineoStoreLocation? {
        guard let applicationSupportURL = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first else { return nil }
        return KineoStoreLocation(applicationSupportURL: applicationSupportURL)
    }

    func retryAfterCompletedDeletion(at location: KineoStoreLocation) async -> AppLaunchState {
        do {
            let candidate = try await KineoGRDBStore.open(
                location: location,
                protectedData: protectedData,
                storageProtector: storageProtector
            )
            _ = try await candidate.loadSnapshot()
            _ = try await catalogProvider.load()
            store = candidate
            return .foundationReady
        } catch KineoPersistenceFailure.protectedDataUnavailable,
                KineoCore.PersistenceError.protectedDataUnavailable {
            return .protectedDataUnavailable
        } catch {
            return .foundationUnavailable
        }
    }
}

private enum PrototypeProductConfiguration {
    static let safetyBoundaryVersion = "safety-boundary-v1.0.0-prototype"
    static let firstEntryRevision = 1
    static let emptyHistoryCount = 0
    static let firstStepIndex = 0
    static let stepIncrement = 1
    static let noElapsedMilliseconds: Int64 = 0
    static let timestampIncrement: Int64 = 1
    static let beforeFirstRevision = 0
    static let revisionIncrement = 1
    static let beforeFirstSequence = 0
    static let sequenceIncrement = 1
}

private enum ProductTimeFormat {
    static let localDay = "%04d-%02d-%02d"
    static let millisecondsPerSecond = 1_000.0
    static let gregorian = "gregorian"
}
