import * as AppleAuthentication from 'expo-apple-authentication';
import { useURL } from 'expo-linking';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { KineoAccountSession } from '../../application/account/kineo-account-session';
import type { LogoutRecoveryState } from '../../application/account/kineo-logout-workflow';
import type { KineoProductServing } from '../../application/kineo-product-service';
import { minimumPasswordCharacterCount } from '../../core/account/account-domain';
import type {
  AuthError,
  AuthState,
  ReauthenticationGrant,
} from '../../core/account/auth-module';
import type { PrivacyResult } from '../../core/account/account-privacy-module';
import type { ProductResult } from '../../core/product/product-flow';
import type { BootstrapState } from '../../core/account/sync-module';
import type { KineoAccountRuntime } from '../../infrastructure/account/kineo-account-runtime';
import { colors, layout, radius, spacing, typography } from '../theme/tokens';
import { KineoProductApp } from '../product/kineo-product-app';
import { PrototypeLegalDocuments } from './prototype-legal-documents';

type EntryState =
  | Readonly<{ kind: 'loading'; message: string }>
  | Readonly<{ kind: 'promise' }>
  | Readonly<{ kind: 'age' }>
  | Readonly<{ kind: 'ageUnavailable' }>
  | Readonly<{ kind: 'authentication' }>
  | Readonly<{ kind: 'verification'; email: string }>
  | Readonly<{ kind: 'passwordRecovery'; recoveryUrl: string }>
  | Readonly<{ kind: 'logoutRecovery'; recovery: Extract<LogoutRecoveryState, { kind: 'pending' }> }>
  | Readonly<{
      kind: 'legal';
      session: KineoAccountSession;
      bootstrap: BootstrapState;
    }>
  | Readonly<{
      kind: 'ready';
      session: KineoAccountSession;
      productService: KineoProductServing;
      offline: boolean;
    }>
  | Readonly<{ kind: 'error'; message: string; retry: () => void }>;

type AuthMode = 'options' | 'emailSignIn' | 'emailSignUp' | 'reset';

type Props = Readonly<{
  service: KineoProductServing;
  runtime: KineoAccountRuntime;
  createAuthorizedService(
    session: KineoAccountSession,
    offline: boolean,
  ): Promise<ProductResult<KineoProductServing>>;
  onStoreRestartRequired: () => void;
}>;

const accountCopy = Object.freeze({
  loading: 'Preparing your private Kineo space…',
  authenticating: 'Checking your account…',
  hydrating: 'Bringing your Kineo history up to date…',
  genericError: 'Kineo could not complete that securely. Please try again.',
  offlineInitial:
    'An internet connection is required the first time you sign in on this device.',
});

