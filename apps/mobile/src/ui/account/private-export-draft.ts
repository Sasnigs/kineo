/** Memory-only handoff. A canceled or superseded download cannot resurrect private data. */
export function createPrivateExportDraft<Value>() {
  let generation=0;
  let value:Value|undefined;
  return {
    begin(){generation+=1;value=undefined;return generation;},
    retain(ticket:number,next:Value){if(ticket!==generation)return false;value=next;return true;},
    current(){return value;},
    discard(){generation+=1;value=undefined;},
    isCurrent(ticket:number){return ticket===generation;},
  };
}
