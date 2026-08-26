import Foundation
import KineoCore
@testable import KineoInfrastructure
import Testing

@Suite("Prototype product service")
struct PrototypeProductServiceTests {
    @Test("Single-area onboarding through feedback persists the complete product loop")
    func completeSingleAreaLoop() async throws {
        let fixture = try ProductServiceFixture()
        defer { fixture.removeFiles() }
        let service = fixture.service

        #expect(await service.initialState() == .foundationReady)
        #expect(try await service.loadProductStartState() == .onboarding(.welcome))
        try await service.confirmAdultEligibility()
        #expect(try await service.loadProductStartState() == .onboarding(.primaryArea))
        try await service.savePrimaryArea(.neck)
        #expect(
            try await service.loadProductStartState() == .onboarding(
                .secondaryArea(primary: .neck, selected: nil)
            )
        )
        try await service.saveSecondaryArea(nil)
        #expect(
            try await service.loadProductStartState() == .onboarding(.safetyBoundary(.neck))
        )
        try await service.acknowledgeSafetyBoundary()
        #expect(
            try await service.loadProductStartState() == .onboarding(.firstCheckIn(.neck))
        )
        #expect(try await service.completeOnboarding() == .neck)

        let draft = try await service.beginCheckIn()
        let result = try await service.submitPrimaryOnlyCheckIn(
            draft,
            change: .similar,
            comfort: .okay,
            safetyAnswer: nil
        )
        guard case .plan(let standard) = result else {
            Issue.record("Expected a plan after a non-triggering check-in.")
            return
        }
        #expect(standard.area == .neck)
        #expect(standard.selectedLevel == .balanced)
        #expect(standard.duration == .standard)

        let quick = try await service.revisePlan(
            checkInID: standard.checkInID,
            duration: .quick,
            requestedLevel: nil
        )
        #expect(quick.selectedLevel == standard.selectedLevel)
        #expect(quick.duration == .quick)

        let standardAgain = try await service.revisePlan(
            checkInID: standard.checkInID,
            duration: .standard,
            requestedLevel: nil
        )
        let standardRetry = try await service.revisePlan(
            checkInID: standard.checkInID,
            duration: .standard,
            requestedLevel: nil
        )
        #expect(standardAgain.decisionID != standard.decisionID)
        #expect(standardRetry.decisionID == standardAgain.decisionID)

        var routine = try await service.startRoutine(decisionID: standardAgain.decisionID)
        #expect(routine.status == .inProgress)
        while !routine.status.isTerminal {
            routine = try await service.advanceRoutine(
                sessionID: routine.sessionID,
                expectedStepIndex: routine.currentStepIndex
            )
        }
        #expect(routine.status == .completed)
        #expect(routine.currentStepIndex == routine.totalStepCount)
        try await service.submitFeedback(sessionID: routine.sessionID, response: .same)

        let persisted = try await fixture.snapshot()
        #expect(persisted.profileState?.profile.onboardingCompletedAt != nil)
        #expect(persisted.checkIns.count == ProductServiceFixture.completedCheckInCount)
        #expect(persisted.decisions.count == ProductServiceFixture.planRevisionCount)
        #expect(persisted.routineSessions.first?.status == .completed)
        #expect(persisted.feedbackSubmissions.first?.responses.first?.response == .same)
    }

    @Test("A same-day repeat creates a fresh check-in and selection decision")
    func sameDayRepeatRequiresFreshCheckInAndDecision() async throws {
        let fixture = try ProductServiceFixture()
        defer { fixture.removeFiles() }
        try await fixture.completeOnboarding(area: .neck)

        let firstDraft = try await fixture.service.beginCheckIn()
        guard case .plan(let firstPlan) = try await fixture.service.submitPrimaryOnlyCheckIn(
            firstDraft,
            change: .similar,
            comfort: .okay,
            safetyAnswer: nil
        ) else {
            Issue.record("Expected the first check-in to produce a plan.")
            return
        }

        var routine = try await fixture.service.startRoutine(decisionID: firstPlan.decisionID)
        while !routine.status.isTerminal {
            routine = try await fixture.service.advanceRoutine(
                sessionID: routine.sessionID,
                expectedStepIndex: routine.currentStepIndex
            )
        }
        try await fixture.service.submitFeedback(sessionID: routine.sessionID, response: .same)

        let repeatDraft = try await fixture.service.beginCheckIn()
        #expect(repeatDraft.checkInID != firstDraft.checkInID)
        #expect(repeatDraft.dayContext == firstDraft.dayContext)

        guard case .plan(let repeatPlan) = try await fixture.service.submitPrimaryOnlyCheckIn(
            repeatDraft,
            change: .similar,
            comfort: .okay,
            safetyAnswer: nil
        ) else {
            Issue.record("Expected the repeat check-in to produce a new plan.")
            return
        }
        #expect(repeatPlan.checkInID == repeatDraft.checkInID)
        #expect(repeatPlan.decisionID != firstPlan.decisionID)
    }

    @Test("Every ordered area pair composes conservatively and keeps feedback history isolated")
    func orderedAreaPairsRemainConservativeAndIsolated() async throws {
        for (primaryArea, secondaryArea) in ProductServiceFixture.orderedAreaPairs {
            let fixture = try ProductServiceFixture()
            defer { fixture.removeFiles() }
            try await fixture.completeOnboarding(area: primaryArea, secondaryArea: secondaryArea)
            let draft = try await fixture.service.beginCheckIn()
            guard case .plan(let plan) = try await fixture.service.submitCheckIn(
                draft,
                primary: AreaCheckInAnswers(
                    area: primaryArea,
                    change: .similar,
                    comfort: .okay,
                    safetyAnswer: nil
                ),
                secondary: AreaCheckInAnswers(
                    area: secondaryArea,
                    change: .worse,
                    comfort: .okay,
                    safetyAnswer: .no
                )
            ) else {
                Issue.record("Expected a two-area plan for \(primaryArea) and \(secondaryArea).")
                continue
            }
            #expect(plan.recommendedLevel == .gentle)
            #expect(plan.includedAreas == [primaryArea, secondaryArea])
            #expect(plan.omittedSecondaryArea == nil)

            var routine = try await fixture.service.startRoutine(decisionID: plan.decisionID)
            #expect(routine.includedAreas == [primaryArea, secondaryArea])
            while !routine.status.isTerminal {
                routine = try await fixture.service.advanceRoutine(
                    sessionID: routine.sessionID,
                    expectedStepIndex: routine.currentStepIndex
                )
            }
            try await fixture.service.submitFeedback(
                sessionID: routine.sessionID,
                responses: [primaryArea: .better, secondaryArea: .worse]
            )

            let nextDraft = try await fixture.service.beginCheckIn()
            guard case .plan(let nextPlan) = try await fixture.service.submitCheckIn(
                nextDraft,
                primary: AreaCheckInAnswers(
                    area: primaryArea,
                    change: .better,
                    comfort: .good,
                    safetyAnswer: nil
                ),
                secondary: AreaCheckInAnswers(
                    area: secondaryArea,
                    change: .better,
                    comfort: .good,
                    safetyAnswer: nil
                )
            ) else {
                Issue.record("Expected the next two-area plan.")
                continue
            }
            let persisted = try await fixture.snapshot()
            let nextDecision = persisted.decisions.first(where: { $0.id == nextPlan.decisionID })
            #expect(
                nextDecision?.areaInputs.first(where: { $0.area == primaryArea })?.qualifyingCount ==
                    ProductServiceFixture.oneQualifyingOutcome
            )
            #expect(
                nextDecision?.areaInputs.first(where: { $0.area == secondaryArea })?.qualifyingCount ==
                    ProductServiceFixture.noQualifyingOutcomes
            )
        }
    }

    @Test("A secondary safety trigger blocks every ordered pair without catalog fallback")
    func secondarySafetyBlocksEveryOrderedPair() async throws {
        for (primaryArea, secondaryArea) in ProductServiceFixture.orderedAreaPairs {
            let fixture = try ProductServiceFixture()
            defer { fixture.removeFiles() }
            try await fixture.completeOnboarding(area: primaryArea, secondaryArea: secondaryArea)
            let draft = try await fixture.service.beginCheckIn()
            guard case .attentionRequired(let prompt) = try await fixture.service.submitCheckIn(
                draft,
                primary: AreaCheckInAnswers(
                    area: primaryArea,
                    change: .similar,
                    comfort: .okay,
                    safetyAnswer: nil
                ),
                secondary: AreaCheckInAnswers(
                    area: secondaryArea,
                    change: .worse,
                    comfort: .limited,
                    safetyAnswer: .yes
                )
            ) else {
                Issue.record("Expected secondary Attention for \(secondaryArea).")
                continue
            }
            #expect(prompt.area == secondaryArea)
            let persisted = try await fixture.snapshot()
            #expect(persisted.decisions.isEmpty)
            #expect(persisted.routineSessions.isEmpty)
            #expect(persisted.attentionStates.map(\.area) == [secondaryArea])
        }
    }

    @Test("Skipping a secondary is disclosed and omitted from routine feedback")
    func skippedSecondaryIsDisclosed() async throws {
        let fixture = try ProductServiceFixture()
        defer { fixture.removeFiles() }
        try await fixture.completeOnboarding(area: .neck, secondaryArea: .upperMidBack)
        let draft = try await fixture.service.beginCheckIn()
        guard case .plan(let plan) = try await fixture.service.submitCheckIn(
            draft,
            primary: AreaCheckInAnswers(
                area: .neck,
                change: .similar,
                comfort: .okay,
                safetyAnswer: nil
            ),
            secondary: nil
        ) else {
            Issue.record("Expected a disclosed primary-only plan.")
            return
        }
        #expect(plan.includedAreas == [.neck])
        #expect(plan.omittedSecondaryArea == .upperMidBack)
        var routine = try await fixture.service.startRoutine(decisionID: plan.decisionID)
        while !routine.status.isTerminal {
            routine = try await fixture.service.advanceRoutine(
                sessionID: routine.sessionID,
                expectedStepIndex: routine.currentStepIndex
            )
        }
        await #expect(throws: ProductFlowError.invalidState) {
            try await fixture.service.submitFeedback(
                sessionID: routine.sessionID,
                responses: [.upperMidBack: .same]
            )
        }
        let decision = try await fixture.snapshot().decisions.first
        #expect(decision?.secondaryOmissionReason == .secondaryUnanswered)
        #expect(decision?.notices.contains(where: { $0.code.rawValue == "notice.secondary_skipped" }) == true)
    }

    @Test("A missing approved pairing produces a disclosed primary-only routine")
    func missingPairingFallsBackToPrimaryOnly() async throws {
        let fixture = try ProductServiceFixture()
        defer { fixture.removeFiles() }
        try await fixture.completeOnboarding(area: .lowerBack, secondaryArea: .neck)
        await fixture.catalogProvider.setPairingsAvailable(false)
        let draft = try await fixture.service.beginCheckIn()
        guard case .plan(let plan) = try await fixture.service.submitCheckIn(
            draft,
            primary: AreaCheckInAnswers(
                area: .lowerBack,
                change: .similar,
                comfort: .okay,
                safetyAnswer: nil
            ),
            secondary: AreaCheckInAnswers(
                area: .neck,
                change: .similar,
                comfort: .okay,
                safetyAnswer: nil
            )
        ) else {
            Issue.record("Expected an approved primary-only fallback.")
            return
        }
        #expect(plan.includedAreas == [.lowerBack])
        #expect(plan.omittedSecondaryArea == .neck)
        let routine = try await fixture.service.startRoutine(decisionID: plan.decisionID)
        #expect(routine.includedAreas == [.lowerBack])
        let decision = try await fixture.snapshot().decisions.first
        #expect(decision?.areaInputs.first(where: { $0.area == .neck })?.included == false)
    }

    @Test("Multiple Attention areas persist and resolve in stable order")
    func multipleAttentionAreasResolveInOrder() async throws {
        let fixture = try ProductServiceFixture()
        defer { fixture.removeFiles() }
        try await fixture.completeOnboarding(area: .neck, secondaryArea: .lowerBack)
        let draft = try await fixture.service.beginCheckIn()
        guard case .attentionRequired(let firstPrompt) = try await fixture.service.submitCheckIn(
            draft,
            primary: AreaCheckInAnswers(
                area: .neck,
                change: .worse,
                comfort: .okay,
                safetyAnswer: .yes
            ),
            secondary: AreaCheckInAnswers(
                area: .lowerBack,
                change: .similar,
                comfort: .limited,
                safetyAnswer: .notSure
            )
        ) else {
            Issue.record("Expected Attention for both triggering areas.")
            return
        }
        #expect(firstPrompt.area == .neck)
        guard case .attentionRequired(let secondPrompt) = try await fixture.service.respondToAttentionReturn(
            firstPrompt,
            answer: .yes
        ) else {
            Issue.record("Expected the remaining Attention area.")
            return
        }
        #expect(secondPrompt.area == .lowerBack)
        #expect(try await fixture.snapshot().attentionStates.map(\.area) == [.lowerBack])
    }

    @Test("Retrying a committed two-area check-in reuses its plan revision")
    func committedTwoAreaRetryIsIdempotent() async throws {
        let fixture = try ProductServiceFixture()
        defer { fixture.removeFiles() }
        try await fixture.completeOnboarding(area: .upperMidBack, secondaryArea: .neck)
        let draft = try await fixture.service.beginCheckIn()
        let primary = AreaCheckInAnswers(
            area: .upperMidBack,
            change: .similar,
            comfort: .okay,
            safetyAnswer: nil
        )
        let secondary = AreaCheckInAnswers(
            area: .neck,
            change: .better,
            comfort: .good,
            safetyAnswer: nil
        )
        guard case .plan(let first) = try await fixture.service.submitCheckIn(
            draft,
            primary: primary,
            secondary: secondary
        ), case .plan(let retry) = try await fixture.service.submitCheckIn(
            draft,
            primary: primary,
            secondary: secondary
        ) else {
            Issue.record("Expected an idempotent two-area plan retry.")
            return
        }
        #expect(retry.decisionID == first.decisionID)
        let persisted = try await fixture.snapshot()
        #expect(persisted.checkIns.count == ProductServiceFixture.completedCheckInCount)
        #expect(persisted.decisions.count == ProductServiceFixture.singleDecisionCount)
    }

    @Test("Changing the secondary area invalidates an unfinished area-set draft")
    func changedSecondaryInvalidatesDraft() async throws {
        let fixture = try ProductServiceFixture()
        defer { fixture.removeFiles() }
        try await fixture.completeOnboarding(area: .neck, secondaryArea: .lowerBack)
        let stale = try await fixture.service.beginCheckIn()
        try await fixture.service.saveSecondaryArea(.upperMidBack)

        let reopened = fixture.reopenedService()
        #expect(await reopened.initialState() == .foundationReady)
        #expect(try await reopened.loadProductStartState() == .today(.neck))
        let fresh = try await reopened.beginCheckIn()
        #expect(fresh.secondaryArea == .upperMidBack)
        #expect(
            try await fixture.snapshot().checkIns.first(where: { $0.id == stale.checkInID })?.status ==
                .abandoned
        )
    }

    @Test("Progress is local, per-area, and neutral across one participation day")
    func progressProjectionIsAreaSpecific() async throws {
        let fixture = try ProductServiceFixture()
        defer { fixture.removeFiles() }
        try await fixture.completeOnboarding(area: .neck, secondaryArea: .lowerBack)
        let draft = try await fixture.service.beginCheckIn()
        guard case .plan(let plan) = try await fixture.service.submitCheckIn(
            draft,
            primary: AreaCheckInAnswers(
                area: .neck,
                change: .similar,
                comfort: .okay,
                safetyAnswer: nil
            ),
            secondary: AreaCheckInAnswers(
                area: .lowerBack,
                change: .worse,
                comfort: .okay,
                safetyAnswer: .no
            )
        ) else {
            Issue.record("Expected a two-area plan.")
            return
        }
        var routine = try await fixture.service.startRoutine(decisionID: plan.decisionID)
        while !routine.status.isTerminal {
            routine = try await fixture.service.advanceRoutine(
                sessionID: routine.sessionID,
                expectedStepIndex: routine.currentStepIndex
            )
        }
        try await fixture.service.submitFeedback(
            sessionID: routine.sessionID,
            responses: [.neck: .better, .lowerBack: .worse]
        )

        let progress = try await fixture.service.loadProgress()
        #expect(progress.participationDayCount == ProductServiceFixture.singleParticipationDay)
        #expect(
            progress.areas.first(where: { $0.area == .neck })?.recordedCheckInCount ==
                ProductServiceFixture.singleRecordedCheckIn
        )
        #expect(
            progress.areas.first(where: { $0.area == .neck })?.completedRoutineCount ==
                ProductServiceFixture.singleCompletedRoutine
        )
        #expect(
            progress.areas.first(where: { $0.area == .neck })?.qualifyingActiveCount ==
                ProductServiceFixture.oneQualifyingOutcome
        )
        #expect(
            progress.areas.first(where: { $0.area == .lowerBack })?.qualifyingActiveCount ==
                ProductServiceFixture.noQualifyingOutcomes
        )
        #expect(progress.areas.first(where: { $0.area == .lowerBack })?.latestResponse == .worse)

        _ = try await fixture.service.saveAreaPreferences(primary: .upperMidBack, secondary: .neck)
        let retained = try await fixture.service.loadProgress()
        #expect(
            retained.areas.first(where: { $0.area == .neck })?.completedRoutineCount ==
                ProductServiceFixture.singleCompletedRoutine
        )
        #expect(retained.areas.first(where: { $0.area == .neck })?.latestResponse == .better)
    }

    @Test("Area changes retain Attention, abandon incompatible drafts, and reject duplicate areas")
    func areaPreferencesRespectSafetyAndDraftState() async throws {
        let attentionFixture = try ProductServiceFixture()
        defer { attentionFixture.removeFiles() }
        try await attentionFixture.completeOnboarding(area: .neck)
        let attentionDraft = try await attentionFixture.service.beginCheckIn()
        _ = try await attentionFixture.service.submitPrimaryOnlyCheckIn(
            attentionDraft,
            change: .worse,
            comfort: .limited,
            safetyAnswer: .yes
        )
        #expect(try await attentionFixture.service.loadProgress().isEmpty == false)

        let updated = try await attentionFixture.service.saveAreaPreferences(
            primary: .upperMidBack,
            secondary: .lowerBack
        )
        #expect(updated.primaryArea == .upperMidBack)
        #expect(updated.secondaryArea == .lowerBack)
        #expect(try await attentionFixture.snapshot().attentionStates.map(\.area) == [.neck])

        let draftFixture = try ProductServiceFixture()
        defer { draftFixture.removeFiles() }
        try await draftFixture.completeOnboarding(area: .neck, secondaryArea: .lowerBack)
        let incompatibleDraft = try await draftFixture.service.beginCheckIn()
        _ = try await draftFixture.service.saveAreaPreferences(primary: .upperMidBack, secondary: nil)
        #expect(
            try await draftFixture.snapshot().checkIns.first(where: {
                $0.id == incompatibleDraft.checkInID
            })?.status == .abandoned
        )
        await #expect(throws: ProductFlowError.invalidState) {
            _ = try await draftFixture.service.saveAreaPreferences(
                primary: .upperMidBack,
                secondary: .upperMidBack
            )
        }
    }

    @Test("Reminder denial and scheduling failure retain a disabled preference")
    func reminderFailuresRemainOptional() async throws {
        let fixture = try ProductServiceFixture()
        defer { fixture.removeFiles() }
        try await fixture.completeOnboarding(area: .neck)
        let window = try ProductServiceFixture.reminderWindow()
        await fixture.reminderScheduler.setAuthorization(.denied)

        let denied = try await fixture.service.enableReminder(window: window)
        #expect(denied.reminderSettings?.enabled == false)
        #expect(denied.reminderSettings?.window == window)
        #expect(await fixture.reminderScheduler.snapshot().scheduledWindow == nil)

        await fixture.reminderScheduler.setAuthorization(.authorized)
        await fixture.reminderScheduler.setScheduleFailure(.schedulingFailed)
        await #expect(throws: ProductFlowError.reminderUnavailable) {
            _ = try await fixture.service.enableReminder(window: window)
        }
        #expect(try await fixture.service.loadProfile().reminderSettings?.enabled == false)
    }

    @Test("Reminder replacement, disable, Reset History, and Delete All preserve exact scope")
    func profileDataControlsRespectScope() async throws {
        let fixture = try ProductServiceFixture()
        defer { fixture.removeFiles() }
        try await fixture.completeOnboarding(area: .upperMidBack)
        #expect(
            await fixture.reminderScheduler.snapshot().permissionRequestCount ==
                ProductServiceFixture.noPermissionRequests
        )
        let window = try ProductServiceFixture.reminderWindow()
        let enabled = try await fixture.service.enableReminder(window: window)
        #expect(enabled.reminderSettings?.enabled == true)
        let scheduled = await fixture.reminderScheduler.snapshot()
        #expect(scheduled.scheduledWindow == window)
        #expect(scheduled.permissionRequestCount == ProductServiceFixture.expectedPermissionRequestCount)

        let draft = try await fixture.service.beginCheckIn()
        _ = try await fixture.service.submitPrimaryOnlyCheckIn(
            draft,
            change: .worse,
            comfort: .limited,
            safetyAnswer: .yes
        )
        try await fixture.service.resetHistory()
        #expect(try await fixture.service.loadProgress().isEmpty)
        #expect(try await fixture.service.loadProfile().reminderSettings?.enabled == true)
        let afterReset = try await fixture.snapshot()
        #expect(afterReset.checkIns.isEmpty)
        #expect(afterReset.attentionStates.map(\.area) == [.upperMidBack])

        _ = try await fixture.service.disableReminder()
        #expect(await fixture.reminderScheduler.snapshot().scheduledWindow == nil)
        try await fixture.service.deleteAllData()
        #expect(try await fixture.service.loadProductStartState() == .onboarding(.welcome))
        #expect(
            await fixture.reminderScheduler.snapshot().cancellationCount >=
                ProductServiceFixture.expectedCancellationCount
        )
    }

    @Test("Relaunch resumes one same-day check-in without creating a duplicate draft")
    func relaunchResumesSameDayCheckIn() async throws {
        let fixture = try ProductServiceFixture()
        defer { fixture.removeFiles() }
        try await fixture.completeOnboarding(area: .neck)
        let original = try await fixture.service.beginCheckIn()

        let reopened = fixture.reopenedService()
        #expect(await reopened.initialState() == .foundationReady)
        guard case .unfinishedCheckIn(let restored) = try await reopened.loadProductStartState() else {
            Issue.record("Expected the same-day check-in to resume after relaunch.")
            return
        }
        #expect(restored.checkInID == original.checkInID)
        #expect(try await reopened.beginCheckIn().checkInID == original.checkInID)
        #expect(try await fixture.snapshot().checkIns.count == ProductServiceFixture.completedCheckInCount)
    }

    @Test("A stale check-in is abandoned before Today starts a fresh flow")
    func staleCheckInIsAbandoned() async throws {
        let fixture = try ProductServiceFixture()
        defer { fixture.removeFiles() }
        try await fixture.completeOnboarding(area: .lowerBack)
        let stale = try await fixture.service.beginCheckIn()

        let reopened = fixture.reopenedService(clock: FixedProductClock(localDay: .followingDay))
        #expect(await reopened.initialState() == .foundationReady)
        #expect(try await reopened.loadProductStartState() == .today(.lowerBack))
        let persisted = try await fixture.snapshot()
        #expect(persisted.checkIns.first(where: { $0.id == stale.checkInID })?.status == .abandoned)
    }

    @Test("Relaunch restores the latest unconsumed plan without adding a revision")
    func relaunchRestoresLatestPlan() async throws {
        let fixture = try ProductServiceFixture()
        defer { fixture.removeFiles() }
        let initial = try await fixture.makePlan(area: .upperMidBack)
        let latest = try await fixture.service.revisePlan(
            checkInID: initial.checkInID,
            duration: .quick,
            requestedLevel: nil
        )
        let decisionCount = try await fixture.snapshot().decisions.count

        let reopened = fixture.reopenedService()
        #expect(await reopened.initialState() == .foundationReady)
        guard case .unfinishedPlan(let restored) = try await reopened.loadProductStartState() else {
            Issue.record("Expected the latest unconsumed plan after relaunch.")
            return
        }
        #expect(restored.decisionID == latest.decisionID)
        #expect(restored.duration == .quick)
        #expect(try await fixture.snapshot().decisions.count == decisionCount)
    }

    @Test("A triggering answer enters global Attention and no plan is created")
    func attentionBlocksPlans() async throws {
        let fixture = try ProductServiceFixture()
        defer { fixture.removeFiles() }
        let service = fixture.service
        #expect(await service.initialState() == .foundationReady)
        try await service.confirmAdultEligibility()
        try await service.savePrimaryArea(.lowerBack)
        try await service.acknowledgeSafetyBoundary()
        _ = try await service.completeOnboarding()

        let draft = try await service.beginCheckIn()
        let result = try await service.submitPrimaryOnlyCheckIn(
            draft,
            change: .worse,
            comfort: .limited,
            safetyAnswer: .notSure
        )
        guard case .attentionRequired(let prompt) = result else {
            Issue.record("Expected Attention after a triggering answer.")
            return
        }
        #expect(prompt.area == .lowerBack)
        await #expect(throws: ProductFlowError.attentionRequired([.lowerBack])) {
            _ = try await service.beginCheckIn()
        }

        let persisted = try await fixture.snapshot()
        #expect(persisted.attentionStates.map(\.area) == [.lowerBack])
        #expect(persisted.decisions.isEmpty)
        #expect(persisted.routineSessions.isEmpty)
    }

    @Test("Attention answers and correction preserve the gate until a valid clear commits")
    func attentionReturnAndCorrection() async throws {
        let fixture = try ProductServiceFixture()
        defer { fixture.removeFiles() }
        let service = fixture.service
        try await fixture.completeOnboarding(area: .upperMidBack)

        let draft = try await service.beginCheckIn()
        guard case .attentionRequired = try await service.submitPrimaryOnlyCheckIn(
            draft,
            change: .worse,
            comfort: .okay,
            safetyAnswer: .notSure
        ) else {
            Issue.record("Expected the original check-in to enter Attention.")
            return
        }
        guard case .attentionRequired(let initialPrompt) = try await service.loadProductStartState()
        else {
            Issue.record("Expected relaunch to restore the Attention prompt.")
            return
        }

        guard case .attentionRequired(let reaffirmedPrompt) = try await service.respondToAttentionReturn(
            initialPrompt,
            answer: .no
        ) else {
            Issue.record("No must keep Attention active.")
            return
        }
        #expect(reaffirmedPrompt.expectedAttentionUpdatedAt > initialPrompt.expectedAttentionUpdatedAt)

        let correction = try await service.beginAttentionCorrection(reaffirmedPrompt)
        let cleared = try await service.submitAttentionCorrection(
            correction,
            change: .similar,
            comfort: .okay,
            safetyAnswer: nil
        )
        #expect(cleared == .ready(.upperMidBack))
        #expect(
            try await service.submitAttentionCorrection(
                correction,
                change: .similar,
                comfort: .okay,
                safetyAnswer: nil
            ) == .ready(.upperMidBack)
        )
        #expect(try await service.loadProductStartState() == .today(.upperMidBack))

        let persisted = try await fixture.snapshot()
        #expect(persisted.attentionStates.isEmpty)
        #expect(persisted.checkIns.count == ProductServiceFixture.attentionCorrectionCheckInCount)
        #expect(persisted.safetyEvents.map(\.kind) == [
            .attentionEntered,
            .attentionReaffirmed,
            .attentionClearedCorrection
        ])
        #expect(persisted.decisions.isEmpty)
    }

    @Test("Returned to usual clears only through Yes and safely replays")
    func returnedToUsualClear() async throws {
        let fixture = try ProductServiceFixture()
        defer { fixture.removeFiles() }
        let service = fixture.service
        try await fixture.completeOnboarding(area: .lowerBack)
        let draft = try await service.beginCheckIn()
        guard case .attentionRequired(let prompt) = try await service.submitPrimaryOnlyCheckIn(
            draft,
            change: .similar,
            comfort: .limited,
            safetyAnswer: .yes
        ) else {
            Issue.record("Expected Attention before the return answer.")
            return
        }

        #expect(try await service.respondToAttentionReturn(prompt, answer: .yes) == .ready(.lowerBack))
        #expect(try await service.respondToAttentionReturn(prompt, answer: .yes) == .ready(.lowerBack))
        _ = try await service.beginCheckIn()

        let persisted = try await fixture.snapshot()
        #expect(persisted.attentionStates.isEmpty)
        #expect(persisted.safetyEvents.map(\.kind) == [
            .attentionEntered,
            .attentionClearedReturnedToUsual
        ])
        #expect(persisted.decisions.isEmpty)
    }

    @Test("A triggering correction reaffirms Attention and creates no plan")
    func triggeringCorrectionReaffirmsAttention() async throws {
        let fixture = try ProductServiceFixture()
        defer { fixture.removeFiles() }
        let service = fixture.service
        try await fixture.completeOnboarding(area: .neck)
        let draft = try await service.beginCheckIn()
        guard case .attentionRequired(let prompt) = try await service.submitPrimaryOnlyCheckIn(
            draft,
            change: .worse,
            comfort: .good,
            safetyAnswer: .notSure
        ) else {
            Issue.record("Expected Attention before correction.")
            return
        }

        let correction = try await service.beginAttentionCorrection(prompt)
        guard case .attentionRequired(let nextPrompt) = try await service.submitAttentionCorrection(
            correction,
            change: .worse,
            comfort: .good,
            safetyAnswer: .yes
        ) else {
            Issue.record("A triggering correction must preserve Attention.")
            return
        }
        #expect(nextPrompt.area == .neck)

        let persisted = try await fixture.snapshot()
        #expect(persisted.attentionStates.map(\.area) == [.neck])
        #expect(persisted.safetyEvents.map(\.kind) == [
            .attentionEntered,
            .attentionReaffirmedCorrection
        ])
        #expect(persisted.decisions.isEmpty)
    }

    @Test("Pause Today is eligible once, creates no routine, and survives retry")
    func pauseToday() async throws {
        let fixture = try ProductServiceFixture()
        defer { fixture.removeFiles() }
        let service = fixture.service
        try await fixture.completeOnboarding(area: .neck)

        let draft = try await service.beginCheckIn()
        guard case .plan(let plan) = try await service.submitPrimaryOnlyCheckIn(
            draft,
            change: .similar,
            comfort: .limited,
            safetyAnswer: .no
        ) else {
            Issue.record("Expected a Gentle plan with Pause Today.")
            return
        }
        #expect(plan.recommendedLevel == .gentle)
        #expect(plan.pauseTodayAvailable)
        #expect(try await service.pauseToday(checkInID: plan.checkInID) == .neck)
        #expect(try await service.pauseToday(checkInID: plan.checkInID) == .neck)
        await #expect(throws: ProductFlowError.persistence(.conflictingWrite)) {
            _ = try await service.startRoutine(decisionID: plan.decisionID)
        }

        let persisted = try await fixture.snapshot()
        #expect(persisted.pauseTodayEvents.count == ProductServiceFixture.pauseTodayEventCount)
        #expect(persisted.routineSessions.isEmpty)
    }

    @Test("Routine controls preserve monotonic time, alternatives, skips, and terminal truth")
    func routineControls() async throws {
        let fixture = try ProductServiceFixture()
        defer { fixture.removeFiles() }
        let service = fixture.service
        let plan = try await fixture.makePlan(area: .neck)
        var routine = try await service.startRoutine(decisionID: plan.decisionID)

        await fixture.monotonicClock.advance(by: ProductServiceFixture.firstElapsedIncrement)
        routine = try await service.refreshRoutine(sessionID: routine.sessionID)
        #expect(routine.stepElapsedMilliseconds == ProductServiceFixture.firstElapsedIncrement)
        routine = try await service.pauseRoutine(sessionID: routine.sessionID)
        #expect(routine.status == .paused)
        await fixture.monotonicClock.advance(by: ProductServiceFixture.pausedClockIncrement)
        #expect(
            try await service.refreshRoutine(sessionID: routine.sessionID).stepElapsedMilliseconds ==
                ProductServiceFixture.firstElapsedIncrement
        )

        while routine.currentItem?.availableAlternatives.isEmpty != false {
            routine = try await service.resumeRoutine(sessionID: routine.sessionID)
            routine = try await service.advanceRoutine(
                sessionID: routine.sessionID,
                expectedStepIndex: routine.currentStepIndex
            )
            #expect(!routine.status.isTerminal)
            routine = try await service.pauseRoutine(sessionID: routine.sessionID)
        }
        guard let alternative = routine.currentItem?.availableAlternatives.first else {
            Issue.record("Expected the prototype snapshot to contain an approved alternative.")
            return
        }
        let alternativeResult = try await service.selectRoutineAlternative(
            sessionID: routine.sessionID,
            expectedStepIndex: routine.currentStepIndex,
            movementID: alternative.movementID
        )
        #expect(alternativeResult.status == .paused)
        #expect(alternativeResult.selectedAlternative?.movementID == alternative.movementID)
        #expect(
            try await service.selectRoutineAlternative(
                sessionID: routine.sessionID,
                expectedStepIndex: routine.currentStepIndex,
                movementID: alternative.movementID
            ).selectedAlternative?.movementID == alternative.movementID
        )

        routine = try await service.resumeRoutine(sessionID: routine.sessionID)
        routine = try await service.skipRoutineStep(
            sessionID: routine.sessionID,
            expectedStepIndex: routine.currentStepIndex,
            reason: .uncomfortable
        )
        #expect(routine.currentStepIndex > alternativeResult.currentStepIndex || routine.status.isTerminal)
        if !routine.status.isTerminal {
            routine = try await service.endRoutine(sessionID: routine.sessionID, forSafety: false)
        }
        #expect(routine.status == .stopped || routine.status == .completed)

        let persisted = try await fixture.snapshot()
        #expect(persisted.routineEvents.contains(where: { $0.kind == .paused }))
        #expect(persisted.routineEvents.contains(where: { $0.kind == .resumed }))
        #expect(persisted.routineEvents.contains(where: { $0.kind == .alternativeSelected }))
        #expect(persisted.routineEvents.contains(where: { $0.kind == .skipped }))
    }

    @Test("Relaunch restores an in-progress routine as paused without elapsed-time inflation")
    func relaunchRestoresPaused() async throws {
        let fixture = try ProductServiceFixture()
        defer { fixture.removeFiles() }
        let plan = try await fixture.makePlan(area: .lowerBack)
        let routine = try await fixture.service.startRoutine(decisionID: plan.decisionID)
        await fixture.monotonicClock.advance(by: ProductServiceFixture.uncommittedElapsedIncrement)

        let reopened = fixture.reopenedService()
        #expect(await reopened.initialState() == .foundationReady)
        guard case .unfinishedRoutine(let restored) = try await reopened.loadProductStartState() else {
            Issue.record("Expected an unfinished routine after relaunch.")
            return
        }
        #expect(restored.sessionID == routine.sessionID)
        #expect(restored.status == .paused)
        #expect(restored.stepElapsedMilliseconds == ProductServiceFixture.noCommittedElapsed)

        let persisted = try await fixture.snapshot()
        #expect(persisted.routineSessions.first?.status == .paused)
        #expect(persisted.routineEvents.last?.kind == .paused)
    }

    @Test("Something Feels Wrong pauses first and ends as safety-stopped without creating Attention")
    func safetyStop() async throws {
        let fixture = try ProductServiceFixture()
        defer { fixture.removeFiles() }
        let plan = try await fixture.makePlan(area: .upperMidBack)
        var routine = try await fixture.service.startRoutine(decisionID: plan.decisionID)
        await fixture.monotonicClock.advance(by: ProductServiceFixture.firstElapsedIncrement)

        routine = try await fixture.service.pauseRoutine(sessionID: routine.sessionID)
        #expect(routine.status == .paused)
        routine = try await fixture.service.endRoutine(
            sessionID: routine.sessionID,
            forSafety: true
        )
        #expect(routine.status == .safetyStopped)
        #expect(
            try await fixture.service.endRoutine(
                sessionID: routine.sessionID,
                forSafety: true
            ).status == .safetyStopped
        )
        try await fixture.service.submitFeedback(sessionID: routine.sessionID, response: .worse)

        let persisted = try await fixture.snapshot()
        #expect(persisted.attentionStates.isEmpty)
        #expect(persisted.routineEvents.suffix(ProductServiceFixture.safetyTerminalEventCount).map(\.kind) == [
            .paused,
            .safetyStopped
        ])
        #expect(persisted.feedbackSubmissions.first?.responses.first?.response == .worse)
    }

    @Test("Missing required assets block Start without partial playback")
    func missingAssetsBlockStart() async throws {
        let fixture = try ProductServiceFixture()
        defer { fixture.removeFiles() }
        let plan = try await fixture.makePlan(area: .neck)
        await fixture.catalogProvider.setAssetsAvailable(false)

        await #expect(throws: ProductFlowError.contentUnavailable) {
            _ = try await fixture.service.startRoutine(decisionID: plan.decisionID)
        }
        let persisted = try await fixture.snapshot()
        #expect(!persisted.routineSessions.contains(where: { !$0.status.isTerminal }))
        #expect(!persisted.routineEvents.contains(where: { $0.kind == .started }))
    }

    @Test("Missing assets on relaunch restore a paused routine that can only end incomplete")
    func missingAssetsOnRestore() async throws {
        let fixture = try ProductServiceFixture()
        defer { fixture.removeFiles() }
        let plan = try await fixture.makePlan(area: .lowerBack)
        let active = try await fixture.service.startRoutine(decisionID: plan.decisionID)
        await fixture.catalogProvider.setAssetsAvailable(false)

        let reopened = fixture.reopenedService()
        #expect(await reopened.initialState() == .foundationReady)
        guard case .unfinishedRoutine(let unavailable) = try await reopened.loadProductStartState() else {
            Issue.record("Expected an unfinished routine with unavailable content.")
            return
        }
        #expect(unavailable.sessionID == active.sessionID)
        #expect(unavailable.status == .paused)
        #expect(!unavailable.contentAvailable)
        await #expect(throws: ProductFlowError.contentUnavailable) {
            _ = try await reopened.resumeRoutine(sessionID: unavailable.sessionID)
        }
        #expect(
            try await reopened.endRoutine(
                sessionID: unavailable.sessionID,
                forSafety: false
            ).status == .stopped
        )
    }

    @Test("Skipping the final step completes once and retry cannot duplicate events")
    func finalSkipIsIdempotent() async throws {
        let fixture = try ProductServiceFixture()
        defer { fixture.removeFiles() }
        let plan = try await fixture.makePlan(area: .neck)
        var routine = try await fixture.service.startRoutine(decisionID: plan.decisionID)
        while !routine.isOnFinalStep {
            routine = try await fixture.service.advanceRoutine(
                sessionID: routine.sessionID,
                expectedStepIndex: routine.currentStepIndex
            )
        }
        let finalStepIndex = routine.currentStepIndex
        routine = try await fixture.service.skipRoutineStep(
            sessionID: routine.sessionID,
            expectedStepIndex: finalStepIndex,
            reason: .unclear
        )
        #expect(routine.status == .completed)
        let eventCount = try await fixture.snapshot().routineEvents.count

        #expect(
            try await fixture.service.skipRoutineStep(
                sessionID: routine.sessionID,
                expectedStepIndex: finalStepIndex,
                reason: .unclear
            ).status == .completed
        )
        #expect(try await fixture.snapshot().routineEvents.count == eventCount)
    }
}

