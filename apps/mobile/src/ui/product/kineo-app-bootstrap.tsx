import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KineoProductService } from '@/application/kineo-product-service';
import {
  createKineoAccountRuntime,
  type KineoAccountRuntime,
} from '@/infrastructure/account/kineo-account-runtime';
import { KineoCloudPlanAuthority } from '@/application/account/kineo-plan-authority';
import { AccountAwareKineoStore } from '@/infrastructure/account/account-aware-kineo-store';
import { systemProductRuntime } from '@/infrastructure/product/system-product-runtime';
import { expoReminderScheduler } from '@/infrastructure/reminders/expo-reminder-scheduler';
import {
  openProtectedKineoLocalRuntime,
  type OpenedKineoLocalRuntime,
} from '@/infrastructure/persistence/open-protected-kineo-store';
import { colors, layout, spacing } from '@/ui/theme/tokens';

import { V11BrandMark, V11PageHeader, V11PrimaryButton, V11NoticeCard } from '../primitives/kineo-v11-primitives';
import { KineoAccountEntry } from '../account/kineo-account-entry';

type BootstrapState =
  | Readonly<{ kind: 'opening' }>
  | Readonly<{
      kind: 'ready';
      local: OpenedKineoLocalRuntime;
      account: KineoAccountRuntime;
    }>
  | Readonly<{ kind: 'failed'; configurationMissing: boolean }>;

type OpenResult =
  | Readonly<{
      ok: true;
      value: {
        local: OpenedKineoLocalRuntime;
        account: KineoAccountRuntime;
      };
    }>
  | Readonly<{
      ok: false;
      configurationMissing: boolean;
    }>;

let openingStore: Promise<OpenResult> | undefined;
const systemProductClock = Object.freeze({
  nowMilliseconds: Date.now,
});

function openStore() {
  openingStore ??= (async (): Promise<OpenResult> => {
    const local = await openProtectedKineoLocalRuntime(Date.now());
    if (!local.ok) return { ok: false, configurationMissing: false };
    const account = await createKineoAccountRuntime(local.value);
    if (!account.ok) {
      return {
        ok: false,
        configurationMissing: account.error.code === 'configurationMissing',
      };
    }
    return { ok: true, value: { local: local.value, account: account.value } };
  })();
  return openingStore;
}

export function KineoAppBootstrap() {
  const [state, setState] = useState<BootstrapState>({ kind: 'opening' });
  const [generation, setGeneration] = useState(0);

  const boot = useCallback(async () => {
    setState({ kind: 'opening' });
    const result = await openStore();
    setState(result.ok
      ? { kind: 'ready', ...result.value }
      : {
          kind: 'failed',
          configurationMissing: result.configurationMissing,
        });
  }, []);

  useEffect(() => {
    let isActive = true;
    void openStore().then((result) => {
      if (!isActive) return;
      setState(result.ok
        ? { kind: 'ready', ...result.value }
        : {
            kind: 'failed',
            configurationMissing: result.configurationMissing,
          });
    });
    return () => {
      isActive = false;
    };
  }, [generation]);

  const service = useMemo(
    () => state.kind === 'ready'
      ? new KineoProductService(
          state.local.store,
          systemProductClock,
          systemProductRuntime,
          expoReminderScheduler,
        )
      : undefined,
    [state],
  );

  const restartProtectedStore = () => {
    openingStore = undefined;
    setGeneration((value) => value + 1);
  };

  if (state.kind === 'ready' && service !== undefined) {
    return (
      <KineoAccountEntry
        key={generation}
        runtime={state.account}
        service={service}
        createAuthorizedService={async (session, offline) => {
          const accountStore = new AccountAwareKineoStore(
            state.local.store,
            session.accountId,
            session.installationId,
            session.sync,
            session.outbox,
            systemProductRuntime.nextIdentifier,
            Date.now,
            state.account.usesDevelopmentServices,
            state.local.accountWriter(session.accountId, session.installationId),
          );
          if (!offline) {
            const synchronizedProfile = await accountStore.synchronizeCurrentProfile();
            if (!synchronizedProfile.ok) {
              return { ok: false, error: { code: 'accountUnavailable' } };
            }
          }
          return {
            ok: true,
            value: new KineoProductService(
              accountStore,
              systemProductClock,
              systemProductRuntime,
              expoReminderScheduler,
              new KineoCloudPlanAuthority(
                session.accountId,
                session.installationId,
                session.sync,
                session.outbox,
                systemProductRuntime.nextIdentifier,
                Date.now,
              ),
            ),
          };
        }}
        onStoreRestartRequired={restartProtectedStore}
      />
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <V11BrandMark />
        <V11PageHeader title={
          state.kind === 'opening'
            ? 'Opening Kineo…'
            : state.kind === 'failed' && state.configurationMissing
              ? 'Account service configuration is missing.'
              : 'Kineo needs another try.'} />
        {state.kind === 'opening' ? <View accessibilityLiveRegion="polite" accessibilityLabel="Opening Kineo"><ActivityIndicator color={colors.accentDark} /></View> : null}
        {state.kind === 'failed' ? (
          <>
            <V11NoticeCard message={state.configurationMissing
              ? 'Configure account services for this build, then try again.'
              : 'Unlock your device and try opening Kineo again.'} tone="caution" />
            <V11PrimaryButton label="Retry" onPress={() => { openingStore = undefined; void boot(); }} />
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.canvas },
  content: { flexGrow: 1, gap: spacing.roomy, justifyContent: 'center', padding: spacing.screenHorizontal, maxWidth: layout.readableWidth, alignSelf: 'center', width: '100%' },
});