export function KineoAccountEntry({
  service,
  runtime,
  createAuthorizedService,
  onStoreRestartRequired,
}: Props) {
  const [state, setState] = useState<EntryState>({
    kind: 'loading',
    message: accountCopy.loading,
  });
  const [busy, setBusy] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('options');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [notice, setNotice] = useState<string>();
  const incomingUrl = useURL();

  const enterProduct = useCallback(async (
    session: KineoAccountSession,
    offline: boolean,
  ) => {
    const authorized = await createAuthorizedService(session, offline);
    if (!authorized.ok) {
      setState({
        kind: 'error',
        message: accountCopy.genericError,
        retry: onStoreRestartRequired,
      });
      return;
    }
    setNotice(undefined);
    setState({
      kind: 'ready',
      session,
      productService: authorized.value,
      offline,
    });
  }, [createAuthorizedService, onStoreRestartRequired]);

  const continueFromAuthState = useCallback(async (authState: AuthState) => {
    if (authState.kind === 'signedOut') {
      setState({ kind: 'authentication' });
      return;
    }
    if (authState.kind === 'verificationPending') {
      setState({ kind: 'verification', email: authState.email });
      return;
    }
    setState({ kind: 'loading', message: accountCopy.hydrating });
    const connected = await runtime.connect(
      authState.accountId,
      authState.provider,
    );
    if (!connected.ok) {
      setState({
        kind: 'error',
        message: accountCopy.genericError,
        retry: onStoreRestartRequired,
      });
      return;
    }
    const bootstrap = authState.kind === 'cached'
      ? { ok: false as const, error: { code: 'offline' as const } }
      : await connected.value.bootstrap();
    if (!bootstrap.ok) {
      const cached = await connected.value.cachedState();
      if (
        bootstrap.error.code === 'offline' &&
        cached.ok &&
        cached.value !== undefined &&
        cached.value.account.accountId === authState.accountId &&
        cached.value.account.status === 'active' &&
        connected.value.hasCurrentLegalAcceptances(cached.value)
      ) {
        await enterProduct(connected.value, true);
        return;
      }
      setState({
        kind: 'error',
        message: bootstrap.error.code === 'offline'
          ? accountCopy.offlineInitial
          : accountCopy.genericError,
        retry: onStoreRestartRequired,
      });
      return;
    }
    if (bootstrap.value.account.status === 'deleting') {
      const resumed = await connected.value.privacy.resumeDeletion();
      if (resumed.ok && resumed.value.kind === 'complete') {
        onStoreRestartRequired();
        return;
      }
      setState({
        kind: 'error',
        message: 'Account deletion is still in progress. Try again shortly.',
        retry: onStoreRestartRequired,
      });
      return;
    }
    if (connected.value.hasCurrentLegalAcceptances(bootstrap.value)) {
      await enterProduct(connected.value, false);
      return;
    }
    setState({
      kind: 'legal',
      session: connected.value,
      bootstrap: bootstrap.value,
    });
  }, [enterProduct, onStoreRestartRequired, runtime]);

  const restoreAuthentication = useCallback(async () => {
    setState({ kind: 'loading', message: accountCopy.authenticating });
    const restored = await runtime.auth.restoreSession();
    if (!restored.ok) {
      setState({
        kind: 'error',
        message: authErrorMessage(restored.error),
        retry: onStoreRestartRequired,
      });
      return;
    }
    await continueFromAuthState(restored.value);
  }, [continueFromAuthState, onStoreRestartRequired, runtime]);

  useEffect(() => {
    let active = true;
    const prepareEntry = async () => {
      const deletion = await runtime.resumePendingDeletion();
      if (!active) return;
      if (deletion.ok && deletion.value?.kind === 'complete') {
        onStoreRestartRequired();
        return;
      }
      if (!deletion.ok || deletion.value !== undefined) {
        setState({ kind: 'error',
          message: 'Account deletion is still in progress. Connect to the internet and try again.',
          retry: onStoreRestartRequired });
        return;
      }
      const logout = await runtime.resumePendingLogout();
      if (!active) return;
      if (logout.ok && logout.value.kind === 'complete') {
        onStoreRestartRequired();
        return;
      }
      if (!logout.ok || logout.value.kind === 'pending') {
        setState(logout.ok && logout.value.kind === 'pending'
          ? { kind: 'logoutRecovery', recovery: logout.value }
          : { kind: 'error',
          message: logoutRecoveryMessage(logout.ok ? logout.value : undefined),
          retry: onStoreRestartRequired });
        return;
      }
      if (incomingUrl !== null && isPasswordRecoveryUrl(incomingUrl)) {
        setState({ kind: 'passwordRecovery', recoveryUrl: incomingUrl });
        return;
      }
      if (incomingUrl !== null && isEmailVerificationUrl(incomingUrl)) {
        const result = await runtime.auth.completeEmailVerification(incomingUrl);
        if (!active) return;
        if (!result.ok) {
          setState({
            kind: 'error',
            message: authErrorMessage(result.error),
            retry: onStoreRestartRequired,
          });
          return;
        }
        await continueFromAuthState(result.value);
        return;
      }
      const result = await service.loadStartState();
      if (!active) return;
      if (!result.ok) {
        setState({ kind: 'error', message: accountCopy.genericError, retry: onStoreRestartRequired });
        return;
      }
      if (result.value.kind === 'onboarding' && result.value.progress.step === 'welcome') {
        setState({ kind: 'promise' });
      } else {
        await restoreAuthentication();
      }
    };
    void prepareEntry();
    return () => {
      active = false;
    };
  }, [
    continueFromAuthState,
    incomingUrl,
    onStoreRestartRequired,
    restoreAuthentication,
    runtime,
    service,
  ]);

  useEffect(() => {
    if (state.kind !== 'ready') return;
    const session = state.session;
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') return;
      void session.synchronizePending().then((result) => {
        if (!result.ok && result.error.code !== 'offline') {
          setNotice(accountCopy.genericError);
        }
      });
    });
    return () => subscription.remove();
  }, [state]);

  const runAuth = async (operation: () => ReturnType<typeof runtime.auth.signInWithApple>) => {
    setBusy(true);
    setNotice(undefined);
    const result = await operation();
    setBusy(false);
    if (!result.ok) {
      if (result.error.code !== 'cancelled') {
        setNotice(authErrorMessage(result.error));
      }
      return;
    }
    await continueFromAuthState(result.value);
  };

  if (state.kind === 'ready') {
    return (
      <View style={styles.flex}>
        {state.offline ? (
          <View accessibilityRole="alert" style={styles.offlineBanner}>
            <Text style={styles.offlineText}>
              Offline · your saved routine and history are available
            </Text>
          </View>
        ) : null}
        {notice === undefined ? null : (
          <View accessibilityRole="alert" style={styles.offlineBanner}>
            <Text style={styles.offlineText}>{notice}</Text>
          </View>
        )}
        <KineoProductApp
          service={state.productService}
          onStoreRestartRequired={onStoreRestartRequired}
          accountActions={{
            provider: state.session.provider,
            resetHistory: (password) => withReauthentication(
              runtime,
              state.session,
              password,
              async (grant) => privacyToProduct(
                await state.session.privacy.resetHistory(grant),
              ),
            ),
            exportData: (password) => withReauthentication(
              runtime,
              state.session,
              password,
              async (grant) => {
                const prepared = await state.session.privacy.requestExport(grant);
                if (!prepared.ok) return privacyToProduct(prepared);
                if (prepared.value.kind !== 'ready') {
                  return { ok: false, error: { code: 'accountUnavailable' } };
                }
                const downloaded = await state.session.privacy.downloadExport(
                  prepared.value,
                );
                if (!downloaded.ok) return privacyToProduct(downloaded);
                return privacyToProduct(
                  await runtime.exportSharer.share(downloaded.value),
                );
              },
            ),
            changePassword: async (currentPassword, newPassword) => {
              const changed = await runtime.auth.changePassword(
                currentPassword,
                newPassword,
              );
              return changed.ok
                ? { ok: true, value: undefined }
                : { ok: false, error: { code: 'accountUnavailable' } };
            },
            deleteAccount: (password) => withReauthentication(
              runtime,
              state.session,
              password,
              async (grant) => {
                const deleted = await state.session.privacy.deleteAccount(grant);
                return privacyToProduct(deleted, () => undefined);
              },
            ),
            logout: async (discardPendingChanges) => {
              setState({ kind: 'loading', message: 'Signing out securely…' });
              const result = await runtime.auth.logout(
                discardPendingChanges
                  ? 'discardPendingChanges'
                  : 'waitForSync',
              );
              if (!result.ok) {
                const recovery = await runtime.resumePendingLogout();
                if (!recovery.ok || recovery.value.kind === 'pending') {
                  setState(recovery.ok && recovery.value.kind === 'pending'
                    ? { kind: 'logoutRecovery', recovery: recovery.value }
                    : { kind: 'error',
                    message: logoutRecoveryMessage(recovery.ok ? recovery.value : undefined),
                    retry: onStoreRestartRequired });
                } else if (recovery.value.kind === 'complete') {
                  onStoreRestartRequired();
                } else {
                  // A failed pre-logout sync has not created recovery intent or
                  // removed data. Keep the account available for an explicit retry.
                  setState(state);
                }
              }
              return result.ok
                ? { ok: true, value: undefined }
                : { ok: false, error: { code: 'accountUnavailable' } };
            },
          }}
        />
      </View>
    );
  }

  if (state.kind === 'loading') {
    return (
      <AccountShell>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accentDark} />
          <Text style={styles.body}>{state.message}</Text>
        </View>
      </AccountShell>
    );
  }

  if (state.kind === 'error') {
    return (
      <AccountShell eyebrow="LET’S TRY THAT AGAIN" title="Your data stayed safe.">
        <Text style={styles.body}>{state.message}</Text>
        <ActionButton label="Retry" onPress={state.retry} />
      </AccountShell>
    );
  }

  if (state.kind === 'logoutRecovery') {
    const canSignIn = state.recovery.canReauthenticate === true && state.recovery.error.code === 'sessionExpired';
    const recover = async (method: Parameters<KineoAccountRuntime['reauthenticatePendingLogout']>[0]) => {
      setBusy(true);
      setNotice(undefined);
      const recovered = await runtime.reauthenticatePendingLogout(method);
      setBusy(false);
      setPassword('');
      if (!recovered.ok) {
        setNotice(recovered.error.code === 'reauthenticationRequired'
          ? 'Sign in with the same account that started signing out. No account data has been opened.'
          : authErrorMessage(recovered.error));
      } else if (recovered.value.kind === 'pending') {
        setState({ kind: 'logoutRecovery', recovery: recovered.value });
      } else {
        onStoreRestartRequired();
      }
    };
    return (
      <AccountShell eyebrow="SECURE SIGN-OUT" title={canSignIn ? 'Sign in to finish signing out' : 'Finish signing out'}>
        <Text style={styles.body}>{logoutRecoveryMessage(state.recovery)}</Text>
        {canSignIn ? <>
          <TextInput accessibilityLabel="Recovery email" placeholder="Email" autoCapitalize="none"
            autoComplete="email" keyboardType="email-address" style={styles.input} value={email} onChangeText={setEmail} />
          <TextInput accessibilityLabel="Recovery password" placeholder="Password" secureTextEntry
            autoComplete="current-password" style={styles.input} value={password} onChangeText={setPassword} />
          <ActionButton label="Use email to finish signing out" disabled={busy}
            onPress={() => void recover({ kind: 'email', credentials: { email, password } })} />
          <SecondaryButton label="Use Apple to finish signing out" disabled={busy}
            onPress={() => void recover({ kind: 'apple' })} />
          <SecondaryButton label="Use Google to finish signing out" disabled={busy}
            onPress={() => void recover({ kind: 'google' })} />
        </> : null}
        <SecondaryButton label="Retry" disabled={busy} onPress={onStoreRestartRequired} />
        {notice === undefined ? null : <Notice message={notice} />}
      </AccountShell>
    );
  }

  if (state.kind === 'promise') {
    return (
      <AccountShell eyebrow="MOVE WITH TODAY IN MIND" title="A routine shaped around how you feel now.">
        <View style={styles.promiseCard}>
          <Text style={styles.promiseText}>
            A brief check-in helps Kineo prepare a focused neck and back movement routine.
          </Text>
          <View style={styles.trustRow}>
            <Text style={styles.trustText}>Private account sync</Text>
            <Text style={styles.trustText}>No routine browsing</Text>
          </View>
        </View>
        <Text style={styles.caption}>
          General wellness guidance for adults—not diagnosis or medical care.
        </Text>
        <ActionButton label="Get started" onPress={() => setState({ kind: 'age' })} />
      </AccountShell>
    );
  }

  if (state.kind === 'age') {
    return (
      <AccountShell eyebrow="BEFORE WE BEGIN" title="Are you 18 or older?">
        <Text style={styles.body}>Kineo is currently designed for adults.</Text>
        <ActionButton
          label="Yes, I’m 18 or older"
          disabled={busy}
          onPress={() => void (async () => {
            setBusy(true);
            const result = await service.confirmAdultEligibility();
            setBusy(false);
            if (result.ok) {
              await restoreAuthentication();
            } else {
              setNotice(accountCopy.genericError);
            }
          })()}
        />
        <SecondaryButton
          label="No"
          onPress={() => setState({ kind: 'ageUnavailable' })}
        />
        {notice === undefined ? null : <Notice message={notice} />}
      </AccountShell>
    );
  }

  if (state.kind === 'ageUnavailable') {
    return (
      <AccountShell eyebrow="NOT AVAILABLE YET" title="Kineo is for adults right now.">
        <Text style={styles.body}>We can’t continue with setup.</Text>
        <SecondaryButton
          label="I answered by mistake"
          onPress={() => setState({ kind: 'age' })}
        />
      </AccountShell>
    );
  }

  if (state.kind === 'verification') {
    return (
      <AccountShell eyebrow="CHECK YOUR EMAIL" title="Verify your account">
        <Text style={styles.body}>
          Open the private verification link sent to {state.email}, then return to Kineo.
        </Text>
        <ActionButton label="I’ve verified my email" onPress={() => void restoreAuthentication()} />
        <SecondaryButton
          label="Resend email"
          onPress={() => void runSimpleAuthAction(
            () => runtime.auth.resendVerification(state.email),
            setBusy,
            setNotice,
          )}
        />
        {notice === undefined ? null : <Notice message={notice} />}
      </AccountShell>
    );
  }

  if (state.kind === 'passwordRecovery') {
    const passwordsMatch = password === passwordConfirmation;
    const passwordIsLongEnough = [...password].length >= minimumPasswordCharacterCount;
    return (
      <AccountShell eyebrow="SECURE RECOVERY" title="Choose a new password">
        <Text style={styles.body}>
          Use at least {minimumPasswordCharacterCount} characters. Passphrases and password managers work well.
        </Text>
        <TextInput
          autoCapitalize="none"
          autoComplete="new-password"
          onChangeText={setPassword}
          placeholder="New password"
          placeholderTextColor={colors.secondaryInk}
          secureTextEntry
          style={styles.input}
          value={password}
        />
        <TextInput
          autoCapitalize="none"
          autoComplete="new-password"
          onChangeText={setPasswordConfirmation}
          placeholder="Confirm new password"
          placeholderTextColor={colors.secondaryInk}
          secureTextEntry
          style={styles.input}
          value={passwordConfirmation}
        />
        <ActionButton
          disabled={busy || !passwordIsLongEnough || !passwordsMatch}
          label="Update password"
          onPress={() => void (async () => {
            setBusy(true);
            setNotice(undefined);
            const result = await runtime.auth.completePasswordReset(
              state.recoveryUrl,
              password,
            );
            setBusy(false);
            if (!result.ok) {
              setNotice(authErrorMessage(result.error));
              return;
            }
            setPassword('');
            setPasswordConfirmation('');
            await continueFromAuthState(result.value);
          })()}
        />
        {!passwordsMatch && passwordConfirmation.length > 0 ? (
          <Notice message="The passwords do not match." />
        ) : null}
        {notice === undefined ? null : <Notice message={notice} />}
      </AccountShell>
    );
  }

  if (state.kind === 'legal') {
    return (
      <AccountShell eyebrow="YOUR ACCOUNT" title="Review before continuing">
        <Text style={styles.body}>
          Kineo stores your wellness check-ins and routine history so they can follow your account across devices.
        </Text>
        <PrototypeLegalDocuments />
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: legalAccepted }}
          onPress={() => setLegalAccepted((value) => !value)}
          style={styles.checkboxRow}
        >
          <View style={[styles.checkbox, legalAccepted && styles.checkboxSelected]}>
            <Text style={styles.checkmark}>{legalAccepted ? '✓' : ''}</Text>
          </View>
          <Text style={styles.checkboxLabel}>
            I accept the Terms of Service and Privacy Policy for this internal prototype.
          </Text>
        </Pressable>
        <ActionButton
          label="Accept and continue"
          disabled={!legalAccepted || busy}
          onPress={() => void (async () => {
            setBusy(true);
            const result = await state.session.acceptCurrentLegalDocuments(
              'en-US',
              state.bootstrap,
            );
            setBusy(false);
            if (!result.ok) {
              setNotice(accountCopy.genericError);
              return;
            }
            await enterProduct(state.session, false);
          })()}
        />
        {notice === undefined ? null : <Notice message={notice} />}
      </AccountShell>
    );
  }

  return (
    <AccountShell eyebrow="WELCOME TO KINEO" title="Keep your progress with you">
      {runtime.usesDevelopmentServices ? (
        <View style={styles.developmentBadge}>
          <Text style={styles.developmentText}>INTERNAL TEST ACCOUNT</Text>
        </View>
      ) : null}
      {authMode === 'options' ? (
        <>
          {runtime.usesDevelopmentServices ? (
            <ActionButton
              label="Continue with test account"
              disabled={busy}
              onPress={() => void runAuth(() => runtime.auth.signInWithApple())}
            />
          ) : (
            <AppleAuthentication.AppleAuthenticationButton
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
              cornerRadius={radius.button}
              onPress={() => void runAuth(() => runtime.auth.signInWithApple())}
              style={styles.appleButton}
            />
          )}
          {!runtime.usesDevelopmentServices ? (
            <SecondaryButton
              label="Continue with Google"
              disabled={busy}
              onPress={() => void runAuth(() => runtime.auth.signInWithGoogle())}
            />
          ) : null}
          <SecondaryButton
            label="Continue with email"
            onPress={() => setAuthMode('emailSignIn')}
          />
        </>
      ) : (
        <>
          <TextInput
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            onChangeText={setEmail}
            placeholder="Email address"
            placeholderTextColor={colors.secondaryInk}
            style={styles.input}
            value={email}
          />
          {authMode !== 'reset' ? (
            <TextInput
              autoCapitalize="none"
              autoComplete={authMode === 'emailSignUp' ? 'new-password' : 'current-password'}
              onChangeText={setPassword}
              placeholder="Password"
              placeholderTextColor={colors.secondaryInk}
              secureTextEntry
              style={styles.input}
              value={password}
            />
          ) : null}
          {authMode === 'emailSignUp' ? (
            <Text style={styles.caption}>
              Use at least {minimumPasswordCharacterCount} characters. Passphrases and password managers work well.
            </Text>
          ) : null}
          <ActionButton
            disabled={busy}
            label={authMode === 'emailSignUp'
              ? 'Create account'
              : authMode === 'reset'
                ? 'Send reset link'
                : 'Sign in'}
            onPress={() => void (authMode === 'reset'
              ? runSimpleAuthAction(
                  () => runtime.auth.requestPasswordReset(email),
                  setBusy,
                  setNotice,
                  'If that account exists, a reset link is on its way.',
                )
              : runAuth(() => authMode === 'emailSignUp'
                  ? runtime.auth.signUpWithEmail({ email, password })
                  : runtime.auth.signInWithEmail({ email, password })))}
          />
          {authMode === 'emailSignIn' ? (
            <>
              <SecondaryButton label="Create an account" onPress={() => setAuthMode('emailSignUp')} />
              <SecondaryButton label="Forgot password?" onPress={() => setAuthMode('reset')} />
            </>
          ) : null}
          <SecondaryButton label="Back" onPress={() => setAuthMode('options')} />
        </>
      )}
      {notice === undefined ? null : <Notice message={notice} />}
      <Text style={styles.caption}>
        Your wellness history is private and is not included in email messages.
      </Text>
    </AccountShell>
  );
}