private extension RoutinePresentation {
    var isOnFinalStep: Bool {
        currentStepIndex == totalStepCount - ProductServiceFixture.finalStepOffset
    }
}

private struct ProductServiceFixture {
    static let completedCheckInCount = 1
    static let planRevisionCount = 3
    static let attentionCorrectionCheckInCount = 2
    static let pauseTodayEventCount = 1
    static let firstElapsedIncrement: Int64 = 1_500
    static let pausedClockIncrement: Int64 = 9_000
    static let uncommittedElapsedIncrement: Int64 = 4_000
    static let noCommittedElapsed: Int64 = 0
    static let safetyTerminalEventCount = 2
    static let finalStepOffset = 1
    static let oneQualifyingOutcome = 1
    static let noQualifyingOutcomes = 0
    static let singleDecisionCount = 1
    static let singleParticipationDay = 1
    static let singleRecordedCheckIn = 1
    static let singleCompletedRoutine = 1
    static let expectedCancellationCount = 2
    static let expectedPermissionRequestCount = 1
    static let noPermissionRequests = 0
    static let orderedAreaPairs = BodyArea.allCases.flatMap { primary in
        BodyArea.allCases.filter { $0 != primary }.map { (primary, $0) }
    }

    static func reminderWindow() throws -> ReminderWindow {
        try ReminderWindow(startMinutes: morningStartMinutes, endMinutes: morningEndMinutes)
    }

