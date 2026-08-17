public enum PersistenceConstraint: String, Codable, Sendable {
    case duplicateIdentifier
    case duplicateRevision
    case relationship
    case activeRoutine
    case immutableRecord
    case domainInvariant
}

public enum PersistenceError: Error, Equatable, Sendable {
    case protectedDataUnavailable
    case futureSchema(found: Int, supported: Int)
    case migrationIntegrityFailure
    case migrationFailed
    case corruptedStore
    case constraintViolation(PersistenceConstraint)
    case recordNotFound
    case conflictingWrite
    case invalidLifecycleTransition
    case readFailed
    case writeFailed
    case storageProtectionFailed
    case deletionFailed
    case storeDeleted
}

public struct ProfileState: Equatable, Sendable, Codable {
    public let profile: UserProfile
    public let reminderSettings: ReminderSettings?

    public init(profile: UserProfile, reminderSettings: ReminderSettings?) {
        self.profile = profile
        self.reminderSettings = reminderSettings
    }
}

public struct KineoDataSnapshot: Equatable, Sendable, Codable {
    private static let maximumNonterminalRoutineCount = 1

    public let profileState: ProfileState?
    public let checkIns: [CheckIn]
    public let attentionStates: [AttentionState]
    public let safetyEvents: [SafetyEvent]
    public let pauseTodayEvents: [PauseTodayEvent]
    public let decisions: [SelectionDecision]
    public let routineSessions: [RoutineSession]
    public let routineEvents: [RoutineEvent]
    public let feedbackSubmissions: [FeedbackSubmission]