function AccountShell({
  eyebrow,
  title,
  children,
}: Readonly<{
  eyebrow?: string;
  title?: string;
  children: React.ReactNode;
}>) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.brandRow}>
            <View style={styles.brandDot} />
            <Text style={styles.brand}>Kineo</Text>
          </View>
          <View style={styles.content}>
            {eyebrow === undefined ? null : <Text style={styles.eyebrow}>{eyebrow}</Text>}
            {title === undefined ? null : (
              <Text accessibilityRole="header" style={styles.title}>{title}</Text>
            )}
            {children}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ActionButton({
  label,
  onPress,
  disabled = false,
}: Readonly<{ label: string; onPress: () => void; disabled?: boolean }>) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

function SecondaryButton({
  label,
  onPress,
  disabled = false,
}: Readonly<{ label: string; onPress: () => void; disabled?: boolean }>) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.secondaryButton,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Text style={styles.secondaryLabel}>{label}</Text>
    </Pressable>
  );
}

function Notice({ message }: Readonly<{ message: string }>) {
  return <Text accessibilityRole="alert" style={styles.notice}>{message}</Text>;
}

async function runSimpleAuthAction(
  operation: () => Promise<AuthResultVoid>,
  setBusy: (value: boolean) => void,
  setNotice: (value: string | undefined) => void,
  success = 'Check your email for the next step.',
) {
  setBusy(true);
  const result = await operation();
  setBusy(false);
  setNotice(result.ok ? success : authErrorMessage(result.error));
}