    private static let morningStartMinutes = 8 * minutesPerHour
    private static let morningEndMinutes = 9 * minutesPerHour
    private static let minutesPerHour = 60

    let root: URL
    let location: KineoStoreLocation
    let monotonicClock: ManualRoutineMonotonicClock
    let catalogProvider: MutableInstalledCatalogProvider
    let reminderScheduler: InMemoryReminderScheduler
    let service: PrototypeProductService

    init() throws {
        root = FileManager.default.temporaryDirectory.appending(
            path: "KineoProductServiceTests-\(UUID().uuidString)",
            directoryHint: .isDirectory
        )
        location = KineoStoreLocation(applicationSupportURL: root)
        monotonicClock = ManualRoutineMonotonicClock()
        catalogProvider = MutableInstalledCatalogProvider()
        reminderScheduler = InMemoryReminderScheduler()
        service = PrototypeProductService(
            location: location,
            protectedData: AlwaysAvailableProtectedData(),
            storageProtector: NoOpKineoStorageProtector(),
            clock: FixedProductClock(),
            monotonicClock: monotonicClock,
            catalogProvider: catalogProvider,
            reminderScheduler: reminderScheduler
        )
    }

    func snapshot() async throws -> KineoDataSnapshot {
        let store = try await KineoGRDBStore.open(
            location: location,
            protectedData: AlwaysAvailableProtectedData(),
            storageProtector: NoOpKineoStorageProtector()
        )
        return try await store.loadSnapshot()
    }

