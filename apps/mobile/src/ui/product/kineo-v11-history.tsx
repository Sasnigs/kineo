import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { KineoProductServing } from '@/application/kineo-product-service';
import type { BodyArea } from '@/core/domain/selection-domain';
import type { ProgressPresentation, SessionDetailPresentation } from '@/core/product/product-flow';
import type { RoutineSessionId } from '@/core/content/routine-session-snapshot';
import { v11Colors as c, v11Spacing as s, v11Layout as l, v11Typography as t, v11Canvas as cv } from '../theme/tokens';
import { V11Shell, V11PageHeader, V11BrandMark, V11Emblem, V11AreaEmblem, V11FloatingTabBar, V11InlineTextAction, V11PrimaryButton, V11ListRow, V11NoticeCard } from '../primitives/kineo-v11-primitives';
import { V11Topline, V11Checkline, areaDisplayNames, canvasParts } from '../primitives/kineo-v11-canvas-parts';
const dateFormat = new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'long'});
const timeFormat = new Intl.DateTimeFormat('en-GB',{hour:'numeric',minute:'2-digit'});
const daysPerWeek=7;
const dateLabel=(day:string)=>dateFormat.format(new Date(`${day}T12:00:00`));
const level=(value:string)=>value.charAt(0).toUpperCase()+value.slice(1);
const historyNote='Events appear together as history. Kineo does not claim one caused another.';
export function V11History({progress,initialArea,initialSession,service,onToday,onYou}:{progress:ProgressPresentation;initialArea?:BodyArea;initialSession?:RoutineSessionId;service:KineoProductServing;onToday:()=>void;onYou:()=>void}) {
  const [area,setArea]=useState(initialArea);
  const [session,setSession]=useState(initialSession);
  const [detail,setDetail]=useState<SessionDetailPresentation>();
  const [failed,setFailed]=useState(false);
  const [loading,setLoading]=useState(Boolean(initialSession));
  const [locked,setLocked]=useState(false);
  const {fontScale}=useWindowDimensions();
  const stacked=fontScale>l.fixedBottomBarMaximumFontScale;
  useEffect(()=>{if(!session)return;let live=true;void(service.loadSessionDetail?.(session)??Promise.resolve({ok:false as const})).then(result=>{if(!live)return;setLoading(false);if(result.ok)setDetail(result.value);else setFailed(true);});return()=>{live=false;};},[session,service]);
  const tabs=<V11FloatingTabBar active="progress" onSelect={tab=>tab==='today'?onToday():tab==='profile'?onYou():(setArea(undefined),setSession(undefined),setLocked(false))}/>;
  const shell=(children:React.ReactNode)=><V11Shell footerPlacement="navigation" bottomBar={tabs}>{children}</V11Shell>;
  const summary=<View style={st.summary}><Text style={canvasParts.title}>{progress.weeklyParticipationDayCount} of {progress.weeklyGoalDays} days this week</Text><Text style={canvasParts.fine}>Completed routines, eligible pauses, and stops count equally.</Text></View>;
  const entries=(selected?:BodyArea)=>{
    const sessions=progress.recentSessions.filter(record=>!selected||record.areas.includes(selected)).map(record=>({key:record.sessionId,day:record.localDay,time:record.occurredAtMilliseconds?timeFormat.format(record.occurredAtMilliseconds):'',title:record.status==='completed'?`${level(record.deliveredLevel)} routine completed`:record.status==='stopped'?'Chose to stop early':record.status==='safetyStopped'?'Routine stopped for safety':record.status==='paused'?'Routine paused':record.status==='inProgress'?'Routine in progress':record.status==='prepared'?'Routine prepared':'Routine not started',body:[record.duration?level(record.duration):'',record.areas.map(a=>areaDisplayNames[a]).join(' · ')].filter(Boolean).join(' · '),action:()=>{setDetail(undefined);setLoading(true);setFailed(false);setSession(record.sessionId);},link:'View session'}));
    const checkins=progress.areas.filter(record=>!selected||record.area===selected).flatMap(record=>record.history.map((entry,index)=>({key:`${record.area}-${entry.localDay}-${index}`,day:entry.localDay,time:'',title:`${areaDisplayNames[record.area]} check-in`,body:`${entry.changeReport==='similar'?'About your usual pattern':entry.changeReport==='better'?'Better than usual':'Worse than usual'} · ${level(entry.movementComfort)} movement`,action:()=>setArea(record.area),link:'View area history'})));
    const sorted=[...sessions,...checkins].sort((a,b)=>b.day.localeCompare(a.day));
    return sorted.map((entry,index)=><View key={entry.key}>{index===0||entry.day!==sorted[index-1]?.day?<Text accessibilityRole="header" style={st.date}>{entry.day===progress.currentLocalDay?'Today, ':''}{dateLabel(entry.day)}</Text>:null}
      <View style={[st.entry,stacked&&st.stacked]}>{entry.time?<Text style={st.time}>{entry.time}</Text>:null}<View style={st.copy}><Text style={st.entryTitle}>{entry.title}</Text><Text style={canvasParts.fine}>{entry.body}</Text>{selected&&entry.link==='View area history'?null:<V11InlineTextAction label={entry.link} onPress={entry.action}/>}</View></View></View>);
  };
  if(session)return shell(<><V11Topline label={detail?dateLabel(detail.localDay):'Session record'} onBack={()=>setSession(undefined)}/>
    {loading?<Text accessibilityRole="text" accessibilityLiveRegion="polite" style={canvasParts.body}>Loading session…</Text>:failed?<><V11PageHeader kind="notice" context="Not available" title={"We can’t load\nthis session."}/><V11PrimaryButton label="Back to History" onPress={()=>setSession(undefined)}/></>:detail?<>
      <V11PageHeader context={`Session record · ${dateLabel(detail.localDay)}`} title={`${level(detail.deliveredLevel)} routine.`}/>
      <View style={canvasParts.spread}><Text style={canvasParts.badge}>{level(detail.duration)}</Text><Text style={canvasParts.badge}>{detail.status==='completed'?'✓ Completed':detail.status==='stopped'?'Ended early':detail.status==='safetyStopped'?'Stopped for safety':level(detail.status)}</Text></View>
      <View style={canvasParts.soft}><Text style={canvasParts.badge}>Included areas</Text><Text style={canvasParts.title}>{detail.areas.map(a=>areaDisplayNames[a]).join(' · ')}</Text><Text style={canvasParts.body}>Routine and response are saved separately.</Text></View>
      <Text accessibilityRole="header" style={st.section}>Step record</Text>{detail.steps.map(step=><V11ListRow key={step.id} icon={step.status==='completed'?'checkmark-outline':step.status==='skipped'?'play-skip-forward-outline':'ellipse-outline'} label={step.title} subtitle={level(step.status)}/>)}
      <Text accessibilityRole="header" style={st.section}>Your responses</Text>{detail.areas.map(a=><V11ListRow key={a} icon="chatbubble-outline" label={areaDisplayNames[a]} subtitle={detail.responses[a]?detail.responses[a]==='same'?'About the same':level(detail.responses[a]!):'No after-routine response'}/>)}</>:null}</>);
  if(locked)return shell(<><V11Topline onBack={()=>setLocked(false)}/><V11PageHeader kind="notice" context="Routine options" title={"Active isn’t\navailable yet."} lead="The current option remains based on your check-ins and the existing eligibility rules."/><View style={canvasParts.soft}><Text style={canvasParts.title}>No score to chase.</Text><Text style={canvasParts.body}>Participation is not proof of recovery. Don’t change an answer to unlock a different level.</Text></View><V11PrimaryButton label="Back to history" onPress={()=>setLocked(false)}/></>);
  if(area){const data=progress.areas.find(item=>item.area===area);return shell(<><V11Topline label="Area history" onBack={()=>setArea(undefined)}/><V11PageHeader context="Main focus area" title={areaDisplayNames[area]}/>{data?<>
    <View style={canvasParts.spread}><V11AreaEmblem area={area}/><View style={st.copy}><Text style={canvasParts.title}>{data.participationCount} participation choices</Text><Text style={canvasParts.fine}>{data.checkInCount} check-ins · {Object.values(data.responses).reduce((a,b)=>a+b,0)} after-routine responses</Text></View></View>
    <Text style={canvasParts.fine}>What you reported afterward</Text><View style={st.responseStrip}>{(['better','same','worse'] as const).map(value=><View key={value} style={st.response}><Text style={canvasParts.title}>{data.responses[value]}</Text><Text style={canvasParts.fine}>{level(value)}</Text></View>)}</View>
    {entries(area)}<Text style={canvasParts.fine}>{historyNote}</Text><Text style={canvasParts.fine}>Your response is context—not a recovery score.</Text>{!data.activeUnlocked?<V11InlineTextAction label="About available levels" onPress={()=>setLocked(true)}/>:<Text style={canvasParts.fine}>Active option is available.</Text>}</>:<V11NoticeCard message="Area history unavailable. Return to History and try again."/>}</>);}
  const hasHistory=progress.areas.some(item=>item.checkInCount>0)||progress.recentSessions.length>0;
  if(!hasHistory)return shell(<><V11BrandMark context="Your daily movement"/><V11PageHeader context="Your history" title={"Start with\none check-in."}/><V11Emblem kind="journal-outline"/><Text style={canvasParts.body}>Your choices will appear here after you take part. There’s no score to catch up with.</Text>{summary}<View style={canvasParts.soft}><Text style={canvasParts.title}>What you’ll see</Text><V11Checkline>Check-ins by area</V11Checkline><V11Checkline>Completed routines and intentional stops</V11Checkline><V11Checkline>Optional after-routine responses</V11Checkline></View><V11PrimaryButton label="Go to Today" onPress={onToday}/></>);
  const weekStart=new Date(`${progress.currentLocalDay??new Date().toLocaleDateString('en-CA')}T12:00:00`);weekStart.setDate(weekStart.getDate()-(weekStart.getDay()+daysPerWeek-1)%daysPerWeek);
  return shell(<><V11PageHeader title="History"/>{summary}{entries()}<Text style={canvasParts.fine}>{historyNote}</Text><Text accessibilityRole="header" style={st.section}>Browse by area</Text>
    <View style={[st.browse,stacked&&st.stacked]}>{progress.areas.filter(item=>item.checkInCount>0).map(item=><Pressable key={item.area} accessibilityRole="button" accessibilityLabel={`View ${areaDisplayNames[item.area]} history`} onPress={()=>setArea(item.area)} style={st.areaChoice}><View style={st.copy}><Text style={canvasParts.title}>{areaDisplayNames[item.area]}</Text><Text style={canvasParts.fine}>{item.history.filter(entry=>new Date(`${entry.localDay}T12:00:00`)>=weekStart).length} this week</Text></View><Text style={canvasParts.title}>›</Text></Pressable>)}</View></>);
}
const st=StyleSheet.create({
  summary:{backgroundColor:c.softWell,borderRadius:cv.choiceRadius,paddingVertical:s.small,paddingHorizontal:s.standard,gap:s.compact},
  date:{color:c.textSecondary,fontSize:t.bodySize,lineHeight:t.bodyLineHeight,fontWeight:t.semiboldWeight,marginTop:s.small},
  entry:{flexDirection:'row',gap:s.small,paddingVertical:s.small},entryTitle:{color:c.textPrimary,fontSize:t.choiceSize,lineHeight:t.choiceLineHeight,fontWeight:t.strongWeight},
  copy:{flex:1,gap:s.micro},time:{width:l.touchMinimumHeight,fontSize:t.captionSize,lineHeight:t.captionLineHeight,color:c.textSecondary,fontVariant:['tabular-nums']},
  section:{fontSize:t.headingSize,lineHeight:t.headingLineHeight,fontWeight:t.strongWeight,color:c.textPrimary},
  browse:{flexDirection:'row',flexWrap:'wrap',gap:s.small},areaChoice:{flex:1,minWidth:l.touchMinimumHeight,minHeight:cv.rowMinimum,backgroundColor:c.softWell,borderWidth:l.borderWidth,borderColor:c.separator,borderRadius:cv.reviewFlagRadius,padding:s.small,flexDirection:'row',alignItems:'center',gap:s.compact},
  responseStrip:{flexDirection:'row',paddingVertical:s.standard,borderTopWidth:l.borderWidth,borderBottomWidth:l.borderWidth,borderColor:c.separator},response:{flex:1,alignItems:'center',gap:s.micro},stacked:{flexDirection:'column'},
});
