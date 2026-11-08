import { useEffect, useRef, useState } from 'react';
import { Appearance, StyleSheet, Text, TextInput, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { KineoProductServing } from '@/application/kineo-product-service';
import type { BodyArea } from '@/core/domain/selection-domain';
import type { ProfilePresentation, ProductResult } from '@/core/product/product-flow';
import { minimumPasswordCharacterCount } from '@/core/account/account-domain';
import type { AuthProvider } from '@/core/account/auth-module';
import { v11Colors as c, v11Typography as t, v11Spacing as s, v11Layout as l, v11Canvas as cv } from '../theme/tokens';
import { V11Shell, V11BrandMark, V11PageHeader, V11PrimaryButton, V11SecondaryButton, V11InlineTextAction,
  V11ChoiceRow, V11AreaEmblem, V11Emblem, V11NoticeCard, V11ListRow, V11FloatingTabBar, V11DestructiveButton } from '../primitives/kineo-v11-primitives';
import { V11Question, V11Topline, V11Checkline, areaDisplayNames, canvasParts } from '../primitives/kineo-v11-canvas-parts';

export type V11AccountActions = Readonly<{
  provider: AuthProvider;
  resetHistory(password?: string): Promise<ProductResult<void>>;
  prepareExport?(password?: string): Promise<ProductResult<void>>;
  shareExport?(): Promise<ProductResult<void>>;
  discardExport?(): void;
  exportData(password?: string): Promise<ProductResult<void>>;
  changePassword(current: string, replacement: string): Promise<ProductResult<void>>;
  deleteAccount(password?: string): Promise<ProductResult<void>>;
  logout(discard: boolean): Promise<ProductResult<void>>;
}>;
type Route = 'you'|'areas'|'goal'|'appearance'|'reminders'|'time'|'permission'|'reminderOn'|'blocked'|'security'|'password'|'passwordDone'|'data'|'privacy'|'export'|'exportReady'|'reset'|'resetDone'|'delete'|'deleted'|'signout'|'support'|'content';
const areas: readonly BodyArea[] = ['neck','upperMidBack','lowerBack'];
const goalOptions = [2,3,4] as const;
const minutesPerHour = 60;
const dayMinutes = 24 * minutesPerHour;
const morning = 8 * minutesPerHour;
const evening = 18 * minutesPerHour;
const appearanceKey = 'kineo.appearance.v11';
export async function restoreV11Appearance() {
  const choice = await SecureStore.getItemAsync(appearanceKey);
  if (choice === 'light' || choice === 'dark' || choice === 'system') Appearance.setColorScheme(choice === 'system' ? 'unspecified' : choice);
}
const unavailable = Promise.resolve<ProductResult<void>>({ok:false,error:{code:'accountUnavailable'}});
const instructions = ['A little space to begin','Room for movement and rest','A more regular check-in'];
export function V11Preferences({ initial, initialRoute = 'you', service, accountActions, onToday, onHistory, onRestart }: {
  initial: ProfilePresentation; initialRoute?: 'you'|'areas'; service: KineoProductServing; accountActions?: V11AccountActions;
  onToday: () => void; onHistory: () => void; onRestart: () => void;
}) {
  const actions=useRef(accountActions);useEffect(()=>{actions.current=accountActions;},[accountActions]);
  useEffect(()=>()=>{actions.current?.discardExport?.();},[]);
  const [profile,setProfile] = useState(initial);
  const [route,setRoute] = useState<Route>(initialRoute);
  const operationGate=useRef(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState<string>();
  const [primary,setPrimary] = useState(initial.profile.primaryArea);
  const [secondary,setSecondary] = useState(initial.profile.secondaryArea);
  const [password,setPassword] = useState('');
  const [replacement,setReplacement] = useState('');
  const [confirmation,setConfirmation] = useState('');
  const [appearance,setAppearance] = useState<'system'|'light'|'dark'>('system');
  const [savedAppearance,setSavedAppearance] = useState<'system'|'light'|'dark'>('system');
  useEffect(()=>{let live=true;void SecureStore.getItemAsync(appearanceKey).then(value=>{if(live&&(value==='system'||value==='light'||value==='dark')){setAppearance(value);setSavedAppearance(value);}},()=>{if(live)setError('Your appearance preference could not be read. Choose and save an appearance to try again.');});return()=>{live=false;};},[]);
  const [time,setTime] = useState('08:00');
  const [minutes,setMinutes] = useState(initial.reminderSettings?.window?.startMinutes ?? morning);
  const go = (next: Route) => { if((route==='export'||route==='exportReady')&&next!=='exportReady')accountActions?.discardExport?.(); setError(undefined); setPassword(''); setRoute(next); };
  const run = async <T,>(operation: () => Promise<ProductResult<T>>, success: (value: T) => void) => {
    if (operationGate.current) return;
    operationGate.current=true;setBusy(true); setError(undefined);
    try {
      const result = await operation();
      if (result.ok) success(result.value);
      else setError('We couldn’t confirm that change. Your previous state is preserved. Try again.');
    } finally { operationGate.current=false;setBusy(false); }
  };
  const tabbar = <V11FloatingTabBar active="profile" onSelect={tab => tab==='today'?onToday():tab==='progress'?onHistory():go('you')} />;
  const shell = (children: React.ReactNode, pinned?: React.ReactNode) => <V11Shell key={route} footerPlacement={route==='you'?'navigation':pinned?'pinned-actions':'flow'}
    bottomBar={route==='you'?tabbar:pinned}>{children}{error?<V11NoticeCard role="alert" tone="caution" message={error} />:null}</V11Shell>;
  const top = (back: Route='you',label='') => <V11Topline label={label} onBack={()=>go(back)} />;
  const heading = (context: string,title: string,lead?: string,notice=false) => <V11PageHeader kind={notice?'notice':'editorial'} context={context} title={title} lead={lead} />;
  const quiet=(label:string,next:Route)=><V11InlineTextAction label={label} onPress={()=>go(next)} />;
  const row=(label:string,subtitle:string,next?:Route,icon?:React.ComponentProps<typeof V11ListRow>['icon'])=><V11ListRow label={label} subtitle={subtitle} icon={icon} onPress={next?()=>go(next):undefined}/>;
  const passwordField = (label='Confirm your password',value=password,onChange=setPassword) => <View style={st.field}><Text style={canvasParts.title}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={onChange} autoCapitalize="none" autoCorrect={false} secureTextEntry autoComplete={label==='Confirm your password'||label==='Current password'?'current-password':'new-password'} placeholder={label==='Confirm your password'?'Current password':label} placeholderTextColor={c.textSecondary} style={st.input}/></View>;
  const requiresPassword = accountActions?.provider === 'email';
  const reminderOn = profile.reminderSettings?.enabled && ['authorized','provisional'].includes(profile.reminderAuthorization);
  const clockLabel = (value:number) => `${Math.floor(value/minutesPerHour)%12||12}:${String(value%minutesPerHour).padStart(2,'0')} ${value>=12*minutesPerHour?'PM':'AM'}`;
  const enable = () => void run(()=>service.enableReminder({startMinutes:minutes,endMinutes:Math.min(minutes+minutesPerHour,dayMinutes-1)}),value=>{
    setProfile(value); go(value.reminderSettings?.enabled?'reminderOn':value.reminderAuthorization==='denied'?'blocked':'reminders');
  });
  if(route==='you') return shell(<><V11BrandMark context="Your daily movement"/>{heading('Your space','Make it\nwork for you.')}
    <Text accessibilityRole="header" style={st.section}>Your routine</Text>
    <V11ListRow label="Focus areas" subtitle={[profile.profile.primaryArea,profile.profile.secondaryArea].filter((a):a is BodyArea=>Boolean(a)).map(a=>areaDisplayNames[a]).join(' · ')} leading={<V11AreaEmblem areas={[profile.profile.primaryArea,profile.profile.secondaryArea].filter((a):a is BodyArea=>Boolean(a))}/>} onPress={()=>go('areas')}/>
    {row('Weekly intention',`${profile.profile.weeklyGoalDays} days`,'goal','calendar-outline')}
    <Text accessibilityRole="header" style={st.section}>Preferences</Text>{row('Appearance',appearance==='system'?'Use device setting':appearance==='light'?'Light':'Dark','appearance','contrast-outline')}
    {row('Reminders',reminderOn?clockLabel(profile.reminderSettings?.window?.startMinutes??morning):'Off',reminderOn?'reminderOn':profile.reminderAuthorization==='denied'?'blocked':'reminders','notifications-outline')}
    <Text accessibilityRole="header" style={st.section}>Account &amp; data</Text>{row('Account security',`Signed in with ${accountActions?.provider??'a development account'}`,'security','lock-closed-outline')}{row('Privacy & your data','Export, reset, or delete','data','shield-checkmark-outline')}
    <Text accessibilityRole="header" style={st.section}>About Kineo</Text>{row('Safety & support','','support','help-circle-outline')}{row('About this guidance','Content and app information','content','information-circle-outline')}</>);
  if(route==='areas') return shell(<>{top()}{heading('Your routine','Choose your\nfocus areas.','One main area and an optional second area.')}
    {areas.map(area=><V11ChoiceRow key={area} role="checkbox" accessibilityLabel={areaDisplayNames[area]} accessibilityHint={primary===area?'Main focus':secondary===area?'Second area':'Not selected'} title={areaDisplayNames[area]} area leading={<V11AreaEmblem area={area}/>} detail={primary===area?'Main focus':secondary===area?'Second area':'Not selected'} selected={primary===area||secondary===area} disabled={busy}
      onPress={()=>{if(primary===area){setPrimary(secondary);setSecondary(undefined);}else if(secondary===area)setSecondary(undefined);else if(!primary)setPrimary(area);else setSecondary(area);}}/>)}
    <Text accessibilityLiveRegion="polite" style={canvasParts.fine}>{primary?`${areaDisplayNames[primary]} is your main focus.${secondary?` ${areaDisplayNames[secondary]} is your second area.`:''}`:'Choose a main focus.'}</Text>
    <V11NoticeCard title="History stays with its area" message="Changing your areas does not erase history or remove a current safety restriction."/></>,<V11PrimaryButton label={'Save areas'} onPress={()=>{if(primary)void run(()=>service.saveAreaPreferences(primary,secondary),value=>{setProfile(value);go('you');});}} disabled={busy || (!primary)}/>);
  if(route==='goal') return shell(<>{top()}<V11Question context="Your rhythm" title="An intention\nyou can adjust." initial={String(profile.profile.weeklyGoalDays)} options={goalOptions.map((days,index)=>({value:String(days),title:`${days} days a week`,detail:instructions[index]}))} cta="Save intention" disabled={busy} onContinue={value=>void run(()=>service.saveWeeklyGoalDays(Number(value)),()=>{setProfile({...profile,profile:{...profile.profile,weeklyGoalDays:Number(value)}});go('you');})}/><Text style={canvasParts.fine}>No broken streaks. Rest and intentional stops can be part of participating.</Text></>);
  if(route==='appearance')return shell(<><V11Topline onBack={()=>{setAppearance(savedAppearance);Appearance.setColorScheme(savedAppearance==='system'?'unspecified':savedAppearance);go('you');}}/>{heading('Appearance','At home\nin any light.')}<V11Question hideHeader editorial context="" title="Choose appearance" initial={appearance} options={[{value:'system',title:'System',detail:'Follow your device appearance'},{value:'light',title:'Light',detail:'A warm, clear canvas'},{value:'dark',title:'Dark',detail:'Quiet surfaces, clear contrast'}] as const} onSelectionChange={value=>{setAppearance(value);Appearance.setColorScheme(value==='system'?'unspecified':value);}} cta="Save appearance" onContinue={value=>{void(async()=>{setBusy(true);try{await SecureStore.setItemAsync(appearanceKey,value);setSavedAppearance(value);Appearance.setColorScheme(value==='system'?'unspecified':value);go('you');}catch{setError('Appearance could not be saved. Try again.');}finally{setBusy(false);}})();}} disabled={busy}/></>);
  if(route==='reminders')return shell(<>{top()}{heading('An optional nudge','A little reminder.\nOn your terms.','Choose a time before Kineo asks for notification access.')}<V11Question hideHeader editorial context="" title="Choose reminder preference" options={[{value:'morning',title:'Morning',detail:'8:00 AM'},{value:'evening',title:'Evening',detail:'6:00 PM'},{value:'none',title:'No reminder',detail:'You can return when you want'}]} onContinue={choice=>{if(choice==='none')void run(()=>service.disableReminder(),value=>{setProfile(value);go('you');});else{setMinutes(choice==='morning'?morning:evening);go('permission');}}} disabled={busy}/>{quiet('Choose a custom time','time')}</>);
  if(route==='time')return shell(<>{top('reminders')}{heading('Your reminder','When suits you?')}<View style={st.field}><Text style={canvasParts.title}>Daily reminder time</Text><TextInput accessibilityLabel="Daily reminder time" value={time} onChangeText={setTime} placeholder="08:00" keyboardType="numbers-and-punctuation" style={st.input}/></View><View style={st.soft}><Text style={canvasParts.title}>One gentle prompt.</Text><Text style={canvasParts.body}>You can turn it off at any time in You → Reminders.</Text></View>{<V11PrimaryButton label={'Use this time'} onPress={()=>{const match=/^(\d{1,2}):(\d{2})$/.exec(time);if(!match||Number(match[1])>=24||Number(match[2])>=minutesPerHour){setError('Enter a time in HH:MM format.');return;}setMinutes(Number(match[1])*minutesPerHour+Number(match[2]));go('permission');}} disabled={busy}/>}</>);
  if(route==='permission')return shell(<>{top('reminders')}<V11Emblem kind="notifications-outline"/>{heading(clockLabel(minutes),'Ready for\na gentle nudge?','Your device will ask whether Kineo can send notifications.',true)}{<V11PrimaryButton label={'Continue'} onPress={enable} disabled={busy}/>}{quiet('Not now','reminders')}</>);
  if(route==='reminderOn')return shell(<>{top()}<V11Emblem kind="notifications-outline"/>{heading('Reminder on',`A moment\nat ${clockLabel(profile.reminderSettings?.window?.startMinutes??minutes)}.`)}{row('Daily reminder','Enabled',undefined,'notifications-outline')}{row('Time',clockLabel(profile.reminderSettings?.window?.startMinutes??minutes),'time','time-outline')}<V11SecondaryButton label="Turn reminder off" disabled={busy} onPress={()=>void run(()=>service.disableReminder(),value=>{setProfile(value);go('reminders');})}/>{<V11PrimaryButton label={'Done'} onPress={()=>go('you')} disabled={busy}/>}</>);
  if(route==='blocked')return shell(<>{top()}<V11Emblem caution kind="notifications-off-outline"/>{heading('Notifications are off','No reminder\nhas been scheduled.','You can allow notifications in device settings, or keep using Kineo without them.',true)}{<V11PrimaryButton label={'Open device settings'} onPress={()=>void run(()=>service.openReminderSettings(),()=>go('reminders'))} disabled={busy}/>}{quiet('Keep reminders off','you')}</>);
  if(route==='security')return shell(<>{top()}{heading('Account','Your sign-in\nand security.')}{row('Sign-in method',accountActions?.provider==='email'?'Email':accountActions?.provider??'Development account',undefined,'mail-outline')}{requiresPassword?row('Change password','Confirm your current password','password','key-outline'):null}{row('Sign out','Your saved history stays with your account','signout','log-out-outline')}</>);
  if(route==='password')return shell(<>{top('security')}{heading('Account security','A new password.')}{passwordField('Current password')}{passwordField('New password',replacement,setReplacement)}{passwordField('Confirm new password',confirmation,setConfirmation)}{replacement!==confirmation&&confirmation?<V11NoticeCard role="alert" message="The passwords do not match."/>:null}{<V11PrimaryButton label={'Update password'} onPress={()=>void run(()=>accountActions?.changePassword(password,replacement)??unavailable,()=>{setReplacement('');setConfirmation('');go('passwordDone');})} disabled={busy || (!password||replacement.length<minimumPasswordCharacterCount||replacement!==confirmation)}/>}{quiet('Cancel','security')}</>);
  if(route==='passwordDone')return shell(<>{top('security')}<V11Emblem kind="shield-checkmark-outline"/>{heading('Updated','Your password\nhas changed.')}{<V11PrimaryButton label={'Back to account'} onPress={()=>go('security')} disabled={busy}/>}</>);
  if(route==='data')return shell(<>{top()}{heading('','Your data, your choice.','Review what each action changes before confirming.')}{row('Export my data','Download a copy of your data','export','download-outline')}{row('Reset history','Remove activity; keep preferences','reset','refresh-outline')}<Text style={canvasParts.fine}>Your areas, reminders, and any current safety restriction remain. Reset cannot bypass that restriction.</Text>{row('Read privacy overview','','privacy','shield-checkmark-outline')}<View style={st.destructive}><Text accessibilityRole="header" style={st.dangerTitle}>Permanent deletion</Text><Text style={canvasParts.body}>Delete your account and all its data. This cannot be undone.</Text><V11DestructiveButton label="Delete all data" onPress={()=>go('delete')}/></View></>);
  if(route==='privacy')return shell(<>{top('data')}{heading('Before you decide','Your information.\nYour choices.','A plain-language overview. Full policies remain available.')}{row('What you share','Check-ins, routine activity, and optional feedback',undefined,'person-outline')}{row('Why it is saved','To maintain your history and preferences',undefined,'time-outline')}{row('Your controls','Export, reset history, or delete your data',undefined,'shield-checkmark-outline')}<V11NoticeCard title="A safety exception" message="Resetting history does not clear a current safety restriction."/>{<V11PrimaryButton label={'Back to data controls'} onPress={()=>go('data')} disabled={busy}/>}</>);
  if(route==='export')return shell(<>{top('data')}{heading('Private export','Take a copy\nwith you.','Review what the export contains before sharing.')}{row('Your profile','Areas and preferences',undefined,'person-outline')}{row('Your history','Check-ins, routines, and responses',undefined,'journal-outline')}{requiresPassword?passwordField():null}<Text style={canvasParts.body}>A private JSON file opens in your device’s share sheet. The one-time server copy expires after 15 minutes.</Text>{<V11PrimaryButton label={'Create private export'} onPress={()=>void run(()=>accountActions?.prepareExport?.(password)??accountActions?.exportData(password)??unavailable,()=>go('exportReady'))} disabled={busy || (requiresPassword&&!password)}/>}{quiet('Cancel','data')}</>);
  if(route==='exportReady')return shell(<>{top('data')}<V11Emblem kind="document-outline"/>{heading('Ready to share','Your private\nexport is ready.')}<View style={st.soft}><Text style={canvasParts.title}>kineo-export.json</Text><Text style={canvasParts.body}>Contains personal check-in and routine history. Share only where you intend.</Text></View>{<V11PrimaryButton label={'Open share sheet'} onPress={()=>void run(()=>accountActions?.shareExport?.()??unavailable,()=>go('data'))} disabled={busy}/>}{quiet('Done','data')}</>);
  if(route==='reset')return shell(<>{top('data')}{heading('Reset history','Start a fresh\nhistory—not a\nnew account.',undefined,true)}<Text style={canvasParts.body}>This removes check-ins, plans, routines, feedback, and history.</Text><V11NoticeCard tone="caution" title="What stays" message="Your areas, reminder preference, and any current safety restriction remain. Reset cannot bypass that restriction."/>{requiresPassword?passwordField():null}<V11DestructiveButton label="Reset history" disabled={busy||(requiresPassword&&!password)} onPress={()=>void run(()=>accountActions?.resetHistory(password)??service.resetHistory(),()=>go('resetDone'))}/><V11SecondaryButton label="Keep my history" onPress={()=>go('data')}/></>);
  if(route==='resetDone')return shell(<>{top()}<V11Emblem kind="refresh-outline"/>{heading('History cleared','Your preferences\nare still here.','Your history has been reset. Any current safety restriction remains in place.')}{<V11PrimaryButton label={'Back to Today'} onPress={onToday} disabled={busy}/>}</>);
  if(route==='delete')return shell(<>{top('data')}{heading('Permanent deletion','Delete your\naccount and data?',undefined,true)}<V11NoticeCard tone="caution" title="This cannot be undone" message="Your profile, check-ins, routines, and responses will be deleted. Export a copy first if you want to keep your records."/><V11SecondaryButton label="Export a copy first" onPress={()=>go('export')}/>{requiresPassword?passwordField():null}<V11DestructiveButton label="Delete all data" disabled={busy||(requiresPassword&&!password)} onPress={()=>void run(async()=>{const result=await(accountActions?.deleteAccount(password)??service.deleteAllData());if(!result.ok&&result.error.code==='persistence')onRestart();return result;},()=>go('deleted'))}/><V11SecondaryButton label="Keep my account" onPress={()=>go('data')}/></>);
  if(route==='deleted')return shell(<><V11Emblem/>{heading('Deletion confirmed','Your account\nhas been deleted.','You’re signed out. Your previous history is no longer available in Kineo.',true)}{<V11PrimaryButton label={'Back to welcome'} onPress={onRestart} disabled={busy}/>}</>);
  if(route==='signout')return shell(<>{top('security')}{heading('Sign out','Your saved\nhistory stays\nwith your account.','You can sign back in to access it.')}{<V11PrimaryButton label={'Sign out'} onPress={()=>void run(()=>accountActions?.logout(false)??unavailable,onRestart)} disabled={busy}/>}<V11SecondaryButton label="Stay signed in" onPress={()=>go('security')}/></>);
  if(route==='support')return shell(<>{top()}{heading('A clear boundary','Here to guide.\nNot to diagnose.')}<Text style={canvasParts.body}>Kineo offers general wellness movement planning. It is not medical care or an emergency service.</Text><V11NoticeCard tone="caution" title="If something feels wrong" message="Stop the routine. Seek appropriate professional support when needed, and urgent or emergency services when the situation may be an emergency."/>{row('Product support','Contact details must be verified before release',undefined,'chatbubble-outline')}{row('Privacy & data','Your options and controls','data','shield-checkmark-outline')}{<V11PrimaryButton label={'Back to You'} onPress={()=>go('you')} disabled={busy}/>}</>);
  return shell(<>{top()}{heading('About the guidance','Clarity includes\nour limits.')}<View style={st.soft}><Text style={canvasParts.title}>Movement content</Text><Text style={canvasParts.body}>Names, demonstrations, alternatives, and cues require a documented review before public release.</Text></View>{row('Review status','Pending—not clinically endorsed',undefined,'information-circle-outline')}{row('Health app data','Not used to select or change these routines',undefined,'heart-outline')}{row('App version','Internal prototype',undefined,'information-circle-outline')}<V11Checkline>Show a reviewer, qualification, or review date only when it is real and documented.</V11Checkline></>);
}
const st=StyleSheet.create({
  section:{color:c.textPrimary,fontSize:t.sectionSize,lineHeight:t.sectionLineHeight,fontWeight:t.strongWeight,marginTop:s.small},
  soft:{backgroundColor:c.softWell,borderRadius:cv.choiceRadius,padding:s.standard,gap:s.small},
  field:{gap:s.compact},input:{backgroundColor:c.surface,color:c.textPrimary,minHeight:l.controlMinimumHeight,borderRadius:cv.inputRadius,padding:s.standard,fontSize:t.choiceSize},
  destructive:{borderTopWidth:l.borderWidth,borderTopColor:c.separator,paddingTop:s.roomy,marginTop:s.large,gap:s.small},
  dangerTitle:{color:c.destructive,fontSize:t.headingSize,fontWeight:t.semiboldWeight},
});