    func completeOnboarding(area: BodyArea, secondaryArea: BodyArea? = nil) async throws {
        #expect(await service.initialState() == .foundationReady)
        try await service.confirmAdultEligibility()
        try await service.savePrimaryArea(area)
        try await service.saveSecondaryArea(secondaryArea)
        try await service.acknowledgeSafetyBoundary()
        _ = try await service.completeOnboarding()
    }

    func makePlan(area: BodyArea) async throws -> PlanPresentation {
        try await completeOnboarding(area: area)
        let draft = try await service.beginCheckIn()
        guard case .plan(let plan) = try await service.submitPrimaryOnlyCheckIn(
            draft,
            change: .similar,
            comfort: .okay,
            safetyAnswer: nil
        ) else {
            throw ProductFlowError.invalidState
        }
        return plan
    }

    func reopenedService(clock: any ProductClock = FixedProductClock()) -> PrototypeProductService {
        PrototypeProductService(
            location: location,
            protectedData: AlwaysAvailableProtectedData(),
            storageProtector: NoOpKineoStorageProtector(),
            clock: clock,
            monotonicClock: monotonicClock,
            catalogProvider: catalogProvider,
            reminderScheduler: reminderScheduler
        )
    }

    func removeFiles() {
        do {
            try FileManager.default.removeItem(at: root)
        } catch CocoaError.fileNoSuchFile {
            // A missing temporary directory is already the desired cleanup state.
        } catch {
            Issue.record("Failed to remove product-service test files: \(error)")
        }
    }
}

