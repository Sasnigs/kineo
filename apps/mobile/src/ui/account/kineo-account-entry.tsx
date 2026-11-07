import { useURL } from 'expo-linking';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { KineoAccountSession } from '../../application/account/kineo-account-session';
import type { LogoutRecoveryState } from '../../application/account/kineo-logout-workflow';
import type { KineoProductServing } from '../../application/kineo-product-service';
import { minimumPasswordCharacterCount } from '../../core/account/account-domain';
import type {
  AuthError,
  AuthState,
  ReauthenticationGrant,
} from '../../core/account/auth-module';
import type { PrivacyResult, PersonalDataExport } from '../../core/account/account-privacy-module';
import type { ProductResult } from '../../core/product/product-flow';
import type { BootstrapState } from '../../core/account/sync-module';
import type { KineoAccountRuntime } from '../../infrastructure/account/kineo-account-runtime';
import { colors, layout, spacing, typography, v11Layout, v11Typography, v11Canvas } from '../theme/tokens';
import { KineoProductApp } from '../product/kineo-product-app';
import { V11BrandMark, V11WelcomeArtwork, V11PageHeader, V11PrimaryButton,
  V11SecondaryButton, V11InlineTextAction, V11NoticeCard, V11Emblem, V11Shell, V11ListRow } from '../primitives/kineo-v11-primitives';
import { V11Question, V11Topline } from '../primitives/kineo-v11-canvas-parts';
import { createPrivateExportDraft } from './private-export-draft';
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