type AuthResultVoid = Awaited<ReturnType<KineoAccountRuntime['auth']['resendVerification']>>;

function authErrorMessage(error: AuthError): string {
  switch (error.code) {
    case 'offline':
      return 'Connect to the internet and try again.';
    case 'rateLimited':
      return 'Too many attempts. Wait a moment and try again.';
    case 'providerUnavailable':
      return 'That sign-in option is not available in this build.';
    case 'invalidInput':
      return `Enter a valid email and a password with at least ${minimumPasswordCharacterCount} characters.`;
    case 'verificationRequired':
      return 'Verify your email before signing in.';
    case 'invalidCredentials':
      return 'The email or password could not be verified.';
    case 'secureStorageUnavailable':
      return 'Secure storage is unavailable. Unlock this device and try again.';
    default:
      return accountCopy.genericError;
  }
}

function logoutRecoveryMessage(state: LogoutRecoveryState | undefined): string {
  if (state?.kind === 'pending' && state.error.code === 'sessionExpired') {
    return state.canReauthenticate
      ? 'The saved sign-out credential expired. Verify the same account to revoke this installation and finish signing out. This will not open your history or sign you back into Kineo.'
      : 'This older sign-out record has no verified account identity. Kineo cannot safely replace its credential; private history remains unavailable.';
  }
  return state?.kind === 'pending' && state.localWiped
    ? 'Signed out on this device. Connect to the internet to finish signing out securely.'
    : 'Signing out is not finished. Your private data is locked while Kineo retries secure cleanup.';
}