private actor MutableInstalledCatalogProvider: InstalledPrototypeCatalogProviding {
    private var assetsAvailable = true
    private var pairingsAvailable = true

    func load() async throws(InstalledPrototypeCatalogError) -> InstalledPrototypeCatalog {
        let installed = try InstalledPrototypeCatalogLoader.load()
        let catalog: RoutineCatalog
        do {
            catalog = pairingsAvailable ? installed.catalog : try RoutineCatalog.makeSigned(
                schemaVersion: installed.catalog.schemaVersion,
                catalogVersion: installed.catalog.catalogVersion,
                createdAt: installed.catalog.createdAt,
                buildEligibility: installed.catalog.buildEligibility,
                durationPolicies: installed.catalog.durationPolicies,
                movements: installed.catalog.movements,
                fragments: installed.catalog.fragments,
                primaryTemplates: installed.catalog.primaryTemplates,
                secondaryModules: installed.catalog.secondaryModules,
                compatibilityRules: installed.catalog.compatibilityRules.filter {
                    !($0.primaryArea == .lowerBack && $0.secondaryArea == .neck &&
                      $0.level == .balanced && $0.duration == .standard)
                }
            )
        } catch {
            throw .catalogInvalid(error)
        }
        guard !assetsAvailable else {
            return InstalledPrototypeCatalog(catalog: catalog, resources: installed.resources)
        }
        return InstalledPrototypeCatalog(
            catalog: catalog,
            resources: CatalogValidationResources(
                localizedStrings: installed.resources.localizedStrings,
                assetDigestsByPath: [:]
            )
        )
    }

    func setAssetsAvailable(_ available: Bool) {
        assetsAvailable = available
    }

    func setPairingsAvailable(_ available: Bool) {
        pairingsAvailable = available
    }
}