type AuthMode = 'options' | 'emailSignIn' | 'emailSignUp' | 'reset' | 'privacy' | 'resetSent' | 'policies';


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
  const preparedExport=useRef(createPrivateExportDraft<PersonalDataExport>());
  const exportAccountId=state.kind==='ready'?state.session.accountId:undefined;
  useEffect(()=>{const draft=preparedExport.current;if(state.kind!=='ready')draft.discard();return()=>{draft.discard();};},[state.kind,exportAccountId]);
  const [busy, setBusy] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('options');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [notice, setNotice] = useState<string>();
  const incomingUrl = useURL();

  const showAuthMode = (mode: AuthMode) => {
    setNotice(undefined);
    setAuthMode(mode);
  };

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
    if (runtime.usesDevelopmentServices) {
      const accepted = await connected.value.acceptCurrentLegalDocuments('en-US', bootstrap.value);
      if (!accepted.ok) {
        setState({ kind: 'error', message: accountCopy.genericError, retry: onStoreRestartRequired });
        return;
      }
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
          onBackToAccount={() => { showAuthMode('options'); setState({ kind: 'authentication' }); }}
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
            prepareExport: (password) => {
              const ticket=preparedExport.current.begin();
              return withReauthentication(runtime,state.session,password,async grant=>{
                if(!preparedExport.current.isCurrent(ticket))return {ok:false,error:{code:'invalidState'}};
                const prepared=await state.session.privacy.requestExport(grant);
                if(!prepared.ok)return privacyToProduct(prepared);
                if(!preparedExport.current.isCurrent(ticket)||prepared.value.kind!=='ready')return {ok:false,error:{code:'accountUnavailable'}};
                const downloaded=await state.session.privacy.downloadExport(prepared.value);
                if(!downloaded.ok)return privacyToProduct(downloaded);
                return preparedExport.current.retain(ticket,downloaded.value)?{ok:true,value:undefined}:{ok:false,error:{code:'invalidState'}};
              });
            },
            shareExport: async()=>{
              const data=preparedExport.current.current();
              if(!data)return {ok:false,error:{code:'invalidState'}};
              const result=await runtime.exportSharer.share(data);
              if(result.ok)preparedExport.current.discard();
              return privacyToProduct(result);
            },
            discardExport:()=>{preparedExport.current.discard();},
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
        <View accessibilityLiveRegion="polite" style={styles.centered}>
          <ActivityIndicator color={colors.accentDark} />
          <Text style={styles.body}>{state.message}</Text>
        </View>
      </AccountShell>
    );
  }

  if (state.kind === 'error') {
    return (
      <AccountShell eyebrow="Let’s try that again" title="Your data stayed safe.">
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
      <AccountShell eyebrow="Secure sign-out" title={canSignIn ? 'Sign in to finish signing out' : 'Finish signing out'}>
        <Text style={styles.body}>{logoutRecoveryMessage(state.recovery)}</Text>
        {canSignIn ? <>
          <Text style={styles.authFieldLabel}>Recovery email</Text>
          <TextInput accessibilityLabel="Recovery email" placeholder="Email" autoCapitalize="none"
            autoComplete="email" keyboardType="email-address" style={styles.input} value={email} onChangeText={setEmail} />
          <Text style={styles.authFieldLabel}>Recovery password</Text>
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
    return <AccountShell>
      <V11BrandMark context="Your daily movement" />
      <V11PageHeader title="Make room for how you feel today."
        lead="A short check-in. A considered plan. The freedom to take it gently." />
      <V11WelcomeArtwork />
      <ActionButton label="Find your starting point" onPress={() => setState({ kind: 'age' })} />
      <TextButton label="I already have an account" onPress={() => { showAuthMode('emailSignIn'); setState({ kind: 'authentication' }); }} />
      <Text style={[styles.caption, styles.centerText]}>For adults · General wellness, not medical care</Text>
    </AccountShell>;
  }
  if (state.kind === 'age') {
    return <AccountShell><V11Topline label="Before we begin" onBack={() => setState({ kind: 'promise' })} />
      <V11Question editorial context="A quick check" title={'Are you 18\nor older?'} helper="Kineo is currently available to adults."
        options={[{value:'yes',title:'Yes, I’m 18 or older',detail:'Continue to account setup'},
          {value:'no',title:'No, I’m under 18',detail:'Kineo is currently for adults only'}]}
        disabled={busy} onContinue={answer => {
          if (answer === 'no') { setState({ kind: 'ageUnavailable' }); return; }
          void (async () => { setBusy(true); const result = await service.confirmAdultEligibility(); setBusy(false);
            if (result.ok) { showAuthMode('options'); await restoreAuthentication(); }
            else setNotice(accountCopy.genericError);
          })();
        }} />
      <Text style={styles.caption}>We only need confirmation—not your date of birth.</Text>
      {notice ? <Notice message={notice} /> : null}
    </AccountShell>;
  }
  if (state.kind === 'ageUnavailable') {
    return <AccountShell><V11Topline onBack={() => setState({ kind: 'age' })} /><V11Emblem kind="leaf" />
      <V11PageHeader kind="notice" context="Not available yet" title={'Kineo is for\nadults right now.'} lead="We can’t continue with setup." />
      <SecondaryButton label="I answered by mistake" onPress={() => setState({ kind: 'age' })} />
      <Text style={styles.caption}>You haven’t created an account.</Text>
    </AccountShell>;
  }

  if (state.kind === 'verification') {
    return (
      <AccountShell eyebrow="Check your email" title="Verify your account">
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
      <AccountShell eyebrow="Secure recovery" title="Choose a new password">
        <Text style={styles.body}>
          Use at least {minimumPasswordCharacterCount} characters. Passphrases and password managers work well.
        </Text>
        <Text style={styles.authFieldLabel}>New password</Text>
        <TextInput
          accessibilityLabel="New password"
          autoCapitalize="none"
          autoComplete="new-password"
          onChangeText={setPassword}
          placeholder="New password"
          placeholderTextColor={colors.secondaryInk}
          secureTextEntry
          style={styles.input}
          value={password}
        />
        <Text style={styles.authFieldLabel}>Confirm new password</Text>
        <TextInput
          accessibilityLabel="Confirm new password"
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
    return <AccountShell>
      <V11Topline onBack={() => { showAuthMode('options'); setState({kind:'authentication'}); }} />
      <V11PageHeader context="Before you decide" title={'Your information.\nYour choices.'}
        lead="Read the Terms and Privacy Notice before continuing." />
      <PrototypeLegalDocuments />
      <Text style={styles.caption}>By continuing, you agree to the Terms and acknowledge the Privacy Notice.</Text>
      <ActionButton label="Agree and continue" disabled={busy} onPress={() => void (async () => {
        setBusy(true); setNotice(undefined);
        const result = await state.session.acceptCurrentLegalDocuments('en-US', state.bootstrap);
        setBusy(false);
        if (!result.ok) { setNotice(accountCopy.genericError); return; }
        await enterProduct(state.session, false);
      })()} />
      {notice ? <Notice message={notice} /> : null}
    </AccountShell>;
  }

  const open = (mode: AuthMode) => showAuthMode(mode);
  const back = () => authMode === 'options' ? setState({ kind: 'age' }) : open(authMode === 'emailSignUp' || authMode === 'privacy' ? 'options' : 'emailSignIn');
  const social = <>
    <SecondaryButton label="Continue with Apple" icon="logo-apple" disabled={busy || (!runtime.usesDevelopmentServices && !runtime.signInProviders?.apple)}
      onPress={() => void runAuth(() => runtime.auth.signInWithApple())} />
    <SecondaryButton label="Continue with Google" disabled={busy || (!runtime.usesDevelopmentServices && !runtime.signInProviders?.google)}
      onPress={() => void runAuth(() => runtime.auth.signInWithGoogle())} />
  </>;
  if (authMode === 'policies') return <AccountShell><V11Topline onBack={() => open('privacy')} />
    <V11PageHeader context="Full policies" title="Terms & Privacy" /><PrototypeLegalDocuments />
    <ActionButton label="Back to privacy overview" onPress={() => open('privacy')} />
  </AccountShell>;
  if (authMode === 'privacy') return <AccountShell><V11Topline onBack={back} />
    <V11PageHeader context="Before you decide" title={'Your information.\nYour choices.'}
      />
    <Text style={styles.body}>A plain-language overview. <Text accessibilityRole="link" onPress={() => open('policies')} style={styles.policyLink}>Full policies remain available.</Text></Text>
    <V11ListRow label="What you share" icon="create-outline" subtitle="Check-ins, routine activity, and optional feedback" />
    <V11ListRow label="Why it is saved" icon="archive-outline" subtitle="To maintain your history and preferences" />
    <V11ListRow label="Your controls" icon="options-outline" subtitle="Export, reset history, or delete your data" />
    <V11NoticeCard tone="caution" title="A safety exception" message="Resetting history does not clear a current safety restriction." />
    <ActionButton label="Back to account options" onPress={() => open('options')} />
    <Text style={styles.caption}>Policy copy must be matched to the production data practices before release.</Text>
  </AccountShell>;
  if (authMode === 'resetSent') return <AccountShell><V11Topline onBack={() => open('emailSignIn')} /><V11Emblem kind="mail" />
    <V11PageHeader context="Check your inbox" title={'Your next step\nis in your email.'}
      lead="If an account exists for that address, we’ll send instructions to reset your password." />
    <ActionButton label="Back to sign in" onPress={() => open('emailSignIn')} />
    <TextButton label="Use a different email" onPress={() => open('reset')} />
  </AccountShell>;
  const signingUp = authMode === 'emailSignUp';
  const resetting = authMode === 'reset';
  const signInError = authMode === 'emailSignIn' && notice !== undefined;
  return <AccountShell authLayout>
    <V11Topline onBack={authMode === 'emailSignIn' ? () => { if(signInError) open('emailSignIn'); else setState({kind:'promise'}); } : back} />
    <V11PageHeader kind={signInError ? 'notice' : 'editorial'}
      context={authMode === 'options' ? 'Your space' : signingUp ? 'Create account' : resetting ? 'Account access' : 'Welcome back'}
      title={authMode === 'options' ? 'Keep your\nhistory with you.' : signingUp ? 'A private place\nto begin.' : resetting ? 'Forgot your\npassword?' : signInError ? 'Let’s try that\nagain.' : 'Pick up\nwhere you are.'}
      lead={authMode === 'options' ? 'An account saves your check-ins, routines, and preferences across signed-in devices.' : resetting ? 'Enter your email to request a reset link.' : undefined} />
    {authMode === 'options' ? <>{social}<View style={styles.authDividerLine} />
      <ActionButton label="Continue with email" icon="mail-outline" onPress={() => open('emailSignUp')} />
      <Text style={styles.caption}>By continuing, you agree to the Terms and acknowledge the Privacy Notice.</Text>
      <V11ListRow label="Terms & Privacy" icon="shield-checkmark-outline" subtitle="Read before you continue" onPress={() => open('privacy')} />
      <TextButton label="Already a member? Sign in" onPress={() => open('emailSignIn')} />
    </> : <>
      <View style={styles.authField}><Text style={styles.authFieldLabel}>Email</Text>
        <TextInput accessibilityLabel="Email" placeholder="you@example.com" autoComplete="email" keyboardType="email-address"
          autoCapitalize="none" autoCorrect={false} style={styles.input} value={email} onChangeText={setEmail} />
      </View>
      {!resetting ? <View style={styles.authField}><Text style={styles.authFieldLabel}>Password</Text>
        <TextInput accessibilityLabel="Password" placeholder={signingUp ? 'At least 15 characters' : 'Your password'}
          autoComplete={signingUp ? 'new-password' : 'current-password'} secureTextEntry autoCapitalize="none"
          style={styles.input} value={password} onChangeText={setPassword} />
      </View> : null}
      {signingUp ? <View style={styles.authField}><Text style={styles.authFieldLabel}>Confirm password</Text>
        <TextInput accessibilityLabel="Confirm password" placeholder="Enter it again" autoComplete="new-password" secureTextEntry
          style={styles.input} value={passwordConfirmation} onChangeText={setPasswordConfirmation} />
      </View> : null}
      {notice ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.authError}>{notice}</Text> : null}
      <ActionButton label={resetting ? 'Send reset link' : signingUp ? 'Create account' : signInError ? 'Try again' : 'Sign in'}
        disabled={busy || (signingUp && (password !== passwordConfirmation || [...password].length < minimumPasswordCharacterCount))}
        onPress={() => void (async () => {
          if (resetting) { setBusy(true); setNotice(undefined); const result = await runtime.auth.requestPasswordReset(email); setBusy(false);
            if (result.ok) open('resetSent'); else setNotice(authErrorMessage(result.error));
          } else await runAuth(() => signingUp ? runtime.auth.signUpWithEmail({email,password}) : runtime.auth.signInWithEmail({email,password}));
        })()} />
      {signingUp ? <><Text style={styles.caption}>Your password is never used to personalize your routine.</Text>
        <TextButton label="Back to sign-in options" onPress={() => open('options')} /></>
        : resetting ? <TextButton label="Back to sign in" onPress={() => open('emailSignIn')} />
        : <><TextButton label={signInError ? 'Reset password' : 'Forgot password?'} onPress={() => open('reset')} />
          <View style={styles.authDividerLine} />{social}</>}
    </>}
    {authMode === 'options' && notice ? <Notice message={notice} /> : null}
  </AccountShell>;
}

function TextButton({ label, onPress, disabled = false, alignEnd = false }:
  Readonly<{ label: string; onPress: () => void; disabled?: boolean; alignEnd?: boolean }>) {
  return <V11InlineTextAction label={label} onPress={onPress} disabled={disabled}
    style={alignEnd ? styles.textButtonEnd : undefined} />;
}

function AccountShell({ eyebrow, title, subtitle, footer, children }: Readonly<{
  eyebrow?: string; title?: string; subtitle?: string; authLayout?: boolean;
  footer?: React.ReactNode; children: React.ReactNode;
}>) {
  return <V11Shell progressiveFade={false}>
    {title ? <V11PageHeader context={eyebrow} title={title} lead={subtitle} /> : null}
    {children}{footer}
  </V11Shell>;
}

const ActionButton = V11PrimaryButton;
const SecondaryButton = V11SecondaryButton;
function Notice({ message }: Readonly<{ message: string }>) {
  return <V11NoticeCard message={message} role="alert" />;
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
      return 'We couldn’t sign you in. Check your email and password.';
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
  authError: { color: colors.danger, fontSize: v11Typography.bodySize, lineHeight: v11Typography.bodyLineHeight },
  policyLink: { color: colors.accentDark, textDecorationLine: 'underline' },
  centerText: { textAlign: 'center' },
  flex: { flex: 1 },
  authField: { gap: spacing.compact },
  authFieldLabel: {
    color: colors.ink,
    fontSize: typography.detailSize,
    fontWeight: typography.strongWeight,
    lineHeight: typography.detailLineHeight,
  },
  authDividerLine: {
    backgroundColor: colors.border,
    height: layout.borderWidth,
  },
  textButtonEnd: { alignSelf: 'flex-end' },
  centered: { alignItems: 'center', gap: spacing.standard },
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
  input: {
    backgroundColor: colors.surface,
    borderRadius: v11Canvas.inputRadius,
    borderWidth: 0,
    shadowColor: colors.shadow, shadowOpacity: v11Layout.cardShadowOpacity,
    shadowOffset: { width: 0, height: v11Layout.cardShadowOffsetY }, shadowRadius: v11Layout.cardShadowRadius,
    color: colors.ink,
    fontSize: v11Typography.choiceSize,
    minHeight: layout.controlMinimumHeight,
    paddingVertical: spacing.controlVertical,
    paddingHorizontal: spacing.standard,
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
});