    public init(
        profileState: ProfileState?,
        checkIns: [CheckIn],
        attentionStates: [AttentionState],
        safetyEvents: [SafetyEvent],
        pauseTodayEvents: [PauseTodayEvent],
        decisions: [SelectionDecision],
        routineSessions: [RoutineSession],
        routineEvents: [RoutineEvent],
        feedbackSubmissions: [FeedbackSubmission]
    ) throws {
        try Self.validateUnique(checkIns.map(\.id), "checkInID")
        try Self.validateUnique(checkIns.flatMap(\.entries).map(\.id), "checkInEntryID")
        try Self.validateUnique(attentionStates.map(\.area), "attentionArea")
        try Self.validateUnique(safetyEvents.map(\.id), "safetyEventID")
        try Self.validateUnique(pauseTodayEvents.map(\.id), "pauseTodayEventID")
        try Self.validateUnique(decisions.map(\.id), "decisionID")
        try Self.validateUnique(
            decisions.map { "\($0.checkInID.rawValue):\($0.revision)" },
            "decisionRevision"
        )
        try Self.validateUnique(routineSessions.map(\.id), "routineSessionID")
        try Self.validateUnique(routineSessions.map(\.decisionID), "routineDecisionID")
        try Self.validateUnique(routineSessions.map(\.checkInID), "routineCheckInID")
        try Self.validateUnique(routineEvents.map(\.id), "routineEventID")
        try Self.validateUnique(
            routineEvents.map { "\($0.routineSessionID.rawValue):\($0.sequenceNumber)" },
            "routineEventSequence"
        )
        try Self.validateUnique(feedbackSubmissions.map(\.id), "feedbackSubmissionID")
        try Self.validateUnique(feedbackSubmissions.map(\.routineSessionID), "feedbackRoutineSessionID")
        guard routineSessions.count(where: { !$0.status.isTerminal }) <= Self.maximumNonterminalRoutineCount else {
            throw DomainValidationError.invariantViolation("Only one routine may be nonterminal.")
        }

        let checkInByID = Dictionary(uniqueKeysWithValues: checkIns.map { ($0.id, $0) })
        var entryByID: [CheckInEntryID: (owner: CheckIn, entry: CheckInEntry)] = [:]
        for checkIn in checkIns {
            for entry in checkIn.entries {
                entryByID[entry.id] = (checkIn, entry)
            }
        }
        let decisionByID = Dictionary(uniqueKeysWithValues: decisions.map { ($0.id, $0) })
        let sessionByID = Dictionary(uniqueKeysWithValues: routineSessions.map { ($0.id, $0) })
        guard checkIns.allSatisfy({ checkIn in
                  guard let correction = checkIn.correctionSource else {
                      return checkIn.correctionSource == nil
                  }
                  guard let triggeringEntryID = correction.triggeringEntryID else {
                      let hasRetainedTrigger = entryByID.values.contains {
                          $0.owner.id != checkIn.id &&
                              $0.entry.area == correction.area && $0.entry.triggersAttention
                      }
                      guard !hasRetainedTrigger else { return false }
                      if checkIn.status == .completed,
                         let correctedEntry = checkIn.entries.first(where: { $0.area == correction.area }) {
                          return safetyEvents.contains {
                              $0.sourceCheckInEntryID == correctedEntry.id &&
                                  ($0.kind == .attentionClearedCorrection ||
                                   $0.kind == .attentionReaffirmedCorrection)
                          }
                      }
                      return attentionStates.contains { $0.area == correction.area }
                  }
                  guard let source = entryByID[triggeringEntryID] else { return false }
                  return source.owner.id != checkIn.id &&
                      source.owner.status == .completed &&
                      source.entry.area == correction.area &&
                      source.entry.triggersAttention
              }),
              pauseTodayEvents.allSatisfy({ checkInByID[$0.checkInID]?.status == .completed }),
              safetyEvents.allSatisfy({ event in
                  guard let sourceID = event.sourceCheckInEntryID,
                        let source = entryByID[sourceID] else {
                      return event.sourceCheckInEntryID == nil
                  }
                  guard source.owner.status == .completed,
                        source.entry.area == event.area else { return false }
                  switch event.kind {
                  case .attentionEntered:
                      return source.entry.triggersAttention
                  case .attentionClearedCorrection:
                      return source.owner.kind == .attentionCorrection &&
                          source.owner.correctionSource?.area == event.area &&
                          !source.entry.triggersAttention
                  case .attentionReaffirmedCorrection:
                      return source.owner.kind == .attentionCorrection &&
                          source.owner.correctionSource?.area == event.area &&
                          source.entry.triggersAttention
                  case .attentionClearedReturnedToUsual, .attentionReaffirmed:
                      return false
                  }
              }),
              decisions.allSatisfy({ decision in
                  guard let checkIn = checkInByID[decision.checkInID],
                        checkIn.status == .completed,
                        Set(decision.areaInputs.map(\.checkInEntryID)) == Set(checkIn.entries.map(\.id)) else {
                      return false
                  }
                  return decision.areaInputs.allSatisfy { input in
                          guard let source = entryByID[input.checkInEntryID] else { return false }
                          return source.owner.id == decision.checkInID &&
                              source.entry.area == input.area && source.entry.role == input.role
                      }
              }),
              routineSessions.allSatisfy({ session in
                  guard let decision = decisionByID[session.decisionID] else { return false }
                  return decision.checkInID == session.checkInID &&
                      Set(decision.areaInputs.filter(\.included).map(\.area)) ==
                      Set(session.snapshot.includedAreas)
              }),
              routineSessions.allSatisfy({ session in
                  Self.hasValidRoutineHistory(
                      session: session,
                      events: routineEvents.filter { $0.routineSessionID == session.id }
                  )
              }),
              routineEvents.allSatisfy({ sessionByID[$0.routineSessionID] != nil }),
              feedbackSubmissions.allSatisfy({ submission in
                  guard let session = sessionByID[submission.routineSessionID] else { return false }
                  return session.status.acceptsFeedback &&
                      session.endedAt.map { submission.submittedAt >= $0 } == true &&
                      submission.responses.allSatisfy { session.snapshot.includedAreas.contains($0.area) }
              }) else {
            throw DomainValidationError.invariantViolation("Snapshot relationships are inconsistent.")
        }

        self.profileState = profileState
        self.checkIns = checkIns
        self.attentionStates = attentionStates
        self.safetyEvents = safetyEvents
        self.pauseTodayEvents = pauseTodayEvents
        self.decisions = decisions
        self.routineSessions = routineSessions
        self.routineEvents = routineEvents
        self.feedbackSubmissions = feedbackSubmissions
    }

    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(
            profileState: values.decodeIfPresent(ProfileState.self, forKey: .profileState),
            checkIns: values.decode([CheckIn].self, forKey: .checkIns),
            attentionStates: values.decode([AttentionState].self, forKey: .attentionStates),
            safetyEvents: values.decode([SafetyEvent].self, forKey: .safetyEvents),
            pauseTodayEvents: values.decode([PauseTodayEvent].self, forKey: .pauseTodayEvents),
            decisions: values.decode([SelectionDecision].self, forKey: .decisions),
            routineSessions: values.decode([RoutineSession].self, forKey: .routineSessions),
            routineEvents: values.decode([RoutineEvent].self, forKey: .routineEvents),
            feedbackSubmissions: values.decode([FeedbackSubmission].self, forKey: .feedbackSubmissions)
        )
    }

    private static func validateUnique<Value: Hashable>(_ values: [Value], _ field: String) throws {
        guard Set(values).count == values.count else {
            throw DomainValidationError.invariantViolation("Duplicate \(field).")
        }
    }

    private static func hasValidRoutineHistory(
        session: RoutineSession,
        events: [RoutineEvent]
    ) -> Bool {
        let ordered = events.sorted { $0.sequenceNumber < $1.sequenceNumber }
        guard ordered.enumerated().allSatisfy({ $0.element.sequenceNumber == $0.offset + 1 }) else {
            return false
        }
        var state = RoutineStatus.prepared
        var lastOccurredAt: TimestampMilliseconds?
        for event in ordered {
            if let lastOccurredAt, event.occurredAt < lastOccurredAt { return false }
            lastOccurredAt = event.occurredAt
            switch event.kind {
            case .started where state == .prepared:
                state = .inProgress
            case .paused where state == .inProgress:
                state = .paused
            case .resumed where state == .paused:
                state = .inProgress
            case .stepCompleted where state == .inProgress,
                 .skipped where state == .inProgress:
                break
            case .alternativeSelected where state == .inProgress || state == .paused:
                break
            case .completed where state == .inProgress || state == .paused:
                state = .completed
            case .stopped where state == .inProgress || state == .paused:
                state = .stopped
            case .safetyStopped where state == .inProgress || state == .paused:
                state = .safetyStopped
            case .abandoned where !state.isTerminal:
                state = .abandoned
            default:
                return false
            }
        }
        guard state == session.status else { return false }
        guard let lastOccurredAt else { return session.status == .prepared }
        guard session.updatedAt >= lastOccurredAt else { return false }
        return session.endedAt.map { $0 >= lastOccurredAt } ?? true
    }
}