private actor InMemoryReminderScheduler: ReminderScheduling {
    private var authorization: ReminderAuthorization = .notDetermined
    private var scheduledWindow: ReminderWindow?
    private var scheduleFailure: ReminderServiceError?
    private var cancellationCount = 0
    private var permissionRequestCount = 0

    func authorizationStatus() async -> ReminderAuthorization { authorization }
    func requestAuthorization() async throws(ReminderServiceError) -> ReminderAuthorization {
        permissionRequestCount += 1
        authorization = .authorized
        return authorization
    }
    func replaceDailyReminder(
        window: ReminderWindow,
        timeZoneID: NonEmptyString
    ) async throws(ReminderServiceError) {
        if let scheduleFailure { throw scheduleFailure }
        scheduledWindow = window
    }
    func cancelAll() async throws(ReminderServiceError) {
        cancellationCount += 1
        scheduledWindow = nil
    }

    func setAuthorization(_ value: ReminderAuthorization) { authorization = value }
    func setScheduleFailure(_ value: ReminderServiceError?) { scheduleFailure = value }
    func snapshot() -> ReminderSchedulerSnapshot {
        ReminderSchedulerSnapshot(
            authorization: authorization,
            scheduledWindow: scheduledWindow,
            cancellationCount: cancellationCount,
            permissionRequestCount: permissionRequestCount
        )
    }
}

