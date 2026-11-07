import {describe,it,expect} from '@jest/globals';
import {createPrivateExportDraft} from './private-export-draft';
describe('private export handoff',()=>{
  it('cannot retain a late download after cancel or account teardown',()=>{
    const draft=createPrivateExportDraft<object>();const pending=draft.begin();draft.discard();
    expect(draft.retain(pending,{private:true})).toBe(false);expect(draft.current()).toBeUndefined();
  });
  it('supersedes old requests and clears the successful handoff explicitly',()=>{
    const draft=createPrivateExportDraft<object>();const old=draft.begin();const current=draft.begin();
    expect(draft.retain(old,{old:true})).toBe(false);const data={profile:true};expect(draft.retain(current,data)).toBe(true);
    expect(draft.current()).toBe(data);draft.discard();expect(draft.current()).toBeUndefined();
  });
});