async function withReauthentication(
  runtime: KineoAccountRuntime,
  session: KineoAccountSession,
  password: string | undefined,
  operation: (
    grant: ReauthenticationGrant,
  ) => Promise<ProductResult<void>>,
): Promise<ProductResult<void>> {
  if (
    session.provider === 'email' &&
    !runtime.usesDevelopmentServices &&
    (password === undefined || password.length === 0)
  ) {
    return { ok: false, error: { code: 'accountUnavailable' } };
  }
  const reauthenticated = await runtime.auth.reauthenticate(
    session.provider === 'email'
      ? { kind: 'password', password: password ?? '' }
      : { kind: session.provider },
  );
  return reauthenticated.ok
    ? operation(reauthenticated.value)
    : { ok: false, error: { code: 'accountUnavailable' } };
}

function privacyToProduct<Input, Output = void>(
  result: PrivacyResult<Input>,
  transform: () => Output = () => undefined as Output,
): ProductResult<Output> {
  if (result.ok) return { ok: true, value: transform() };
  return {
    ok: false,
    error: {
      code: result.error.code === 'offline'
        ? 'onlineValidationRequired'
        : 'accountUnavailable',
    },
  };
}

function isPasswordRecoveryUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'kineo:' &&
      parsed.hostname === 'auth' &&
      parsed.pathname === '/reset';
  } catch {
    return false;
  }
}

function isEmailVerificationUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'kineo:' &&
      parsed.hostname === 'auth' &&
      parsed.pathname === '/callback';
  } catch {
    return false;
  }
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: colors.canvas },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.screenHorizontal,
    paddingVertical: spacing.screenVertical,
  },
  brandRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.compact },
  brandDot: {
    backgroundColor: colors.accent,
    borderRadius: radius.status,
    height: spacing.standard,
    width: spacing.standard,
  },
  brand: {
    color: colors.ink,
    fontSize: typography.subtitleSize,
    fontWeight: typography.displayWeight,
  },
  content: {
    alignSelf: 'center',
    flex: 1,
    gap: spacing.standard,
    justifyContent: 'center',
    maxWidth: layout.readableWidth,
    paddingVertical: spacing.section,
    width: '100%',
  },
  centered: { alignItems: 'center', gap: spacing.standard },
  eyebrow: {
    color: colors.accentDark,
    fontSize: typography.eyebrowSize,
    fontWeight: typography.strongWeight,
    letterSpacing: typography.eyebrowTracking,
  },
  title: {
    color: colors.ink,
    fontSize: typography.titleSize,
    fontWeight: typography.displayWeight,
    lineHeight: typography.titleLineHeight,
  },
  body: {
    color: colors.secondaryInk,
    fontSize: typography.bodySize,
    lineHeight: typography.bodyLineHeight,
  },
  caption: {
    color: colors.secondaryInk,
    fontSize: typography.captionSize,
    lineHeight: typography.captionLineHeight,
  },
  promiseCard: {
    backgroundColor: colors.forest,
    borderRadius: radius.hero,
    gap: spacing.roomy,
    padding: spacing.roomy,
  },
  promiseText: {
    color: colors.onDark,
    fontSize: typography.subtitleSize,
    fontWeight: typography.strongWeight,
    lineHeight: typography.subtitleLineHeight,
  },
  trustRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.compact },
  trustText: {
    backgroundColor: colors.accent,
    borderRadius: radius.status,
    color: colors.forest,
    fontSize: typography.captionSize,
    fontWeight: typography.strongWeight,
    overflow: 'hidden',
    paddingHorizontal: spacing.small,
    paddingVertical: spacing.compact,
  },
  actionButton: {
    alignItems: 'center',
    backgroundColor: colors.accentDeep,
    borderRadius: radius.button,
    justifyContent: 'center',
    minHeight: layout.controlMinimumHeight,
    paddingHorizontal: spacing.standard,
  },
  actionLabel: {
    color: colors.inverseInk,
    fontSize: typography.bodySize,
    fontWeight: typography.buttonWeight,
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.button,
    borderWidth: layout.borderWidth,
    justifyContent: 'center',
    minHeight: layout.controlMinimumHeight,
    paddingHorizontal: spacing.standard,
  },
  secondaryLabel: {
    color: colors.ink,
    fontSize: typography.bodySize,
    fontWeight: typography.buttonWeight,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.button,
    borderWidth: layout.borderWidth,
    color: colors.ink,
    fontSize: typography.bodySize,
    minHeight: layout.controlMinimumHeight,
    paddingHorizontal: spacing.standard,
  },
  appleButton: { height: layout.controlMinimumHeight, width: '100%' },
  checkboxRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.small,
    paddingVertical: spacing.compact,
  },
  checkbox: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: spacing.micro,
    borderWidth: layout.selectedBorderWidth,
    height: spacing.roomy,
    justifyContent: 'center',
    width: spacing.roomy,
  },
  checkboxSelected: { backgroundColor: colors.accentDeep, borderColor: colors.accentDeep },
  checkmark: { color: colors.inverseInk, fontWeight: typography.strongWeight },
  checkboxLabel: {
    color: colors.ink,
    flex: 1,
    fontSize: typography.detailSize,
    lineHeight: typography.detailLineHeight,
  },
  notice: {
    color: colors.danger,
    fontSize: typography.detailSize,
    lineHeight: typography.detailLineHeight,
  },
  developmentBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.attentionSurface,
    borderRadius: radius.status,
    paddingHorizontal: spacing.small,
    paddingVertical: spacing.micro,
  },
  developmentText: {
    color: colors.attentionInk,
    fontSize: typography.eyebrowSize,
    fontWeight: typography.strongWeight,
    letterSpacing: typography.eyebrowTracking,
  },
  offlineBanner: {
    backgroundColor: colors.attentionSurface,
    paddingHorizontal: spacing.screenHorizontal,
    paddingVertical: spacing.compact,
  },
  offlineText: {
    color: colors.attentionInk,
    fontSize: typography.captionSize,
    fontWeight: typography.strongWeight,
    textAlign: 'center',
  },
  disabled: { opacity: layout.disabledOpacity },
  pressed: { opacity: layout.pressedOpacity },
});