private struct ReminderSchedulerSnapshot: Sendable {
    let authorization: ReminderAuthorization
    let scheduledWindow: ReminderWindow?
    let cancellationCount: Int
    let permissionRequestCount: Int
}

private actor ManualRoutineMonotonicClock: RoutineMonotonicClock {
    private var value = ProductServiceFixture.noCommittedElapsed

    func nowMilliseconds() async -> Int64? {
        value
    }

    func advance(by milliseconds: Int64) {
        value += milliseconds
    }
}

private struct FixedProductClock: ProductClock {
    enum TestDay: String {
        case initial = "2026-08-17"
        case followingDay = "2026-08-18"
    }

    private let localDay: TestDay

    init(localDay: TestDay = .initial) {
        self.localDay = localDay
    }

    func now() -> ProductMoment? {
        guard let day = LocalDay(rawValue: localDay.rawValue),
              let timeZone = NonEmptyString(rawValue: "America/Chicago"),
              let calendar = NonEmptyString(rawValue: "gregorian") else {
            return nil
        }
        return ProductMoment(
            timestamp: TimestampMilliseconds(rawValue: 1_787_000_000_000),
            dayContext: LocalDayContext(
                localDay: day,
                timeZoneID: timeZone,
                calendarID: calendar
            )
        )
    }
}
