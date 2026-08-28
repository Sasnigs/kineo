import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KineoProductService } from '@/application/kineo-product-service';
import type { KineoPersistence } from '@/core/persistence/kineo-store';
import { systemProductRuntime } from '@/infrastructure/product/system-product-runtime';
import { expoReminderScheduler } from '@/infrastructure/reminders/expo-reminder-scheduler';
import { openProtectedKineoStore } from '@/infrastructure/persistence/open-protected-kineo-store';
import { colors, spacing, typography } from '@/ui/theme/tokens';

import { KineoProductApp } from './kineo-product-app';

type BootstrapState =
  | Readonly<{ kind: 'opening' }>
  | Readonly<{ kind: 'ready'; store: KineoPersistence }>
  | Readonly<{ kind: 'failed' }>;

let openingStore: Promise<Awaited<ReturnType<typeof openProtectedKineoStore>>> | undefined;
const systemProductClock = Object.freeze({
  nowMilliseconds: Date.now,
});

function openStore() {
  openingStore ??= openProtectedKineoStore(Date.now());
  return openingStore;
}

export function KineoAppBootstrap() {
  const [state, setState] = useState<BootstrapState>({ kind: 'opening' });
  const [generation, setGeneration] = useState(0);

  const boot = useCallback(async () => {
    setState({ kind: 'opening' });
    const result = await openStore();
    setState(result.ok ? { kind: 'ready', store: result.value } : { kind: 'failed' });
  }, []);

  useEffect(() => {
    let isActive = true;
    void openStore().then((result) => {
      if (!isActive) return;
      setState(result.ok ? { kind: 'ready', store: result.value } : { kind: 'failed' });
    });
    return () => {
      isActive = false;
    };
  }, [generation]);

  const service = useMemo(
    () => state.kind === 'ready'
      ? new KineoProductService(
          state.store,
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
      <KineoProductApp
        key={generation}
        service={service}
        onStoreRestartRequired={restartProtectedStore}
      />
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        <Text style={styles.title}>{state.kind === 'opening' ? 'Opening Kineo…' : 'Kineo needs another try.'}</Text>
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