public struct SaveProfileCommand: Equatable, Sendable {
    public let state: ProfileState

    public init(state: ProfileState) {
        self.state = state
    }
}

public struct SaveCheckInDraftCommand: Equatable, Sendable {
    public let checkIn: CheckIn

    public init(checkIn: CheckIn) throws {
        guard checkIn.status == .draft else {
            throw DomainValidationError.invariantViolation("Only a draft check-in can use the draft command.")
        }
        self.checkIn = checkIn
    }
}

public struct AbandonCheckInCommand: Equatable, Sendable {
    public let checkIn: CheckIn

    public init(checkIn: CheckIn) throws {
        guard checkIn.status == .abandoned else {
            throw DomainValidationError.invariantViolation(
                "Only an abandoned check-in can use the abandon command."
            )
        }
        self.checkIn = checkIn
    }
}

public struct CompleteCheckInCommand: Equatable, Sendable {
    public let checkIn: CheckIn
    public let safetyMutations: [SafetyMutation]

    public init(checkIn: CheckIn, safetyMutations: [SafetyMutation]) throws {
        guard checkIn.status == .completed else {
            throw DomainValidationError.invariantViolation("The complete command requires a completed check-in.")
        }
        guard Set(safetyMutations.map(\.event.area)).count == safetyMutations.count else {
            throw DomainValidationError.invariantViolation("A check-in can mutate each safety area once.")
        }
        let entryByID = Dictionary(uniqueKeysWithValues: checkIn.entries.map { ($0.id, $0) })
        guard safetyMutations.allSatisfy({ mutation in
            guard let sourceID = mutation.event.sourceCheckInEntryID else { return false }
            guard let entry = entryByID[sourceID], entry.area == mutation.event.area else { return false }
            if checkIn.correctionSource?.area == entry.area {
                if entry.triggersAttention {
                    return mutation.event.kind == .attentionReaffirmedCorrection &&
                        mutation.statusAfter == .attentionRequired
                }
                return mutation.event.kind == .attentionClearedCorrection &&
                    mutation.statusAfter == .normal
            }
            return entry.triggersAttention &&
                mutation.event.kind == .attentionEntered &&
                mutation.statusAfter == .attentionRequired
        }) else {
            throw DomainValidationError.invariantViolation(
                "Check-in safety events must reference an entry in the completed check-in."
            )
        }
        let triggerEntries = checkIn.entries.filter(\.triggersAttention)
        var expectedSourceIDs = Set(triggerEntries.map(\.id))
        if let correctionSource = checkIn.correctionSource {
            guard let correctedEntry = checkIn.entries.first(where: { $0.area == correctionSource.area }) else {
                throw DomainValidationError.invariantViolation(
                    "A completed correction requires a correction clear or reaffirm event."
                )
            }
            expectedSourceIDs.insert(correctedEntry.id)
        }
        let actualSourceIDs = Set(safetyMutations.compactMap(\.event.sourceCheckInEntryID))
        guard actualSourceIDs == expectedSourceIDs,
              safetyMutations.count == expectedSourceIDs.count else {
            throw DomainValidationError.invariantViolation(
                "Safety mutations must exactly cover triggering entries and the correction entry."
            )
        }
        self.checkIn = checkIn
        self.safetyMutations = safetyMutations
    }
}

