class LatestRequest {
  constructor() { this.generation=0; this.controller=null; }
  begin() {
    this.controller?.abort();
    const generation=++this.generation;
    const controller=new AbortController(); this.controller=controller;
    return { signal:controller.signal, isCurrent:()=>generation===this.generation };
  }
  cancel() { ++this.generation; this.controller?.abort(); }
}
module.exports={ LatestRequest };
