import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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
import { colors, spacing, typography } from '@/ui/theme/tokens';

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
        createAuthorizedService={async (session) => {
          const accountStore = new AccountAwareKineoStore(
            state.local.store,
            session.accountId,
            session.installationId,
            session.sync,
            session.outbox,
            systemProductRuntime.nextIdentifier,
            Date.now,
            state.account.usesDevelopmentServices,
          );
          const synchronizedProfile = await accountStore.synchronizeCurrentProfile();
          if (!synchronizedProfile.ok) {
            return { ok: false, error: { code: 'accountUnavailable' } };
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
      <View style={styles.content}>
        <Text style={styles.title}>
          {state.kind === 'opening'
            ? 'Opening Kineo…'
            : state.kind === 'failed' && state.configurationMissing
              ? 'Account service configuration is missing.'
              : 'Kineo needs another try.'}
        </Text>
        {state.kind === 'failed' ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              openingStore = undefined;
              void boot();
            }}
          >
            <Text style={styles.retry}>Retry</Text>
          </Pressable>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.canvas },
  content: { flex: 1, gap: spacing.standard, justifyContent: 'center', padding: spacing.screenHorizontal },
  title: { color: colors.ink, fontSize: typography.bodySize, fontWeight: typography.strongWeight, textAlign: 'center' },
  retry: { color: colors.accentDark, fontSize: typography.bodySize, fontWeight: typography.buttonWeight, textAlign: 'center' },
});