public struct ApplySafetyMutationCommand: Equatable, Sendable {
    public let mutation: SafetyMutation

    public init(mutation: SafetyMutation) throws {
        guard mutation.event.kind == .attentionClearedReturnedToUsual ||
                mutation.event.kind == .attentionReaffirmed else {
            throw DomainValidationError.invariantViolation(
                "Standalone safety changes are return-to-usual responses."
            )
        }
        self.mutation = mutation
    }
}

public struct AppendDecisionCommand: Equatable, Sendable {
    public let decision: SelectionDecision

    public init(decision: SelectionDecision) {
        self.decision = decision
    }
}

public struct RecordPauseTodayCommand: Equatable, Sendable {
    public let event: PauseTodayEvent

    public init(event: PauseTodayEvent) {
        self.event = event
    }
}

public struct CreateRoutineCommand: Equatable, Sendable {
    public let session: RoutineSession

    public init(session: RoutineSession) throws {
        guard session.status == .prepared else {
            throw DomainValidationError.invariantViolation("A routine is created in prepared state.")
        }
        self.session = session
    }
}

public struct RecordRoutineEventCommand: Equatable, Sendable {
    public let event: RoutineEvent
    public let checkpoint: RoutineCheckpoint

    public init(event: RoutineEvent, checkpoint: RoutineCheckpoint) throws {
        guard checkpoint.updatedAt >= event.occurredAt,
              checkpoint.endedAt.map({ $0 >= event.occurredAt }) ?? true else {
            throw DomainValidationError.invariantViolation(
                "A routine checkpoint cannot precede its event."
            )
        }
        switch event.kind {
        case .started:
            guard checkpoint.status == .inProgress else {
                throw DomainValidationError.invariantViolation("Started must transition to in-progress.")
            }
        case .paused:
            guard checkpoint.status == .paused else {
                throw DomainValidationError.invariantViolation("Paused must transition to paused.")
            }
        case .resumed:
            guard checkpoint.status == .inProgress else {
                throw DomainValidationError.invariantViolation("Resumed must transition to in-progress.")
            }
        case .completed:
            guard checkpoint.status == .completed else {
                throw DomainValidationError.invariantViolation("Completed event and checkpoint disagree.")
            }
        case .stopped:
            guard checkpoint.status == .stopped else {
                throw DomainValidationError.invariantViolation("Stopped event and checkpoint disagree.")
            }
        case .safetyStopped:
            guard checkpoint.status == .safetyStopped else {
                throw DomainValidationError.invariantViolation("Safety-stop event and checkpoint disagree.")
            }
        case .abandoned:
            guard checkpoint.status == .abandoned else {
                throw DomainValidationError.invariantViolation("Abandoned event and checkpoint disagree.")
            }
        case .stepCompleted, .skipped:
            guard checkpoint.status == .inProgress else {
                throw DomainValidationError.invariantViolation("A movement event remains in progress.")
            }
        case .alternativeSelected:
            guard checkpoint.status == .inProgress || checkpoint.status == .paused else {
                throw DomainValidationError.invariantViolation(
                    "Alternative selection preserves the active or paused state."
                )
            }
        }
        self.event = event
        self.checkpoint = checkpoint
    }
}

public struct SubmitFeedbackCommand: Equatable, Sendable {
    public let submission: FeedbackSubmission

    public init(submission: FeedbackSubmission) {
        self.submission = submission
    }
}

public protocol KineoStore: Sendable {
    func loadSnapshot() async throws(PersistenceError) -> KineoDataSnapshot
    func saveProfile(_ command: SaveProfileCommand) async throws(PersistenceError)
    func saveCheckInDraft(_ command: SaveCheckInDraftCommand) async throws(PersistenceError)
    func abandonCheckIn(_ command: AbandonCheckInCommand) async throws(PersistenceError)
    func completeCheckIn(_ command: CompleteCheckInCommand) async throws(PersistenceError)
    func applySafetyMutation(_ command: ApplySafetyMutationCommand) async throws(PersistenceError)
    func appendDecision(_ command: AppendDecisionCommand) async throws(PersistenceError)
    func recordPauseToday(_ command: RecordPauseTodayCommand) async throws(PersistenceError)
    func createRoutine(_ command: CreateRoutineCommand) async throws(PersistenceError)
    func recordRoutineEvent(_ command: RecordRoutineEventCommand) async throws(PersistenceError)
    func submitFeedback(_ command: SubmitFeedbackCommand) async throws(PersistenceError)
    func resetHistory() async throws(PersistenceError)
    func deleteAllData() async throws(PersistenceError)
}
