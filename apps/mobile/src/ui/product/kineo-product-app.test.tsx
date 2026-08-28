import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { describe, expect, it, jest } from '@jest/globals';

import type { KineoProductServing } from '@/application/kineo-product-service';
import type { BodyArea } from '@/core/domain/selection-domain';
import type { ProductStartState } from '@/core/product/product-flow';

import { KineoProductApp } from './kineo-product-app';

class OnboardingService implements KineoProductServing {
  private state: ProductStartState = {
    kind: 'onboarding',
    progress: { step: 'welcome' },
  };

  async loadStartState() {
    return { ok: true as const, value: this.state };
  }

  async confirmAdultEligibility() {
    this.state = { kind: 'onboarding', progress: { step: 'primaryArea' } };
    return { ok: true as const, value: undefined };
  }

  async savePrimaryArea(area: BodyArea) {
    this.state = {
      kind: 'onboarding',
      progress: { step: 'secondaryArea', primaryArea: area },
    };
    return { ok: true as const, value: undefined };
  }

  async saveSecondaryArea() {
    this.state = {
      kind: 'onboarding',
      progress: { step: 'safetyBoundary', primaryArea: 'neck' },
    };
    return { ok: true as const, value: undefined };
  }

  async acknowledgeSafetyBoundary() {
    this.state = {
      kind: 'onboarding',
      progress: { step: 'firstCheckIn', primaryArea: 'neck' },
    };
    return { ok: true as const, value: undefined };
  }

  async completeOnboarding() {
    this.state = { kind: 'today', primaryArea: 'neck' };
    return { ok: true as const, value: 'neck' as const };
  }

  async resetHistory() {
    return { ok: true as const, value: undefined };
  }

  async deleteAllData() {
    return { ok: true as const, value: undefined };
  }
}

describe('Kineo product app', () => {
  it('runs the complete durable onboarding flow', async () => {
    const view = await render(
      <KineoProductApp service={new OnboardingService()} onDeleted={() => undefined} />,
    );

    await view.findByText('A routine shaped around how you feel now.');
    await fireEvent.press(view.getByRole('button', { name: 'Get started' }));
    expect(view.getByText('Are you 18 or older?')).toBeTruthy();

    await fireEvent.press(view.getByRole('button', { name: 'Yes, I’m 18 or older' }));
    await view.findByText('Where would you like to start?');
    await fireEvent.press(view.getByRole('radio', { name: 'Neck' }));
    await fireEvent.press(view.getByRole('button', { name: 'Continue' }));

    await view.findByText('Anything else to include?');
    await fireEvent.press(view.getByRole('button', { name: 'Just focus on my main area' }));
    await view.findByText('You stay in control.');
    await fireEvent.press(view.getByRole('button', { name: 'I understand' }));

    await view.findByText('Let’s make this useful.');
    await fireEvent.press(view.getByRole('button', { name: 'Continue to Today' }));
    await view.findByText('How are you moving?');
    expect(view.getByRole('button', { name: 'Check in' })).toBeTruthy();
  });

  it('calls the testing reset only after deletion succeeds', async () => {
    const service = new OnboardingService();
    await service.confirmAdultEligibility();
    await service.savePrimaryArea('neck');
    await service.saveSecondaryArea();
    await service.acknowledgeSafetyBoundary();
    await service.completeOnboarding();
    const onDeleted = jest.fn();
    const view = await render(<KineoProductApp service={service} onDeleted={onDeleted} />);

    await view.findByText('How are you moving?');
    await fireEvent.press(view.getByRole('button', { name: 'Reset demo to first use' }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
  });
});
